const { supabaseFetch, send, handleError } = require('../lib/api-utils');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'Method not allowed' });
    const { data } = await supabaseFetch('/rest/v1/hadas_profiles?select=role,active', { useSecret: true });
    const active = Array.isArray(data) ? data.filter((row) => row.active) : [];
    const hasAdmin = active.some((row) => row.role === 'admin');
    const hasScheduler = active.some((row) => row.role === 'scheduler');
    send(res, 200, { ok: true, needsBootstrap: !(hasAdmin && hasScheduler) });
  } catch (error) {
    if (error.status === 404 || /relation .*hadas_profiles.* does not exist/i.test(error.message)) {
      return send(res, 409, { ok: false, needsSchema: true, error: 'יש להריץ קודם את קובץ supabase/schema.sql' });
    }
    handleError(res, error);
  }
};
