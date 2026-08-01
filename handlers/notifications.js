const {
  requireSession, parseBody, db, assertDb,
  send, handleError, httpError,
} = require('../lib/server');

module.exports = async function handler(req, res) {
  try {
    const caller = await requireSession(req, { csrf: req.method !== 'GET' });

    if (req.method === 'GET') {
      const rows = assertDb(await db().from('hadas_notifications').select('*')
        .eq('employee_id', caller.employee.id)
        .order('created_at', { ascending: false }).limit(150), 'לא ניתן לטעון עדכונים') || [];
      return send(res, 200, { ok: true, notifications: rows });
    }

    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
    const body = parseBody(req);
    if (body.action === 'mark_all_read') {
      assertDb(await db().from('hadas_notifications').update({ read_at: new Date().toISOString() })
        .eq('employee_id', caller.employee.id).is('read_at', 'null'), 'לא ניתן לסמן עדכונים כנקראו');
    } else if (body.action === 'mark_read') {
      if (!body.id) throw httpError(400, 'חסר עדכון');
      assertDb(await db().from('hadas_notifications').update({ read_at: new Date().toISOString() })
        .eq('id', body.id).eq('employee_id', caller.employee.id), 'לא ניתן לסמן את העדכון כנקרא');
    } else {
      throw httpError(400, 'פעולה לא מוכרת');
    }
    return send(res, 200, { ok: true });
  } catch (error) { handleError(res, error); }
};
