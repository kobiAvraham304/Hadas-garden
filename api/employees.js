const {
  requireSession, parseBody, normalizePhone, db, assertDb, hashPassword,
  revokeUserSessions, emitEvent, audit, send, handleError, httpError, israelDateISO,
} = require('../lib/server');
const { timeToMinutes } = require('../lib/schedule');

const ALLOWED_ROLES = new Set(['admin','scheduler','employee']);

function employeePayload(body) {
  const payload = {};
  const fields = ['full_name','job_title','primary_class_id','weekly_hours','employment_percent','default_start','default_end','fixed_day_off','active','started_at','ended_at'];
  for (const field of fields) if (body[field] !== undefined) payload[field] = body[field] === '' ? null : body[field];
  if (body.can_lead !== undefined) payload.can_lead = Boolean(body.can_lead);
  if (payload.full_name !== undefined) {
    payload.full_name = String(payload.full_name || '').trim();
    if (!payload.full_name) throw httpError(400,'יש להזין שם מלא');
  }
  if (payload.fixed_day_off !== undefined && payload.fixed_day_off !== null) {
    payload.fixed_day_off = Number(payload.fixed_day_off);
    if (!Number.isInteger(payload.fixed_day_off) || payload.fixed_day_off < 0 || payload.fixed_day_off > 6) throw httpError(400,'יום חופשי אינו תקין');
  }
  if (payload.weekly_hours !== undefined && payload.weekly_hours !== null) {
    payload.weekly_hours = Number(payload.weekly_hours);
    if (!Number.isFinite(payload.weekly_hours) || payload.weekly_hours < 0 || payload.weekly_hours > 60) throw httpError(400,'מספר השעות השבועיות אינו תקין');
  }
  if (payload.employment_percent !== undefined && payload.employment_percent !== null) {
    payload.employment_percent = Number(payload.employment_percent);
    if (!Number.isFinite(payload.employment_percent) || payload.employment_percent < 0 || payload.employment_percent > 200) throw httpError(400,'אחוז המשרה אינו תקין');
  }
  if (payload.default_start && payload.default_end && timeToMinutes(payload.default_end) <= timeToMinutes(payload.default_start)) throw httpError(400,'שעת הסיום חייבת להיות לאחר שעת ההתחלה');
  if (payload.started_at && payload.ended_at && payload.ended_at < payload.started_at) throw httpError(400,'תאריך הסיום אינו יכול להיות לפני תאריך ההתחלה');
  return payload;
}

async function replaceConstraints(employeeId, constraints, actorId) {
  if (!Array.isArray(constraints)) return;
  const rows = constraints.filter((item) => item.class_id && ['preferred','avoid','forbidden'].includes(item.constraint_type)).map((item) => {
    const validFrom=item.valid_from || null, validTo=item.valid_to || null;
    if (validFrom && validTo && validTo < validFrom) throw httpError(400,'תאריך סיום האילוץ אינו יכול להיות לפני תאריך ההתחלה');
    return {
      employee_id:employeeId,
      class_id:item.class_id,
      constraint_type:item.constraint_type,
      valid_from:validFrom,
      valid_to:validTo,
      reason:String(item.reason || '').trim() || null,
      created_by:actorId,
    };
  });
  const duplicateKeys=new Set();
  for(const row of rows){
    const key=[row.class_id,row.constraint_type,row.valid_from||'',row.valid_to||''].join('|');
    if(duplicateKeys.has(key)) throw httpError(400,'קיים אילוץ כפול לאותה כיתה ותקופה');
    duplicateKeys.add(key);
  }
  assertDb(await db().from('hadas_employee_class_constraints').delete().eq('employee_id',employeeId), 'לא ניתן לעדכן אילוצים');
  if (rows.length) assertDb(await db().from('hadas_employee_class_constraints').insert(rows), 'לא ניתן לשמור אילוצים');
}

async function upsertPrivate(employeeId, notes) {
  if (notes === undefined) return;
  assertDb(await db().from('hadas_employee_private').upsert({ employee_id:employeeId, admin_notes:String(notes || '') }, { onConflict:'employee_id' }), 'לא ניתן לשמור הערה ניהולית');
}

async function ensureAdminRemains(userIdToChange, nextRole, nextActive) {
  const target = assertDb(await db().from('hadas_users').select('id,role,active').eq('id',userIdToChange).maybeSingle(), 'המשתמשת לא נמצאה');
  if (!target || target.role !== 'admin' || (nextRole === 'admin' && nextActive !== false)) return;
  const activeAdmins = assertDb(await db().from('hadas_users').select('id').eq('role','admin').eq('active',true), 'לא ניתן לבדוק מנהלות') || [];
  if (activeAdmins.length <= 1) throw httpError(409,'חייבת להישאר לפחות מנהלת פעילה אחת במערכת');
}

