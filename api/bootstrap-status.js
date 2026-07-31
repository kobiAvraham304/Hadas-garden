const { db, assertDb, send, handleError } = require('../lib/server');
module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return send(res, 405, { ok:false, error:'Method not allowed' });
    const result = await db().from('hadas_users').select('role,active');
    if (result.error && /does not exist|schema cache/i.test(result.error.message || '')) {
      return send(res, 409, { ok:false, needsSchema:true, error:'יש להריץ קודם את supabase/schema.sql' });
    }
    const rows = assertDb(result, 'לא ניתן לבדוק את מצב ההקמה') || [];
    const hasAdmin = rows.some((row) => row.active && row.role === 'admin');
    const hasScheduler = rows.some((row) => row.active && row.role === 'scheduler');
    send(res, 200, { ok:true, needsBootstrap:!(hasAdmin && hasScheduler) });
  } catch (error) { handleError(res, error); }
};
