const {
  requireSession, parseBody, db, assertDb, isManager, canCreateContent,
  emitEvent, audit, notifyEmployees, send, handleError, httpError,
} = require('../lib/server');

function cleanEmployeeIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).filter(Boolean))].slice(0, 500);
}

async function replaceRecipients(announcementId, audienceType, employeeIds) {
  assertDb(await db().from('hadas_announcement_recipients').delete().eq('announcement_id', announcementId), 'לא ניתן לעדכן את מקבלי ההודעה');
  if (audienceType !== 'employees') return;
  const ids = cleanEmployeeIds(employeeIds);
  if (!ids.length) throw httpError(400, 'יש לבחור לפחות עובד אחד');
  const active = assertDb(await db().from('hadas_employees').select('id').in('id', ids).eq('active', true), 'לא ניתן לבדוק עובדים') || [];
  if (active.length !== ids.length) throw httpError(409, 'אחד העובדים שנבחרו אינו פעיל');
  assertDb(await db().from('hadas_announcement_recipients').insert(ids.map((employeeId) => ({ announcement_id: announcementId, employee_id: employeeId }))), 'לא ניתן לשמור את מקבלי ההודעה');
}


async function audienceEmployeeIds(audienceType, classId, employeeIds = []) {
  if (audienceType === 'employees') return cleanEmployeeIds(employeeIds);
  let query = db().from('hadas_employees').select('id').eq('active', true);
  if (audienceType === 'class') query = query.eq('primary_class_id', classId);
  const rows = assertDb(await query, 'לא ניתן למצוא מקבלי הודעה') || [];
  return rows.map((row) => row.id);
}

async function getAnnouncement(id) {
  return assertDb(await db().from('hadas_announcements').select('*').eq('id', id).maybeSingle(), 'ההודעה לא נמצאה');
}

function canManage(caller, item) {
  return isManager(caller) || item?.created_by === caller.employee.id;
}

module.exports = async function handler(req, res) {
  try {
    const body = parseBody(req);
    const caller = await requireSession(req);

    if (req.method === 'POST' && body.action === 'read') {
      if (!body.id) throw httpError(400, 'חסרה הודעה');
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
      const audienceType = ['all', 'class', 'employees'].includes(body.audience_type) ? body.audience_type : 'all';
      if (audienceType === 'class' && !body.class_id) throw httpError(400, 'יש לבחור כיתה');
      const row = {
        title,
        body: content,
        announcement_type: ['info', 'important', 'urgent'].includes(body.announcement_type) ? body.announcement_type : 'info',
        audience_type: audienceType,
        class_id: audienceType === 'class' ? body.class_id : null,
        published_at: body.published_at || new Date().toISOString(),
        expires_at: body.expires_at || null,
        active: true,
        is_pinned: Boolean(body.is_pinned),
        requires_acknowledgement: body.requires_acknowledgement !== false && String(body.requires_acknowledgement) !== 'false',
        created_by: caller.employee.id,
      };
      const item = assertDb(await db().from('hadas_announcements').insert(row).select('*').single(), 'לא ניתן לפרסם הודעה');
      try {
        await replaceRecipients(item.id, audienceType, body.employee_ids);
      } catch (error) {
        await db().from('hadas_announcements').delete().eq('id', item.id);
        throw error;
      }
      const notifyIds = (await audienceEmployeeIds(audienceType, row.class_id, body.employee_ids)).filter((id) => id !== caller.employee.id);
      await notifyEmployees(notifyIds, { type:'announcement', title:`הודעה חדשה: ${title}`, message:content.slice(0,220), entityType:'announcement', entityId:item.id });
      await audit(caller.employee.id, 'create', 'announcement', item.id, { audienceType });
      await emitEvent('announcements');
      return send(res, 201, { ok: true, item });
    }

    const id = body.id || req.query?.id;
    if (!id) throw httpError(400, 'חסר מזהה הודעה');
    const current = await getAnnouncement(id);
    if (!current) throw httpError(404, 'ההודעה לא נמצאה');
    if (!canManage(caller, current)) throw httpError(403, 'ניתן לנהל רק הודעה שיצרת');

    if (req.method === 'PATCH') {
      const row = {};
      for (const key of ['title', 'body', 'announcement_type', 'published_at', 'expires_at', 'active', 'is_pinned', 'requires_acknowledgement']) {
        if (body[key] !== undefined) row[key] = body[key] === '' ? null : body[key];
      }
      if (body.audience_type !== undefined) {
        const audienceType = ['all', 'class', 'employees'].includes(body.audience_type) ? body.audience_type : 'all';
        if (audienceType === 'class' && !body.class_id) throw httpError(400, 'יש לבחור כיתה');
        row.audience_type = audienceType;
        row.class_id = audienceType === 'class' ? body.class_id : null;
        await replaceRecipients(id, audienceType, body.employee_ids);
      }
      assertDb(await db().from('hadas_announcements').update(row).eq('id', id), 'לא ניתן לעדכן הודעה');
      await audit(caller.employee.id, 'update', 'announcement', id);
      await emitEvent('announcements');
      return send(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      assertDb(await db().from('hadas_announcements').update({ active: false }).eq('id', id), 'לא ניתן להסיר הודעה');
      await audit(caller.employee.id, 'deactivate', 'announcement', id);
      await emitEvent('announcements');
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) { handleError(res, error); }
};