module.exports = async function handler(req,res) {
  try {
    const caller = await requireSession(req,{ manager:true });
    const body = parseBody(req);

    if (req.method === 'POST') {
      const phone = normalizePhone(body.phone);
      const role = ALLOWED_ROLES.has(body.role) ? body.role : 'employee';
      const payload = employeePayload({ ...body, active:true });
      payload.contact_phone = phone;
      const employee = assertDb(await db().from('hadas_employees').insert(payload).select('*').single(), 'לא ניתן ליצור עובדת');
      try {
        const user = assertDb(await db().from('hadas_users').insert({
          employee_id:employee.id,
          phone,
          password_hash:await hashPassword('hadas'),
          role,
          active:true,
          must_change_password:true,
        }).select('id').single(), 'לא ניתן ליצור משתמשת');
        await replaceConstraints(employee.id,body.constraints,caller.employee.id);
        await upsertPrivate(employee.id,body.admin_notes);
        await audit(caller.employee.id,'create','employee',employee.id,{ role });
        await emitEvent('employees');
        return send(res,201,{ ok:true,id:employee.id,userId:user.id });
      } catch (error) {
        await db().from('hadas_employees').delete().eq('id',employee.id);
        throw error;
      }
    }

    if (req.method === 'PATCH') {
      const employeeId = String(body.id || '');
      if (!employeeId) throw httpError(400,'חסר מזהה עובדת');
      const employee = assertDb(await db().from('hadas_employees').select('*').eq('id',employeeId).maybeSingle(), 'העובדת לא נמצאה');
      if (!employee) throw httpError(404,'העובדת לא נמצאה');
      const user = assertDb(await db().from('hadas_users').select('*').eq('employee_id',employeeId).maybeSingle(), 'המשתמשת לא נמצאה');
      if (!user) throw httpError(404,'לא נמצא משתמש לכרטיס העובדת');

      const nextRole = body.role !== undefined ? body.role : user.role;
      const nextActive = body.active !== undefined ? Boolean(body.active) : user.active;
      if (!ALLOWED_ROLES.has(nextRole)) throw httpError(400,'הרשאה לא תקינה');
      await ensureAdminRemains(user.id,nextRole,nextActive);
      if (employeeId === caller.employee.id && nextActive === false) throw httpError(400,'לא ניתן להשבית את המשתמשת המחוברת');

      const employeeUpdate = employeePayload(body);
      const userUpdate = {};
      if (body.phone !== undefined) {
        const phone = normalizePhone(body.phone);
        userUpdate.phone = phone;
        employeeUpdate.contact_phone = phone;
      }
      if (body.role !== undefined) userUpdate.role = nextRole;
      if (body.active !== undefined) {
        userUpdate.active = nextActive;
        employeeUpdate.active = nextActive;
        if (!nextActive) employeeUpdate.ended_at = body.ended_at || israelDateISO();
        else if (body.ended_at === undefined) employeeUpdate.ended_at = null;
      }
      if (body.reset_password) {
        userUpdate.password_hash = await hashPassword('hadas');
        userUpdate.must_change_password = true;
        userUpdate.password_changed_at = null;
      }

      if (Object.keys(employeeUpdate).length) assertDb(await db().from('hadas_employees').update(employeeUpdate).eq('id',employeeId), 'לא ניתן לעדכן עובדת');
      if (Object.keys(userUpdate).length) assertDb(await db().from('hadas_users').update(userUpdate).eq('id',user.id), 'לא ניתן לעדכן הרשאה');
      if (Array.isArray(body.constraints)) await replaceConstraints(employeeId,body.constraints,caller.employee.id);
      await upsertPrivate(employeeId,body.admin_notes);
      if (body.reset_password || body.active === false) await revokeUserSessions(user.id);
      await audit(caller.employee.id,'update','employee',employeeId,{ fields:Object.keys(body) });
      await emitEvent('employees');
      return send(res,200,{ ok:true });
    }

    if (req.method === 'DELETE') {
      const employeeId = String(body.id || req.query?.id || '');
      if (!employeeId) throw httpError(400,'חסר מזהה עובדת');
      if (employeeId === caller.employee.id) throw httpError(400,'לא ניתן להשבית את המשתמשת המחוברת');
      const user = assertDb(await db().from('hadas_users').select('*').eq('employee_id',employeeId).maybeSingle(), 'המשתמשת לא נמצאה');
      if (!user) throw httpError(404,'המשתמשת לא נמצאה');
      await ensureAdminRemains(user.id,user.role,false);
      assertDb(await db().from('hadas_users').update({ active:false }).eq('id',user.id), 'לא ניתן להשבית משתמשת');
      assertDb(await db().from('hadas_employees').update({ active:false,ended_at:israelDateISO() }).eq('id',employeeId), 'לא ניתן להשבית עובדת');
      await revokeUserSessions(user.id);
      await audit(caller.employee.id,'deactivate','employee',employeeId);
      await emitEvent('employees');
      return send(res,200,{ ok:true });
    }

    return send(res,405,{ ok:false,error:'Method not allowed' });
  } catch (error) { handleError(res,error); }
};
