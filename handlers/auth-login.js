const {
  db, parseBody, normalizePhone, sha256, clientIp, assertDb, verifyPassword,
  createSession, publicProfile, send, handleError, httpError, audit, verifyOrigin,
} = require('../lib/server');

const DUMMY_HASH = 'scrypt$16384$8$1$KyCF0l8tln7rHAbPj61v2A$v6wnFmsyEXT_fYqKgzxaHKF8ZBikwrpMiTJCgCpB-U0';

async function recordFailure(key, current) {
  const now = Date.now();
  const recent = current?.last_failed_at && now - Date.parse(current.last_failed_at) < 15 * 60_000;
  const failed = recent ? Number(current.failed_count || 0) + 1 : 1;
  const blockedUntil = failed >= 5 ? new Date(now + 15 * 60_000).toISOString() : null;
  await db().from('hadas_login_security').upsert({
    security_key:key,
    failed_count:failed,
    last_failed_at:new Date(now).toISOString(),
    blocked_until:blockedUntil,
    updated_at:new Date(now).toISOString(),
  });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return send(res, 405, { ok:false, error:'Method not allowed' });
    verifyOrigin(req);
    const body = parseBody(req);
    const phone = normalizePhone(body.phone);
    const password = String(body.password || '');
    if (!password) throw httpError(400, 'יש להזין סיסמה');
    const securityKey = sha256(`${phone}|${clientIp(req)}`);
    const security = assertDb(await db().from('hadas_login_security').select('*').eq('security_key', securityKey).maybeSingle(), 'בדיקת האבטחה נכשלה');
    if (security?.blocked_until && Date.parse(security.blocked_until) > Date.now()) {
      throw httpError(429, 'בוצעו יותר מדי ניסיונות. נסו שוב בעוד 15 דקות');
    }

    const user = assertDb(await db().from('hadas_users').select('*').eq('phone', phone).maybeSingle(), 'ההתחברות נכשלה');
    const valid = await verifyPassword(password, user?.password_hash || DUMMY_HASH);
    if (!user || !valid || !user.active) {
      await recordFailure(securityKey, security);
      throw httpError(401, 'מספר הטלפון או הסיסמה שגויים');
    }
    const employee = assertDb(await db().from('hadas_employees').select('*').eq('id', user.employee_id).maybeSingle(), 'כרטיס העובד לא נמצא');
    if (!employee?.active) throw httpError(403, 'העובד אינו פעיל במערכת');

    await db().from('hadas_login_security').delete().eq('security_key', securityKey);
    const csrfToken = await createSession(req, res, user.id);
    await db().from('hadas_users').update({ last_login_at:new Date().toISOString() }).eq('id', user.id);
    await audit(employee.id, 'login', 'user', user.id);
    send(res, 200, { ok:true, csrfToken, profile:publicProfile({ user, employee }) });
  } catch (error) { handleError(res, error); }
};
