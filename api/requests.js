const { parseBody, supabaseFetch, getCaller, requireManager, send, handleError } = require('../lib/api-utils');

async function getRequest(id) {
  const { data } = await supabaseFetch(`/rest/v1/hadas_requests?id=eq.${encodeURIComponent(id)}&select=*&limit=1`, { useSecret: true });
  return Array.isArray(data) ? data[0] : null;
}

async function updateRequest(id, body) {
  await supabaseFetch(`/rest/v1/hadas_requests?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', useSecret: true, headers: { Prefer: 'return=minimal' }, body,
  });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
    const body = parseBody(req);
    const request = await getRequest(body.id);
    if (!request) return send(res, 404, { ok: false, error: 'הבקשה לא נמצאה' });

    if (body.action === 'cancel') {
      const caller = await getCaller(req);
      if (request.requester_id !== caller.profile.id || request.status !== 'pending') {
        return send(res, 403, { ok: false, error: 'לא ניתן לבטל את הבקשה' });
      }
      await updateRequest(request.id, { status: 'cancelled' });
      return send(res, 200, { ok: true });
    }

    if (body.action === 'target_accept') {
      const caller = await getCaller(req);
      if (request.target_employee_id !== caller.profile.id) {
        return send(res, 403, { ok: false, error: 'רק העובדת שקיבלה את ההצעה יכולה לאשר' });
      }
      if (request.status !== 'pending') return send(res, 409, { ok: false, error: 'הבקשה כבר טופלה' });
      await updateRequest(request.id, { target_approved: true });
      return send(res, 200, { ok: true });
    }

    const caller = await requireManager(req);

    if (body.action === 'decide') {
      if (!['approved', 'rejected'].includes(body.status)) {
        return send(res, 400, { ok: false, error: 'החלטה לא תקינה' });
      }
      if (request.request_type === 'swap' && body.status === 'approved' && !request.target_approved) {
        return send(res, 409, { ok: false, error: 'העובדת השנייה עדיין לא אישרה את ההחלפה' });
      }
      await updateRequest(request.id, {
        status: body.status,
        manager_note: body.manager_note || null,
        decided_by: caller.profile.id,
        decided_at: new Date().toISOString(),
      });
      return send(res, 200, { ok: true });
    }

    if (body.action === 'apply') {
      if (request.status !== 'approved') return send(res, 409, { ok: false, error: 'יש לאשר את הבקשה לפני הזרמתה לשיבוץ' });

      if (request.request_type === 'swap') {
        await supabaseFetch('/rest/v1/rpc/hadas_apply_shift_swap', {
          method: 'POST', useSecret: true, body: { p_request_id: request.id, p_actor_id: caller.profile.id },
        });
        return send(res, 200, { ok: true });
      } else if (['leave', 'day_off', 'sick'].includes(request.request_type)) {
        await supabaseFetch(`/rest/v1/hadas_shifts?employee_id=eq.${encodeURIComponent(request.requester_id)}&shift_date=eq.${encodeURIComponent(request.request_date)}`, {
          method: 'DELETE', useSecret: true, headers: { Prefer: 'return=minimal' },
        });
      } else if (request.request_type === 'late_start' && request.requested_start) {
        await supabaseFetch(`/rest/v1/hadas_shifts?employee_id=eq.${encodeURIComponent(request.requester_id)}&shift_date=eq.${encodeURIComponent(request.request_date)}`, {
          method: 'PATCH', useSecret: true, headers: { Prefer: 'return=minimal' }, body: { start_time: request.requested_start },
        });
      } else if (request.request_type === 'early_finish' && request.requested_end) {
        await supabaseFetch(`/rest/v1/hadas_shifts?employee_id=eq.${encodeURIComponent(request.requester_id)}&shift_date=eq.${encodeURIComponent(request.request_date)}`, {
          method: 'PATCH', useSecret: true, headers: { Prefer: 'return=minimal' }, body: { end_time: request.requested_end },
        });
      }

      await updateRequest(request.id, {
        status: 'applied',
        decided_by: caller.profile.id,
        decided_at: new Date().toISOString(),
      });
      return send(res, 200, { ok: true });
    }

    return send(res, 400, { ok: false, error: 'פעולה לא מוכרת' });
  } catch (error) {
    handleError(res, error);
  }
};
