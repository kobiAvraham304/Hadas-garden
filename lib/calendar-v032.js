const previousHandler = require('./calendar-v030');
const {
  requireSession, parseBody, db, assertDb, isManager, emitEvent, audit,
  send, handleError, httpError,
} = require('./server');

function normalizeDates(values) {
  const raw = Array.isArray(values) ? values : [];
  const unique = [...new Set(raw.map((value) => String(value || '').trim()).filter(Boolean))].sort();
  if (!unique.length) throw httpError(400, 'יש לבחור לפחות יום אחד');
  if (unique.length > 31) throw httpError(400, 'ניתן להגדיר עד 31 ימים בפעולה אחת');
  if (unique.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)))) {
    throw httpError(400, 'אחד התאריכים שנבחרו אינו תקין');
  }
  return unique;
}

function friendlyClosureRpcError(error) {
  const message = String(error?.message || error?.details || '');
  if (message.includes('HADAS_CLOSURE_ATTENDANCE')) return httpError(409, 'לא ניתן להגדיר את הטווח כחופש כללי כי באחד הימים כבר קיימים דיווחי נוכחות. יש לטפל בדיווחים תחילה.');
  if (message.includes('HADAS_CLOSURE_OPERATIONS')) return httpError(409, 'לא ניתן להגדיר את הטווח כחופש כללי כי באחד הימים כבר קיימים דיווחי תפעול יומי. יש לטפל בדיווחים תחילה.');
  if (message.includes('HADAS_CLOSURE_REQUEST')) return httpError(409, 'לא ניתן להגדיר את הטווח כחופש כללי כי קיימת בקשה פעילה שמקושרת לשיבוץ באחד הימים. יש לטפל בבקשה תחילה.');
  if (message.includes('HADAS_CLOSURE_TOO_MANY_DATES')) return httpError(400, 'ניתן להגדיר עד 31 ימים בפעולה אחת');
  if (message.includes('HADAS_CLOSURE_DATES_REQUIRED')) return httpError(400, 'יש לבחור לפחות יום אחד');
  if (message.includes('HADAS_CLOSURE_TITLE_REQUIRED')) return httpError(400, 'יש להזין כותרת ליום החופשי');
  return null;
}

async function bulkGeneralDayOff(caller, body) {
  const dates = normalizeDates(body.event_dates);
  const title = String(body.title || 'יום חופשי כללי').trim();
  if (!title) throw httpError(400, 'יש להזין כותרת ליום החופשי');
  const description = String(body.description || '').trim() || null;
  const rpc = await db().rpc('hadas_bulk_general_day_off_v032', {
    p_dates: dates,
    p_title: title,
    p_description: description,
    p_actor: caller.employee.id,
  });
  if (rpc.error) {
    const friendly = friendlyClosureRpcError(rpc.error);
    if (friendly) throw friendly;
    assertDb(rpc, 'לא ניתן לשמור את הימים החופשיים');
  }
  const result = rpc.data || {};
  await audit(caller.employee.id, 'bulk_general_day_off', 'calendar_event', dates[0], {
    dates,
    title,
    created_events: Number(result.created_events || 0),
    deleted_shifts: Number(result.deleted_shifts || 0),
  });
  await emitEvent('calendar');
  if (Number(result.deleted_shifts || 0) > 0) await emitEvent('shifts');
  return { ...result, dates };
}

module.exports = async function calendarV032(req, res) {
  try {
    const body = parseBody(req);
    if (req.method === 'POST' && String(body.action || '') === 'bulk_general_day_off') {
      const caller = await requireSession(req);
      if (!isManager(caller)) throw httpError(403, 'רק מנהלת המעון או אחראית השיבוץ יכולות להגדיר ימים חופשיים כלליים');
      const result = await bulkGeneralDayOff(caller, body);
      return send(res, 201, { ok: true, general_day_off: true, ...result });
    }
    return previousHandler(req, res);
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports.normalizeDates = normalizeDates;
module.exports.bulkGeneralDayOff = bulkGeneralDayOff;
