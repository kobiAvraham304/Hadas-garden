const { db, getSession, requireSession, publicProfile, send, handleError, audit, assertDb, parseBody } = require('../lib/server');

function profilePayload(caller) {
  return { ...publicProfile(caller), onboarding_completed:Boolean(caller.user.onboarding_completed_at) };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const caller = await getSession(req);
      return send(res, 200, { ok:true, csrfToken:caller.session.csrf_token, profile:profilePayload(caller) });
    }

    if (req.method === 'PATCH') {
      const caller = await requireSession(req);
      const body = parseBody(req);
      if (body.action !== 'complete_onboarding') return send(res, 400, { ok:false, error:'פעולת משתמש אינה מוכרת' });
      const completedAt = new Date().toISOString();
      assertDb(await db().from('hadas_users').update({ onboarding_completed_at:completedAt, updated_at:completedAt }).eq('id', caller.user.id), 'לא ניתן לשמור את סיום ההדרכה');
      caller.user.onboarding_completed_at = completedAt;
      await audit(caller.employee.id, 'complete_onboarding', 'user', caller.user.id);
      return send(res, 200, { ok:true, profile:profilePayload(caller) });
    }

    return send(res, 405, { ok:false, error:'Method not allowed' });
  } catch (error) { handleError(res, error); }
};