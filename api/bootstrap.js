const { getEnv, normalizePhone, parseBody, supabaseFetch, send, handleError } = require('../lib/api-utils');

async function listAuthUsers() {
  const { data } = await supabaseFetch('/auth/v1/admin/users?page=1&per_page=1000', { useSecret: true });
  return Array.isArray(data) ? data : (data?.users || []);
}

async function createOrFindAuthUser({ phone, password, fullName }) {
  try {
    const { data } = await supabaseFetch('/auth/v1/admin/users', {
      method: 'POST',
      useSecret: true,
      body: {
        phone,
        password,
        phone_confirm: true,
        user_metadata: { full_name: fullName },
      },
    });
    return { user: data.user || data, created: true };
  } catch (error) {
    if (![400, 409, 422].includes(Number(error.status))) throw error;
    const users = await listAuthUsers();
    const existing = users.find((user) => user.phone === phone);
    if (!existing) throw error;
    return { user: existing, created: false };
  }
}

async function getClassId(slug) {
  const { data } = await supabaseFetch(`/rest/v1/hadas_classes?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`, { useSecret: true });
  return Array.isArray(data) && data[0] ? data[0].id : null;
}

async function insertProfile(profile) {
  await supabaseFetch('/rest/v1/hadas_profiles', {
    method: 'POST',
    useSecret: true,
    headers: { Prefer: 'return=minimal' },
    body: profile,
  });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
    const env = getEnv();
    const body = parseBody(req);
    if (!env.bootstrapToken || body.bootstrapToken !== env.bootstrapToken) {
      return send(res, 403, { ok: false, error: 'קוד ההקמה שגוי' });
    }

    const { data: existingProfiles } = await supabaseFetch('/rest/v1/hadas_profiles?select=id,phone,role,active', { useSecret: true });
    const existing = Array.isArray(existingProfiles) ? existingProfiles : [];
    const hasAdmin = existing.some((row) => row.active && row.role === 'admin');
    const hasScheduler = existing.some((row) => row.active && row.role === 'scheduler');
    if (hasAdmin && hasScheduler) {
      return send(res, 409, { ok: false, error: 'המערכת כבר הוקמה' });
    }

    const requestedPassword = String(body.password || 'hadas');
    const password = requestedPassword === 'hadas' ? 'hadas1' : requestedPassword;
    if (password.length < 6) return send(res, 400, { ok: false, error: 'הסיסמה הראשונית חייבת לכלול לפחות 6 תווים' });

    const odemClassId = await getClassId('odem');
    const users = [
      {
        fullName: 'אילנית',
        phone: normalizePhone(body.ilanitPhone),
        role: 'admin',
        jobTitle: 'מנהלת מעון',
        primaryClassId: null,
        canLead: true,
      },
      {
        fullName: 'לינור אברהם',
        phone: normalizePhone(body.linorPhone),
        role: 'scheduler',
        jobTitle: 'גננת ואחראית שיבוץ',
        primaryClassId: odemClassId,
        canLead: true,
      },
    ];

    const created = [];
    const skipped = [];
    for (const item of users) {
      const alreadyExists = existing.find((row) => row.phone === item.phone || row.role === item.role);
      if (alreadyExists) {
        skipped.push({ id: alreadyExists.id, fullName: item.fullName, phone: item.phone });
        continue;
      }

      const authResult = await createOrFindAuthUser({ phone: item.phone, password, fullName: item.fullName });
      const userId = authResult.user?.id;
      if (!userId) throw new Error(`לא התקבל מזהה משתמש עבור ${item.fullName}`);
      try {
        await insertProfile({
          id: userId,
          phone: item.phone,
          full_name: item.fullName,
          role: item.role,
          job_title: item.jobTitle,
          primary_class_id: item.primaryClassId,
          can_lead: item.canLead,
          active: true,
          must_change_password: true,
        });
      } catch (error) {
        if (authResult.created) {
          try { await supabaseFetch(`/auth/v1/admin/users/${userId}`, { method: 'DELETE', useSecret: true }); } catch {}
        }
        throw error;
      }
      created.push({ id: userId, fullName: item.fullName, phone: item.phone });
    }

    send(res, 201, { ok: true, created, skipped });
  } catch (error) {
    handleError(res, error);
  }
};
