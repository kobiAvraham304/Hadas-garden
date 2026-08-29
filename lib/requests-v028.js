const previousHandler = require('./requests-v026');
const {
  requireSession, parseBody, db, assertDb, isManager, deletePrivateFile,
  notifyEmployees, emitEvent, audit, send, handleError, httpError,
} = require('./server');
const { timeToMinutes } = require('./schedule');

const CERTIFICATE_BUCKET = 'hadas-sick-certificates';

function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')); }
function trimTime(value) { return value ? String(value).slice(0, 5) : ''; }

async function inferShiftForTimeRequest({ requesterId, requestType, requestDate, requestedStart, requestedEnd }) {
  if (!requesterId || !validDate(requestDate)) return null;
  const rows = assertDb(await db().from('hadas_shifts')
    .select('*')
    .eq('employee_id', requesterId)
    .eq('shift_date', requestDate)
    .order('start_time', { ascending: true }), 'לא ניתן לאתר את השיבוץ של העובד') || [];

  if (!rows.length) throw httpError(409, 'אין לעובד שיבוץ בתאריך שנבחר. אין צורך לבחור שיבוץ ידנית — יש לבחור תאריך שבו העובד משובץ.');
  if (rows.length === 1) return rows[0];

  const requested = requestType === 'late_start' ? requestedStart : requestedEnd;
  if (requested) {
    const point = timeToMinutes(requested);
    const matches = rows.filter((row) => point > timeToMinutes(row.start_time) && point < timeToMinutes(row.end_time));
    if (matches.length === 1) return matches[0];
  }

  const ranges = rows.map((row) => `${trimTime(row.start_time)}-${trimTime(row.end_time)}`).join(', ');
  throw httpError(409, `לעובד יש כמה מקטעי שיבוץ בתאריך זה (${ranges}). יש לבחור שעה שנמצאת בתוך המקטע שרוצים לשנות.`);
}

async function deleteApprovedRequest(caller, requestId) {
  if (!isManager(caller)) throw httpError(403, 'רק מנהלת המעון או אחראית השיבוץ יכולות למחוק בקשה שאושרה');
  const request = assertDb(await db().from('hadas_requests').select('*').eq('id', requestId).maybeSingle(), 'הבקשה לא נמצאה');
  if (!request) throw httpError(404, 'הבקשה לא נמצאה');
  if (request.status === 'applied') {
    throw httpError(409, 'הבקשה כבר הוזרמה לשיבוץ ולכן לא ניתן למחוק אותה ישירות. יש לתקן קודם את השיבוץ שנוצר בעקבותיה.');
  }
  if (request.status !== 'approved') throw httpError(409, 'ניתן למחוק דרך פעולה זו רק בקשה שאושרה ועדיין לא הוזרמה לשיבוץ');

  if (request.attachment_path) {
    await deletePrivateFile(CERTIFICATE_BUCKET, request.attachment_path).catch(() => {});
  }
  assertDb(await db().from('hadas_notifications').delete().eq('entity_type', 'request').eq('entity_id', String(request.id)), 'לא ניתן לנקות התראות של הבקשה');
  assertDb(await db().from('hadas_requests').delete().eq('id', request.id), 'לא ניתן למחוק את הבקשה');

  await audit(caller.employee.id, 'delete_approved', 'request', request.id, {
    request_type: request.request_type,
    request_date: request.request_date,
    request_end_date: request.request_end_date,
    requester_id: request.requester_id,
  });
  await notifyEmployees([request.requester_id], {
    type: 'request',
    title: 'בקשה שאושרה נמחקה',
    message: `בקשת ${request.request_type === 'leave' ? 'החופשה' : request.request_type === 'sick' ? 'המחלה' : request.request_type === 'day_off' ? 'היום החופשי' : 'השינוי'} לתאריך ${request.request_date} נמחקה על ידי הנהלת המעון.`,
    entityType: 'request',
    entityId: request.id,
    actionRequired: false,
  }, caller.employee.id).catch(() => {});
  await emitEvent('requests');
  await emitEvent('calendar');
  await emitEvent('shifts');
  return request;
}

module.exports = async function requestsV028(req, res) {
  try {
    if (req.method !== 'POST') return previousHandler(req, res);
    const body = parseBody(req);
    const action = String(body.action || 'create');

    if (action === 'delete_approved') {
      const caller = await requireSession(req);
      if (!body.id) throw httpError(400, 'חסר מזהה בקשה');
      const deleted = await deleteApprovedRequest(caller, String(body.id));
      return send(res, 200, { ok: true, deleted_id: deleted.id });
    }

    if (action === 'create' && ['late_start', 'early_finish'].includes(String(body.request_type || '')) && !body.shift_id) {
      const caller = await requireSession(req);
      const requestedRequester = String(body.requester_id || '');
      const onBehalf = Boolean(requestedRequester && requestedRequester !== caller.employee.id);
      if (onBehalf && !isManager(caller)) throw httpError(403, 'רק הנהלת המעון יכולה להגיש בקשה עבור עובד אחר');
      const requesterId = onBehalf ? requestedRequester : caller.employee.id;
      const shift = await inferShiftForTimeRequest({
        requesterId,
        requestType: String(body.request_type),
        requestDate: String(body.request_date || ''),
        requestedStart: body.requested_start,
        requestedEnd: body.requested_end,
      });
      req.body = { ...body, shift_id: shift.id };
    }

    return previousHandler(req, res);
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports.inferShiftForTimeRequest = inferShiftForTimeRequest;
module.exports.deleteApprovedRequest = deleteApprovedRequest;
