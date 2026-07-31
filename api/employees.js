const {
  normalizePhone,
  parseBody,
  supabaseFetch,
  requireManager,
  send,
  handleError,
} = require('../lib/api-utils');

const PROFILE_FIELDS = [
  'full_name', 'role', 'job_title', 'primary_class_id', 'can_lead',
  'weekly_hours', 'default_start', 'default_end', 'fixed_day_off', 'active',
];

function profilePayload(body) {
  const payload = {};
  for (const key of PROFILE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) payload[key] = body[key] === '' ? null : body[key];
  }
  if (payload.role && !['admin', 'scheduler', 'employee'].includes(payload.role)) {
    throw Object.assign(new Error('תפקיד המערכת אינו תקין'), { status: 400 });
  }
  return payload;
}

async function replaceConstraints(employeeId, constraints, actorId) {
  await supabaseFetch(`/rest/v1/hadas_employee_class_constraints?employee_id=eq.${encodeURIComponent(employeeId)}`, {
    method: 'DELETE',
    useSecret: true,
    headers: { Prefer: 'return=minimal' },
  });
  if (!Array.isArray(constraints) || !constraints.length) return;
  const rows = constraints.map((item) => ({
    employee_id: employeeId,
    class_id: item.class_id,
    constraint_type: item.constraint_type,
    valid_from: item.valid_from || null,
    valid_to: item.valid_to || null,
    reason: item.reason || null,
    created_by: actorId,
  }));
  await supabaseFetch('/rest/v1/hadas_employee_class_constraints', {
    method: 'POST',
    useSecret: true,
    headers: { Prefer: 'return=minimal' },
    body: rows,
  });
}

async function upsertPrivate(employeeId, adminNotes) {
  if (adminNotes === undefined) return;
  await supabaseFetch('/rest/v1/hadas_employee_private?on_conflict=employee_id', {
    method: 'POST',
    useSecret: true,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: { employee_id: employeeId, admin_notes: adminNotes || null },
  });
}

module.exports = async function handler(req, res) {
  try {
    const caller = await requireManager(req);
    const body = parseBody(req);

    if (req.method === 'POST') {
      const fullName = String(body.full_name || '').trim();
      const phone = normalizePhone(body.phone);
      const requestedPassword = String(body.password || 'hadas');
      const password = requestedPassword === 'hadas' ? 'hadas1' : requestedPassword;
      if (!fullName) return send(res, 400, { ok: false, error: 'יש להזין שם מלא' });
      if (password.length < 6) return send(res, 400, { ok: false, error: 'הסיסמה חייבת לכלול לפחות 6 תווים' });

      const { data: authUser } = await supabaseFetch('/auth/v1/admin/users', {
        method: 'POST',
        useSecret: true,
        body: {
          phone,
          password,
          phone_confirm: true,
          user_metadata: { full_name: fullName },
        },
      });
      const id = authUser.id || authUser.user?.id;
      if (!id) throw new Error('לא התקבל מזהה לעובדת החדשה');

      const profile = {
        id,
        phone,
        full_name: fullName,
        role: body.role || 'employee',
        job_title: body.job_title || 'אשת צוות',
        primary_class_id: body.primary_class_id || null,
        can_lead: Boolean(body.can_lead),
        weekly_hours: body.weekly_hours || null,
        default_start: body.default_start || '07:30',
        default_end: body.default_end || '15:30',
        fixed_day_off: body.fixed_day_off === '' || body.fixed_day_off === undefined || body.fixed_day_off === null ? null : Number(body.fixed_day_off),
        active: true,
        must_change_password: true,
      };

      try {
        await supabaseFetch('/rest/v1/hadas_profiles', {
          method: 'POST', useSecret: true, headers: { Prefer: 'return=minimal' }, body: profile,
        });
        await replaceConstraints(id, body.constraints, caller.profile.id);
        await upsertPrivate(id, body.admin_notes);
      } catch (error) {
        // ניקוי משתמש Auth במקרה שהכנסת הפרופיל נכשלה.
        try { await supabaseFetch(`/auth/v1/admin/users/${id}`, { method: 'DELETE', useSecret: true }); } catch {}
        throw error;
      }

      return send(res, 201, { ok: true, id });
    }

    if (req.method === 'PATCH') {
      const id = String(body.id || '');
      if (!id) return send(res, 400, { ok: false, error: 'חסר מזהה עובדת' });

      const { data: existingRows } = await supabaseFetch(`/rest/v1/hadas_profiles?id=eq.${encodeURIComponent(id)}&select=*&limit=1`, { useSecret: true });
      const existing = Array.isArray(existingRows) ? existingRows[0] : null;
      if (!existing) return send(res, 404, { ok: false, error: 'העובדת לא נמצאה' });

      const update = profilePayload(body);
      if (body.phone) {
        const phone = normalizePhone(body.phone);
        if (phone !== existing.phone) {
          await supabaseFetch(`/auth/v1/admin/users/${id}`, {
            method: 'PUT', useSecret: true, body: { phone, phone_confirm: true },
          });
          update.phone = phone;
        }
      }

      if (body.reset_password) {
        await supabaseFetch(`/auth/v1/admin/users/${id}`, {
          method: 'PUT', useSecret: true, body: { password: 'hadas1' },
        });
        update.must_change_password = true;
      }

      if (Object.keys(update).length) {
        await supabaseFetch(`/rest/v1/hadas_profiles?id=eq.${encodeURIComponent(id)}`, {
          method: 'PATCH', useSecret: true, headers: { Prefer: 'return=minimal' }, body: update,
        });
      }
      if (Array.isArray(body.constraints)) await replaceConstraints(id, body.constraints, caller.profile.id);
      await upsertPrivate(id, body.admin_notes);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      const id = String(body.id || req.query?.id || '');
      if (!id) return send(res, 400, { ok: false, error: 'חסר מזהה עובדת' });
      if (id === caller.profile.id) return send(res, 400, { ok: false, error: 'לא ניתן להשבית את המשתמשת המחוברת' });
      await supabaseFetch(`/rest/v1/hadas_profiles?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH', useSecret: true, headers: { Prefer: 'return=minimal' }, body: { active: false },
      });
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    handleError(res, error);
  }
};
