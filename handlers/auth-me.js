const { getSession, publicProfile, send, handleError } = require('../lib/server');
module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return send(res, 405, { ok:false, error:'Method not allowed' });
    const caller = await getSession(req);
    send(res, 200, { ok:true, csrfToken:caller.session.csrf_token, profile:publicProfile(caller) });
  } catch (error) { handleError(res, error); }
};
