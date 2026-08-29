const legacyHandler = require('../handlers/calendar');
const {
  requireSession, parseBody, db, assertDb, isManager,
  emitEvent, audit, send, handleError, httpError,
} = require('./server');

function truthy(value) {
  return value === true || String(value || '').toLowerCase() === 'true' || String(value || '') === '1';
}
function getSunday(dateString) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

async function shiftsForDate(date) {
  return assertDb(await db().from('hadas_shifts').select('*').eq('shift_date', date), 'לא ניתן לבדוק שיבוצים קיימים') || [];
}

async function assertClosureSafe(shifts) {
  const ids = shifts.map((row) => row.id).filter(Boolean);
  if (!ids.length) return;
  const [attendanceR, operationsR, requestR, targetRequestR] = await Promise.all([
    db().from('hadas_attendance').select('id').in('shift_id', ids).limit(1),
    db().from('hadas_daily_operations').select('id').in('shift_id', ids).limit(1),
    db().from('hadas_requests').select('id').in('shift_id', ids).in('status', ['pending','approved']).limit(1),
    db().from('hadas_requests').select('id').in('target_shift_id', ids).in('status', ['pending','approved']).limit(1),
  ]);
  if ((assertDb(attendanceR, 'לא ניתן לבדוק נוכחות') || []).length || (assertDb(operationsR, 'לא ניתן לבדוק תפעול יומי') || []).length) {
    throw httpError(409, 'לא ניתן להפוך את היום לחופשי כללי כי כבר קיימים בו דיווחי נוכחות או תפעול יומי. יש לטפל בדיווחים תחילה.');
  }
  if ((assertDb(requestR, 'לא ניתן לבדוק בקשות') || []).length || (assertDb(targetRequestR, 'לא ניתן לבדוק בקשות') || []).length) {
    throw httpError(409, 'לא ניתן להפוך את היום לחופשי כללי כי קיימת בקשה פתוחה המקושרת לשיבוץ באותו יום. יש לטפל בבקשה תחילה.');
  }
}

async function clearDateSchedule(caller, date) {
  const shifts = await shiftsForDate(date);
  if (!shifts.length) return 0;
  await assertClosureSafe(shifts);
  const weekStart = getSunday(date);
  const changes = shifts.map((shift) => ({
    week_start: weekStart,
    shift_id: shift.id,
    change_type: 'delete',
    before_data: shift,
    after_data: null,
    created_by: caller.employee.id,
  }));
  assertDb(await db().from('hadas_schedule_changes').insert(changes), 'לא ניתן לתעד את הסרת השיבוצים ביום החופשי');
  assertDb(await db().from('hadas_shifts').delete().eq('shift_date', date), 'לא ניתן להסיר את השיבוצים מהיום החופשי');
  await audit(caller.employee.id, 'general_day_off_clear_schedule', 'schedule', date, { deleted: shifts.length });
  await emitEvent('shifts');
  return shifts.length;
}

function normalizedGeneralRow(body, caller, current = null) {
  const date = String(body.event_date ?? current?.event_date ?? '');
  const title = String(body.title ?? current?.title ?? '').trim();
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) throw httpError(400, 'יש להזין כותרת ותאריך');
  return {
    title,
    description: String(body.description ?? current?.description ?? '').trim() || null,
    event_type: 'holiday',
    event_date: date,
    start_time: null,
    end_time: null,
    visibility: 'all',
    class_id: null,
    is_general_day_off: true,
    created_by: current?.created_by || caller.employee.id,
  };
}

