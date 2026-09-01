const {
  requireSession, parseBody, db, assertDb, isManager, isTeacher, canCreateContent,
  emitEvent, audit, notifyEmployees, send, handleError, httpError,
} = require('../lib/server');

function cleanEmployeeIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).filter(Boolean))].slice(0, 500);
}

function truthy(value) {
  return value === true || ['true', '1', 'on'].includes(String(value || '').toLowerCase());
}

async function replaceRecipients(id, type, ids) {
  assertDb(await db().from('hadas_announcement_recipients').delete().eq('announcement_id', id), 'לא ניתן לעדכן את מקבלי ההודעה');
  if (type !== 'employees') return;
  const clean = cleanEmployeeIds(ids);
  if (!clean.length) throw httpError(400, 'יש לבחור לפחות עובד אחד');
  const active = assertDb(await db().from('hadas_employees').select('id').in('id', clean).eq('active', true), 'לא ניתן לבדוק עובדים') || [];
  if (active.length !== clean.length) throw httpError(409, 'אחד העובדים שנבחרו אינו פעיל');
  assertDb(await db().from('hadas_announcement_recipients').insert(clean.map((employee_id) => ({ announcement_id: id, employee_id }))), 'לא ניתן לשמור את מקבלי ההודעה');
}

async function audienceEmployeeIds(type, classId, ids = []) {
  if (type === 'employees') return cleanEmployeeIds(ids);
  let query = db().from('hadas_employees').select('id').eq('active', true);
  if (type === 'class') query = query.eq('primary_class_id', classId);
  return (assertDb(await query, 'לא ניתן למצוא מקבלי הודעה') || []).map((row) => row.id);
}

async function getAnnouncement(id) {
  return assertDb(await db().from('hadas_announcements').select('*').eq('id', id).maybeSingle(), 'ההודעה לא נמצאה');
}

function canManage(caller, item) {
  return isManager(caller) || item?.created_by === caller.employee.id;
}

function audience(caller, type, classId) {
  if (isTeacher(caller) && !isManager(caller)) {
    if (!caller.employee.primary_class_id) throw httpError(403, 'לא מוגדרת לגננת כיתה קבועה');
    return {audienceType:'class', classId:caller.employee.primary_class_id};
  }
  const audienceType = ['all', 'class', 'employees'].includes(type) ? type : 'all';
  const cid = audienceType === 'class' ? (classId || null) : null;
  if (audienceType === 'class' && !cid) throw httpError(400, 'יש לבחור כיתה');
  return { audienceType, classId: cid };
}

function attachment(body) {
  if (body.attachment_data === undefined) return {};
  const data = String(body.attachment_data || '');
  if (!data) return { attachment_data: null, attachment_name: null, attachment_type: null };
  const match = data.match(/^data:([^;,]+);base64,/i);
  const type = String(match?.[1] || '').toLowerCase();
  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  if (!allowed.includes(type)) throw httpError(400, 'ניתן לצרף תמונה מהגלריה או PDF בלבד');
  if (data.length > 5 * 1024 * 1024) throw httpError(413, 'הקובץ המצורף גדול מדי');
  const fallbackName = type === 'application/pdf' ? 'מסמך.pdf' : 'תמונה.jpg';
  return {
    attachment_data: data,
    attachment_name: String(body.attachment_name || fallbackName).slice(0, 180),
    attachment_type: type,
  };
}

module.exports = async function handler(req, res) {
  try {
    const body = parseBody(req);
    const caller = await requireSession(req);

    if (req.method === 'POST' && body.action === 'read') {
      assertDb(await db().from('hadas_announcement_reads').upsert({
        announcement_id: body.id,
        employee_id: caller.employee.id,
        read_at: new Date().toISOString(),
      }, { onConflict: 'announcement_id,employee_id' }), 'לא ניתן לסמן קריאה');
      await emitEvent('announcement_reads');
      return send(res, 200, { ok: true });
    }

    if (!canCreateContent(caller)) throw httpError(403, 'אין הרשאה לפרסם הודעה');

    if (req.method === 'POST') {
      const title = String(body.title || '').trim();
      const content = String(body.body || '').trim();
      if (!title || !content) throw httpError(400, 'יש להזין כותרת ותוכן');
      const a = audience(caller, body.audience_type, body.class_id);
      const row = {
        title,
        body: content,
        announcement_type: ['info', 'important', 'urgent'].includes(body.announcement_type) ? body.announcement_type : 'info',
        audience_type: a.audienceType,
        class_id: a.classId,
        published_at: body.published_at || new Date().toISOString(),
        expires_at: body.expires_at || null,
        active: true,
        is_pinned: Boolean(body.is_pinned),
        requires_acknowledgement: body.requires_acknowledgement !== false && String(body.requires_acknowledgement) !== 'false',
        popup_on_login: truthy(body.popup_on_login),
        created_by: caller.employee.id,
        ...attachment(body),
      };
      const item = assertDb(await db().from('hadas_announcements').insert(row).select('*').single(), 'לא ניתן לפרסם הודעה');
      try {
        await replaceRecipients(item.id, a.audienceType, body.employee_ids);
      } catch (error) {
        await db().from('hadas_announcements').delete().eq('id', item.id);
        throw error;
      }
      const ids = (await audienceEmployeeIds(a.audienceType, a.classId, body.employee_ids)).filter((id) => id !== caller.employee.id);
      await notifyEmployees(ids, { type: 'announcement', title: `הודעה חדשה: ${title}`, message: content.slice(0, 220), entityType: 'announcement', entityId: item.id });
      await audit(caller.employee.id, 'create', 'announcement', item.id);
      await emitEvent('announcements');
      return send(res, 201, { ok: true, item });
    }

    const id = body.id || req.query?.id;
    if (!id) throw httpError(400, 'חסר מזהה הודעה');
    const current = await getAnnouncement(id);
    if (!current) throw httpError(404, 'ההודעה לא נמצאה');
    if (!canManage(caller, current)) throw httpError(403, 'ניתן לערוך רק הודעה שיצרת');

    if (req.method === 'PATCH') {
      const row = {};
      for (const key of ['title', 'body', 'announcement_type', 'published_at', 'expires_at', 'active', 'is_pinned', 'requires_acknowledgement']) {
        if (body[key] !== undefined) row[key] = body[key] === '' ? null : body[key];
      }
      Object.assign(row, attachment(body));
      if (body.popup_on_login !== undefined) row.popup_on_login = truthy(body.popup_on_login);
      if (body.audience_type !== undefined) {
        const a = audience(caller, body.audience_type, body.class_id);
        row.audience_type = a.audienceType;
        row.class_id = a.classId;
        await replaceRecipients(id, a.audienceType, body.employee_ids);
      }
      assertDb(await db().from('hadas_announcements').update(row).eq('id', id), 'לא ניתן לעדכן הודעה');
      await audit(caller.employee.id, 'update', 'announcement', id);
      await emitEvent('announcements');
      return send(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      assertDb(await db().from('hadas_announcements').update({ active: false }).eq('id', id), 'לא ניתן להסיר הודעה');
      await emitEvent('announcements');
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    handleError(res, error);
  }
};

module.exports.truthy = truthy;
module.exports.announcementAudience = audience;
