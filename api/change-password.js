const { parseBody, getCaller, supabaseFetch, send, handleError } = require('../lib/api-utils');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
    const caller = await getCaller(req);
    const body = parseBody(req);
    const password = String(body.password || '');
    if (password.length < 8) return send(res, 400, { ok: false, error: 'הסיסמה החדשה חייבת לכלול לפחות 8 תווים' });
    if (password.toLowerCase() === 'hadas') return send(res, 400, { ok: false, error: 'יש לבחור סיסמה אישית שאינה הסיסמה הראשונית' });

    await supabaseFetch(`/auth/v1/admin/users/${caller.profile.id}`, {
      method: 'PUT', useSecret: true, body: { password },
    });
    await supabaseFetch(`/rest/v1/hadas_profiles?id=eq.${encodeURIComponent(caller.profile.id)}`, {
      method: 'PATCH', useSecret: true, headers: { Prefer: 'return=minimal' }, body: { must_change_password: false },
    });
    send(res, 200, { ok: true });
  } catch (error) {
    handleError(res, error);
  }
};