async function saveGeneralDayOff(caller, body, current = null) {
  const row = normalizedGeneralRow(body, caller, current);
  const existingShifts = await shiftsForDate(row.event_date);
  await assertClosureSafe(existingShifts);
  let item;
  if (current?.id) {
    item = assertDb(await db().from('hadas_calendar_events').update(row).eq('id', current.id).select('*').single(), 'לא ניתן לעדכן יום חופשי כללי');
  } else {
    item = assertDb(await db().from('hadas_calendar_events').insert(row).select('*').single(), 'לא ניתן ליצור יום חופשי כללי');
  }
  const deleted = await clearDateSchedule(caller, row.event_date);
  await audit(caller.employee.id, current ? 'update' : 'create', 'calendar_event', item.id, { general_day_off: true, deleted_shifts: deleted });
  await emitEvent('calendar');
  return { item, deleted };
}

module.exports = async function calendarV027(req, res) {
  try {
    if (req.method === 'GET' || req.method === 'DELETE') return legacyHandler(req, res);
    const body = parseBody(req);
    const requestedGeneral = body.event_type === 'general_day_off' || truthy(body.general_day_off) || truthy(body.is_general_day_off);

    if (req.method === 'POST' && !requestedGeneral) return legacyHandler(req, res);

    if (req.method === 'POST' && requestedGeneral) {
      const caller = await requireSession(req);
      if (!isManager(caller)) throw httpError(403, 'רק מנהלת המעון או אחראית השיבוץ יכולות להגדיר יום חופשי כללי');
      let current = null;
      if (body.id) {
        current = assertDb(await db().from('hadas_calendar_events').select('*').eq('id', body.id).maybeSingle(), 'האירוע לא נמצא');
        if (!current) throw httpError(404, 'האירוע לא נמצא');
        if (!current.is_general_day_off) throw httpError(409, 'האירוע הקיים אינו יום חופשי כללי');
      }
      const { item, deleted } = await saveGeneralDayOff(caller, body, current);
      return send(res, current ? 200 : 201, { ok: true, item, general_day_off: true, deleted_shifts: deleted });
    }

    if (req.method === 'PATCH') {
      if (!body.id) throw httpError(400, 'חסר מזהה אירוע');
      const current = assertDb(await db().from('hadas_calendar_events').select('*').eq('id', body.id).maybeSingle(), 'האירוע לא נמצא');
      if (!current) throw httpError(404, 'האירוע לא נמצא');
      const explicitlyGeneral = body.event_type === 'general_day_off' || body.general_day_off !== undefined || body.is_general_day_off !== undefined;
      if (!current.is_general_day_off && !explicitlyGeneral) return legacyHandler(req, res);

      const caller = await requireSession(req);
      if (!isManager(caller)) throw httpError(403, 'רק מנהלת המעון או אחראית השיבוץ יכולות לערוך יום חופשי כללי');
      const nextGeneral = body.event_type === 'general_day_off' || truthy(body.general_day_off) || truthy(body.is_general_day_off);
      if (!nextGeneral) {
        const update = {
          is_general_day_off: false,
          title: String(body.title ?? current.title).trim(),
          description: String(body.description ?? current.description ?? '').trim() || null,
          event_date: body.event_date || current.event_date,
          event_type: ['holiday','meeting','training','birthday','activity','other'].includes(body.event_type) ? body.event_type : 'holiday',
          start_time: body.start_time || null,
          end_time: body.end_time || null,
          visibility: ['all','managers','class'].includes(body.visibility) ? body.visibility : 'all',
          class_id: body.visibility === 'class' ? body.class_id || null : null,
        };
        assertDb(await db().from('hadas_calendar_events').update(update).eq('id', body.id), 'לא ניתן לעדכן אירוע');
        await audit(caller.employee.id, 'update', 'calendar_event', body.id, { general_day_off: false });
        await emitEvent('calendar');
        return send(res, 200, { ok: true, general_day_off: false });
      }

      const { deleted } = await saveGeneralDayOff(caller, body, current);
      return send(res, 200, { ok: true, general_day_off: true, deleted_shifts: deleted });
    }

    return legacyHandler(req, res);
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports.truthy = truthy;
module.exports.clearDateSchedule = clearDateSchedule;
module.exports.saveGeneralDayOff = saveGeneralDayOff;
