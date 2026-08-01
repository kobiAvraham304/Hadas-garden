const {
  requireSession, parseBody, db, assertDb, isManager,
  emitEvent, audit, send, handleError, httpError,
} = require('../lib/server');

function monthRange(monthValue) {
  const safe = /^\d{4}-\d{2}$/.test(String(monthValue || '')) ? `${monthValue}-01` : new Date().toISOString().slice(0, 7) + '-01';
  const start = new Date(`${safe}T12:00:00Z`);
  const first = new Date(start); first.setUTCDate(first.getUTCDate() - first.getUTCDay());
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 12));
  const last = new Date(next); last.setUTCDate(last.getUTCDate() + (6 - last.getUTCDay()));
  return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
}

function canSeeEvent(caller, event) {
  if (isManager(caller)) return true;
  if (event.visibility === 'managers') return false;
  if (event.visibility === 'class') return event.class_id === caller.employee.primary_class_id;
  return true;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const caller = await requireSession(req, { csrf: false });
      const range = monthRange(req.query?.month);
      let events = assertDb(await db().from('hadas_calendar_events').select('*').gte('event_date', range.start).lte('event_date', range.end).order('event_date').order('start_time'), 'לא ניתן לטעון לוח שנה') || [];
      events = events.filter((event) => canSeeEvent(caller, event));
      return send(res, 200, { ok: true, events, range });
    }

    const caller = await requireSession(req, { manager: true });
    const body = parseBody(req);
    if (req.method === 'POST') {
      if (!String(body.title || '').trim() || !body.event_date) throw httpError(400, 'יש להזין כותרת ותאריך');
      const row = {
        title: String(body.title).trim(),
        description: String(body.description || '').trim() || null,
        event_type: ['holiday', 'meeting', 'training', 'birthday', 'activity', 'other'].includes(body.event_type) ? body.event_type : 'other',
        event_date: body.event_date,
        start_time: body.start_time || null,
        end_time: body.end_time || null,
        visibility: ['all', 'managers', 'class'].includes(body.visibility) ? body.visibility : 'all',
        class_id: body.visibility === 'class' ? body.class_id || null : null,
        created_by: caller.employee.id,
      };
      if (row.visibility === 'class' && !row.class_id) throw httpError(400, 'יש לבחור כיתה');
      const item = assertDb(await db().from('hadas_calendar_events').insert(row).select('*').single(), 'לא ניתן ליצור אירוע');
      await audit(caller.employee.id, 'create', 'calendar_event', item.id);
      await emitEvent('calendar');
      return send(res, 201, { ok: true, item });
    }
    if (req.method === 'PATCH') {
      if (!body.id) throw httpError(400, 'חסר מזהה אירוע');
      const row = {};
      for (const key of ['title', 'description', 'event_type', 'event_date', 'start_time', 'end_time', 'visibility', 'class_id']) {
        if (body[key] !== undefined) row[key] = body[key] === '' ? null : body[key];
      }
      if (row.visibility && row.visibility !== 'class') row.class_id = null;
      assertDb(await db().from('hadas_calendar_events').update(row).eq('id', body.id), 'לא ניתן לעדכן אירוע');
      await audit(caller.employee.id, 'update', 'calendar_event', body.id);
      await emitEvent('calendar');
      return send(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      const id = body.id || req.query?.id;
      assertDb(await db().from('hadas_calendar_events').delete().eq('id', id), 'לא ניתן למחוק אירוע');
      await audit(caller.employee.id, 'delete', 'calendar_event', id);
      await emitEvent('calendar');
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) { handleError(res, error); }
};
