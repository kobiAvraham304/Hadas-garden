const { send, handleError } = require('../lib/server');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return send(res, 405, { ok:false, error:'Method not allowed' });
    const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const supabasePublishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || '');
    if (!supabaseUrl || !supabasePublishableKey) {
      return send(res, 503, { ok:false, error:'חסרים משתני החיבור ל-Supabase ב-Vercel' });
    }
    send(res, 200, {
      ok:true,
      supabaseUrl,
      supabasePublishableKey,
      version:'0.13.0',
      healthUrl:'/health',
    });
  } catch (error) { handleError(res, error); }
};
