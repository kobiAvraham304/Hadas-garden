const {
  getEnv, db, parseBody, normalizePhone, assertDb, hashPassword,
  send, handleError, verifyOrigin, emitEvent, audit, httpError,
} = require('../lib/server');

async function createAccount({ fullName, phone, role, jobTitle, primaryClassId, canLead }) {
  const employee = assertDb(await db().from('hadas_employees').insert({
    full_name: fullName,
    contact_phone: phone,
    job_title: jobTitle,
    primary_class_id: primaryClassId || null,
    can_lead: Boolean(canLead),
    active: true,
  }).select('*').single(), 'לא ניתן ליצור כרטיס עובדת');
  try {
    const user = assertDb(await db().from('hadas_users').insert({
      employee_id: employee.id,
      phone,
      password_hash: await hashPassword('hadas'),
      role,
      active: true,
      must_change_password: true,
    }).select('id').single(), 'לא ניתן ליצור משתמשת');
    return { employee, user };
  } catch (error) {
    await db().from('hadas_employees').delete().eq('id', employee.id);
    throw error;
  }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return send(res, 405, { ok:false, error:'Method not allowed' });
    verifyOrigin(req);
    const env = getEnv();
    const body = parseBody(req);
    if (!env.bootstrapToken || body.bootstrapToken !== env.bootstrapToken) throw httpError(403, 'קוד ההקמה שגוי');

    const users = assertDb(await db().from('hadas_users').select('role,active'), 'לא ניתן לבדוק את מצב המערכת') || [];
    if (users.some((row) => row.active && row.role === 'admin') && users.some((row) => row.active && row.role === 'scheduler')) {
      throw httpError(409, 'המערכת כבר הוקמה');
    }

    const ilanitPhone = normalizePhone(body.ilanitPhone);
    const linorPhone = normalizePhone(body.linorPhone);
    if (ilanitPhone === linorPhone) throw httpError(400, 'יש להזין מספר טלפון שונה לכל משתמשת');
    const odem = assertDb(await db().from('hadas_classes').select('id').eq('slug','odem').maybeSingle(), 'כיתת אודם לא נמצאה');

    const created = [];
    try {
      created.push(await createAccount({
        fullName:'אילנית', phone:ilanitPhone, role:'admin', jobTitle:'מנהלת מעון', primaryClassId:null, canLead:true,
      }));
      created.push(await createAccount({
        fullName:'לינור אברהם', phone:linorPhone, role:'scheduler', jobTitle:'גננת ואחראית שיבוץ', primaryClassId:odem?.id || null, canLead:true,
      }));
    } catch (error) {
      for (const item of created) {
        await db().from('hadas_users').delete().eq('id', item.user.id);
        await db().from('hadas_employees').delete().eq('id', item.employee.id);
      }
      throw error;
    }
    await emitEvent('bootstrap');
    await audit(null, 'bootstrap', 'system', 'initial', { employees: created.map((item) => item.employee.id) });
    send(res, 201, { ok:true, message:'המערכת הוקמה. הסיסמה הראשונית היא hadas.' });
  } catch (error) { handleError(res, error); }
};
