const previousHandler = require('./requests-v028');
const {
  requireSession, parseBody, db, assertDb, isManager, deletePrivateFile,
  notifyEmployees, notifyManagers, emitEvent, audit, send, handleError, httpError,
} = require('./server');

const CERTIFICATE_BUCKET = 'hadas-sick-certificates';

function truthy(value) {
  return value === true || String(value || '').toLowerCase() === 'true' || String(value || '') === '1' || String(value || '').toLowerCase() === 'on';
}

function captureResponse() {
  return {
    statusCode: 200, headers: {}, body: '',
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
    end(value = '') { this.body = value ?? ''; return this; },
    json(value) { this.setHeader('content-type', 'application/json; charset=utf-8'); return this.end(JSON.stringify(value)); },
  };
}
function replayResponse(source, target, payload = undefined) {
  target.status(source.statusCode || 200);
  for (const [name, value] of Object.entries(source.headers || {})) target.setHeader(name, value);
  return target.end(payload === undefined ? source.body : JSON.stringify(payload));
}
function parseCaptured(source) {
  try { return JSON.parse(String(source.body || '{}')); } catch { return null; }
}

async function deleteRequestWithRollback(caller, requestId) {
  if (!isManager(caller)) throw httpError(403, 'רק מנהלת המעון או אחראית השיבוץ יכולות למחוק בקשה שאושרה או הוזרמה');
  const result = assertDb(await db().rpc('hadas_delete_request_v030', {
    p_request_id: requestId,
    p_actor_id: caller.employee.id,
  }), 'לא ניתן למחוק את הבקשה ולסנכרן את השיבוץ');
  if (result?.attachment_path) await deletePrivateFile(CERTIFICATE_BUCKET, result.attachment_path).catch(() => {});
  await audit(caller.employee.id, 'delete_with_rollback', 'request', requestId, {
    previous_status: result?.status || null,
    restored_shifts: Number(result?.restored_shifts || 0),
    request_type: result?.request_type || null,
  });
  if (result?.requester_id) {
    await notifyEmployees([result.requester_id], {
      type: 'request',
      title: 'בקשה נמחקה על ידי הנהלת המעון',
      message: result.status === 'applied'
        ? 'הבקשה שהוזרמה נמחקה והשיבוץ הוחזר למצב שלפני ההזרמה.'
        : 'הבקשה שאושרה נמחקה מהמערכת.',
      entityType: 'request', entityId: requestId, actionRequired: false,
    }, caller.employee.id).catch(() => {});
  }
  await emitEvent('requests');
  await emitEvent('calendar');
  await emitEvent('shifts');
  return result || { id: requestId };
}

async function finishManagerPreapprovedSwap(request) {
  if (!request?.manager_preapproved || request.request_type !== 'swap' || request.status !== 'pending' || !request.target_approved) return request;
  const updated = assertDb(await db().from('hadas_requests').update({
    status: 'approved',
    decided_by: request.created_by,
    decided_at: new Date().toISOString(),
  }).eq('id', request.id).select('*').single(), 'העובד אישר אך לא ניתן היה להשלים את האישור המוקדם');
  assertDb(await db().from('hadas_notifications').update({ action_required: false })
    .eq('entity_type', 'request').eq('entity_id', String(request.id)), 'לא ניתן לסגור את התראות האישור');
  await notifyManagers({
    type: 'request', title: 'החלפה שאושרה מראש מוכנה להזרמה',
    message: 'העובד שנבחר אישר את ההחלפה. אישור ההנהלה ניתן מראש ולכן אין צורך באישור נוסף.',
    entityType: 'request', entityId: request.id, actionRequired: false,
  }, request.target_employee_id || null).catch(() => {});
  await emitEvent('requests');
  return updated;
}

module.exports = async function requestsV030(req, res) {
  try {
    const body = parseBody(req);
    const action = String(body.action || 'create');

    if (req.method === 'POST' && ['delete_request', 'delete_approved'].includes(action)) {
      const caller = await requireSession(req);
      if (!body.id) throw httpError(400, 'חסר מזהה בקשה');
      const deleted = await deleteRequestWithRollback(caller, String(body.id));
      return send(res, 200, { ok: true, deleted_id: deleted.id, restored_shifts: Number(deleted.restored_shifts || 0), previous_status: deleted.status });
    }

    if (req.method === 'POST' && action === 'create') {
      const captured = captureResponse();
      await previousHandler(req, captured);
      if (captured.statusCode >= 400) return replayResponse(captured, res);
      const payload = parseCaptured(captured);
      const created = payload?.request;
      if (!created?.id) return replayResponse(captured, res, payload || undefined);

      const managerSubmitted = created.submitted_by_manager === true;
      const managerPreapproved = managerSubmitted && (truthy(body.pre_approved) || truthy(body.apply_now));
      const updated = assertDb(await db().from('hadas_requests').update({ manager_preapproved: managerPreapproved })
        .eq('id', created.id).select('*').single(), 'הבקשה נשמרה אך לא ניתן לעדכן את מצב האישור מראש');
      if (!managerSubmitted && updated.status !== 'pending') {
        throw httpError(409, 'בקשה שעובד מגיש בעצמו אינה יכולה להיות מאושרת מראש');
      }
      await audit(updated.created_by || null, 'request_preapproval_state', 'request', updated.id, {
        submitted_by_manager: managerSubmitted,
        manager_preapproved: managerPreapproved,
        swap_requires_target_consent: updated.request_type === 'swap',
      });
      payload.request = updated;
      payload.manager_preapproved = managerPreapproved;
      payload.pre_approval_waits_for_swap_target = Boolean(managerPreapproved && updated.request_type === 'swap' && !updated.target_approved);
      return replayResponse(captured, res, payload);
    }

    if (req.method === 'POST' && action === 'target_accept') {
      const captured = captureResponse();
      await previousHandler(req, captured);
      if (captured.statusCode >= 400) return replayResponse(captured, res);
      const current = body.id
        ? assertDb(await db().from('hadas_requests').select('*').eq('id', String(body.id)).maybeSingle(), 'לא ניתן לרענן את הבקשה')
        : null;
      const updated = await finishManagerPreapprovedSwap(current);
      const payload = parseCaptured(captured) || { ok: true };
      if (updated?.id) payload.request = updated;
      if (updated?.status === 'approved' && updated?.manager_preapproved) payload.manager_preapproval_completed = true;
      return replayResponse(captured, res, payload);
    }

    return previousHandler(req, res);
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports.truthy = truthy;
module.exports.deleteRequestWithRollback = deleteRequestWithRollback;
module.exports.finishManagerPreapprovedSwap = finishManagerPreapprovedSwap;
