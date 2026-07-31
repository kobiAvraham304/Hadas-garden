const { getEnv, send, handleError } = require('../lib/api-utils');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'Method not allowed' });
    const env = getEnv();
    send(res, 200, {
      ok: true,
      supabaseUrl: env.url,
      supabasePublishableKey: env.publicKey,
    });
  } catch (error) {
    handleError(res, error);
  }
};
