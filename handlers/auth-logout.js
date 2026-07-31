const { requireSession, db, clearSessionCookie, send, handleError } = require('../lib/server');
module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return send(res, 405, { ok:false, error:'Method not allowed' });
    const caller = await requireSession(req);
    await db().from('hadas_sessions').update({ revoked_at:new Date().toISOString() }).eq('id', caller.session.id);
    clearSessionCookie(res);
    send(res, 200, { ok:true });
  } catch (error) {
    clearSessionCookie(res);
    handleError(res, error);
  }
};
