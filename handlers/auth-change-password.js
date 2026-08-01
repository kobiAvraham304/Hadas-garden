const {
  requireSession, parseBody, hashPassword, db, assertDb, revokeUserSessions,
  createSession, clearSessionCookie, send, handleError, httpError, audit, publicProfile,
} = require('../lib/server');
module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return send(res, 405, { ok:false, error:'Method not allowed' });
    const caller = await requireSession(req);
    const body = parseBody(req);
    const password = String(body.password || '');
    if (password.length < 8) throw httpError(400, 'הסיסמה החדשה חייבת לכלול לפחות 8 תווים');
    if (password.toLowerCase() === 'hadas') throw httpError(400, 'יש לבחור סיסמה אישית שאינה הסיסמה הראשונית');
    const passwordHash = await hashPassword(password);
    assertDb(await db().from('hadas_users').update({
      password_hash:passwordHash,
      must_change_password:false,
      password_changed_at:new Date().toISOString(),
    }).eq('id', caller.user.id), 'לא ניתן לשנות את הסיסמה');
    await revokeUserSessions(caller.user.id);
    clearSessionCookie(res);
    const csrfToken = await createSession(req, res, caller.user.id);
    await audit(caller.employee.id, 'change_password', 'user', caller.user.id);
    send(res, 200, { ok:true, csrfToken, profile:{ ...publicProfile(caller), must_change_password:false } });
  } catch (error) { handleError(res, error); }
};
