const legacyHandler = require('../handlers/requests');
const {
  parseBody, db, assertDb, notifyManagers, emitEvent, audit, handleError,
} = require('./server');

function truthy(value) { return value === true || String(value || '').toLowerCase() === 'true' || String(value || '') === '1'; }
function requestLabel(type) {
  return type === 'leave' ? 'חופשה' : type === 'sick' ? 'מחלה' : type === 'day_off' ? 'יום חופשי' : type === 'swap' ? 'החלפת שיבוץ' : 'שינוי שעות';
}
function requestRange(request) {
  return request?.request_end_date && request.request_end_date !== request.request_date
    ? `${request.request_date}–${request.request_end_date}` : request?.request_date || '';
}
function captureResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    ended: false,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
    end(value = '') { this.body = value ?? ''; this.ended = true; return this; },
    json(value) { this.setHeader('content-type', 'application/json; charset=utf-8'); return this.end(JSON.stringify(value)); },
  };
}
function replayResponse(source, target, bodyOverride = null) {
  target.status(source.statusCode || 200);
  for (const [name, value] of Object.entries(source.headers || {})) target.setHeader(name, value);
  const body = bodyOverride === null ? source.body : JSON.stringify(bodyOverride);
  return target.end(body);
}

module.exports = async function requestsV026(req, res) {
  try {
    if (req.method !== 'POST') return legacyHandler(req, res);
    const body = parseBody(req);
    const action = body.action || 'create';
    const explicitlyApproved = truthy(body.pre_approved) || truthy(body.apply_now);
    if (action !== 'create' || explicitlyApproved || !body.requester_id) return legacyHandler(req, res);

    // שומרים דרך המנגנון הוותיק כדי לא לשכפל לוגיקת קבצים, החלפות, ולידציה והתראות.
    // לאחר מכן, ורק אם אכן מדובר בבקשה שהוגשה ע״י מנהלת/משבצת עבור עובד, מחזירים אותה ל-pending.
    const captured = captureResponse();
    await legacyHandler(req, captured);
    if (captured.statusCode >= 400) return replayResponse(captured, res);

    let payload;
    try { payload = JSON.parse(String(captured.body || '{}')); }
    catch { return replayResponse(captured, res); }
    const created = payload?.request;
    if (!created?.id || !created.submitted_by_manager || created.status !== 'approved') return replayResponse(captured, res, payload);

    const updated = assertDb(await db().from('hadas_requests').update({
      status: 'pending',
      decided_by: null,
      decided_at: null,
    }).eq('id', created.id).select('*').single(), 'הבקשה נשמרה אך לא ניתן להחזיר אותה להמתנה לאישור');

    await notifyManagers({
      type: 'request',
      title: 'בקשה חדשה לעובד ממתינה לאישור',
      message: `הוזנה בקשת ${requestLabel(updated.request_type)} עבור עובד (${requestRange(updated)}). הבקשה לא סומנה כמאושרת מראש.`,
      entityType: 'request',
      entityId: updated.id,
      actionRequired: true,
    }, updated.created_by || null);
    await audit(updated.created_by || null, 'manager_request_pending', 'request', updated.id, { pre_approved: false });
    await emitEvent('requests');

    payload.request = updated;
    payload.pre_approved = false;
    return replayResponse(captured, res, payload);
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports.truthy = truthy;
