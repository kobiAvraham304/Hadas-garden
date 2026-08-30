const previousHandler = require('./calendar-v027');
const { requireSession, parseBody, isManager, send, handleError, httpError } = require('./server');
const { deleteRequestWithRollback } = require('./requests-v030');

function syntheticLeaveRequestId(body = {}) {
  if (body.request_id) return String(body.request_id);
  const id = String(body.id || '');
  const match = id.match(/^leave:([0-9a-f-]{36})(?::\d{4}-\d{2}-\d{2})?$/i);
  return match ? match[1] : '';
}

module.exports = async function calendarV030(req, res) {
  try {
    if (req.method === 'DELETE') {
      const body = parseBody(req);
      const requestId = syntheticLeaveRequestId(body);
      if (requestId) {
        const caller = await requireSession(req);
        if (!isManager(caller)) throw httpError(403, 'רק מנהלת המעון או אחראית השיבוץ יכולות למחוק חופשה מאושרת מלוח השנה');
        const deleted = await deleteRequestWithRollback(caller, requestId);
        return send(res, 200, {
          ok: true,
          deleted_request_id: requestId,
          restored_shifts: Number(deleted?.restored_shifts || 0),
          previous_status: deleted?.status || null,
        });
      }
    }
    return previousHandler(req, res);
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports.syntheticLeaveRequestId = syntheticLeaveRequestId;
