const {
  requireSession, parseBody, normalizePhone, db, assertDb, hashPassword,
  revokeUserSessions, emitEvent, audit, send, handleError, httpError, israelDateISO, displayPhone,
} = require('../lib/server');
const { timeToMinutes } = require('../lib/schedule');

const ALLOWED_ROLES = new Set(['admin','scheduler','employee']);
const JOB_TITLES = new Set(['סייעת/ סייע','סייעת מובילה','גננת','מנהלת מעון','מזכירה','אחות']);
const LEAD_TITLES = new Set(['סייעת מובילה','גננת']);
const NON_SCHEDULABLE_TITLES = new Set(['מזכירה','אחות','מנהלת מעון']);
const ASSIGNMENT_MODES = new Set(['fixed','rotation','substitute','no_schedule']);

function employeePayload(body) {
  const payload = {};
  const fields = ['full_name','job_title','primary_class_id','weekly_hours','max_weekly_hours','employment_percent','default_start','default_end','active','started_at','ended_at','assignment_mode'];
  for (const field of fields) if (body[field] !== undefined) payload[field] = body[field] === '' ? null : body[field];
  if (payload.full_name !== undefined) {
    payload.full_name = String(payload.full_name || '').trim();
    if (!payload.full_name) throw httpError(400,'יש להזין שם מלא');
  }
  if (payload.job_title !== undefined) {
    payload.job_title = String(payload.job_title || '').trim();
    const unchangedLegacyTitle = Boolean(body.current_job_title && payload.job_title === body.current_job_title);
    if (!JOB_TITLES.has(payload.job_title) && !unchangedLegacyTitle) throw httpError(400,'יש לבחור תפקיד מרשימת תפקידי המעון');
    if (JOB_TITLES.has(payload.job_title)) {
      payload.can_lead = LEAD_TITLES.has(payload.job_title);
      payload.is_schedulable = !NON_SCHEDULABLE_TITLES.has(payload.job_title);
    }
  }
  if (payload.weekly_hours !== undefined && payload.weekly_hours !== null) {
    payload.weekly_hours = Number(payload.weekly_hours);
    if (!Number.isFinite(payload.weekly_hours) || payload.weekly_hours < 0 || payload.weekly_hours > 60) throw httpError(400,'מספר השעות השבועיות אינו תקין');
  }
  if (payload.max_weekly_hours !== undefined && payload.max_weekly_hours !== null) {
    payload.max_weekly_hours = Number(payload.max_weekly_hours);
    if (!Number.isFinite(payload.max_weekly_hours) || payload.max_weekly_hours < 0 || payload.max_weekly_hours > 80) throw httpError(400,'מקסימום השעות השבועיות אינו תקין');
  }
  if (payload.weekly_hours != null && payload.max_weekly_hours != null && payload.max_weekly_hours < payload.weekly_hours) {
    throw httpError(400,'מקסימום השעות השבועיות לא יכול להיות נמוך מהיקף השעות המתוכנן');
  }
  if (payload.employment_percent !== undefined && payload.employment_percent !== null) {
    payload.employment_percent = Number(payload.employment_percent);
    if (!Number.isFinite(payload.employment_percent) || payload.employment_percent < 0 || payload.employment_percent > 200) throw httpError(400,'אחוז המשרה אינו תקין');
  }
  if (payload.default_start && payload.default_end && timeToMinutes(payload.default_end) <= timeToMinutes(payload.default_start)) throw httpError(400,'שעת הסיום חייבת להיות לאחר שעת ההתחלה');
  if (payload.started_at && payload.ended_at && payload.ended_at < payload.started_at) throw httpError(400,'תאריך הסיום אינו יכול להיות לפני תאריך ההתחלה');
  if (payload.assignment_mode !== undefined) {
    payload.assignment_mode = String(payload.assignment_mode || 'fixed');
    if (!ASSIGNMENT_MODES.has(payload.assignment_mode)) throw httpError(400,'סוג השיוך לכיתה אינו תקין');
  }
  const title = payload.job_title ?? body.current_job_title;
  if (title === 'גננת') {
    const primaryClassId = payload.primary_class_id ?? body.primary_class_id ?? body.current_primary_class_id ?? null;
    if (!primaryClassId) throw httpError(400,'לגננת חובה לבחור כיתה קבועה');
    payload.assignment_mode = 'fixed';
    payload.primary_class_id = primaryClassId;
    payload.is_schedulable = true;
    payload.can_lead = true;
  }
  if (NON_SCHEDULABLE_TITLES.has(title)) {
    payload.assignment_mode = 'no_schedule';
    payload.primary_class_id = null;
    payload.is_schedulable = false;
    payload.can_lead = false;
  } else if (payload.assignment_mode === 'no_schedule') {
    payload.primary_class_id = null;
    payload.is_schedulable = false;
  } else if (['rotation','substitute'].includes(payload.assignment_mode)) {
    payload.primary_class_id = null;
    payload.is_schedulable = true;
  } else if (payload.assignment_mode === 'fixed') {
    payload.is_schedulable = true;
    if (body.primary_class_id === '') payload.primary_class_id = null;
  }
  return payload;
}

function normalizeWeeklyPatterns(patterns, assignmentMode) {
  if (!Array.isArray(patterns)) return null;
  const rows = [];
  const seen = new Set();
  for (const item of patterns) {
    const weekday = Number(item.weekday);
    const dayType = String(item.day_type || '');
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw httpError(400,'יום בשבוע אינו תקין');
    if (seen.has(weekday)) throw httpError(400,'יום בשבוע הוגדר יותר מפעם אחת');
    seen.add(weekday);
    if (!dayType) continue;
    if (!['work','day_off','as_needed','avoid'].includes(dayType)) throw httpError(400,'סוג היום הקבוע אינו תקין');
    if (dayType === 'as_needed') {
      if (assignmentMode !== 'substitute') throw httpError(400,'האפשרות "לפי צורך" זמינה רק למשלימת מקום');
      rows.push({ weekday, day_type:dayType, start_time:null, end_time:null });
      continue;
    }
    if (dayType === 'avoid' && assignmentMode !== 'substitute') throw httpError(400,'האפשרות "עדיף להימנע" זמינה רק למשלימת מקום');
    if (dayType === 'day_off') {
      rows.push({ weekday, day_type:'day_off', start_time:null, end_time:null });
      continue;
    }
    const start = String(item.start_time || '').slice(0,5);
    const end = String(item.end_time || '').slice(0,5);
    if (!start || !end || timeToMinutes(end) <= timeToMinutes(start)) throw httpError(400,'יש להזין שעות תקינות לכל יום עבודה קבוע');
    if (weekday === 5 && timeToMinutes(end) > timeToMinutes('12:00')) throw httpError(400,'ביום שישי ניתן להגדיר עבודה עד 12:00');
    rows.push({ weekday, day_type:dayType === 'avoid' ? 'avoid' : 'work', start_time:start, end_time:end });
  }
  return rows;
}

async function replaceWeeklyPatterns(employeeId, patterns, assignmentMode) {
  const rows = normalizeWeeklyPatterns(patterns, assignmentMode);
  if (rows === null) return;
  assertDb(await db().from('hadas_employee_weekly_patterns').delete().eq('employee_id',employeeId), 'לא ניתן לעדכן את ימי העבודה הקבועים');
  if (rows.length) assertDb(await db().from('hadas_employee_weekly_patterns').insert(rows.map((row) => ({ ...row, employee_id:employeeId }))), 'לא ניתן לשמור את ימי העבודה הקבועים');
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


async function employeeResult(employeeId) {
  const [employeeR,userR,patternsR,constraintsR,privateR] = await Promise.all([
    db().from('hadas_employees').select('*').eq('id',employeeId).single(),
    db().from('hadas_users').select('id,phone,role,active,must_change_password,last_login_at').eq('employee_id',employeeId).single(),
    db().from('hadas_employee_weekly_patterns').select('*').eq('employee_id',employeeId).order('weekday'),
    db().from('hadas_employee_class_constraints').select('*').eq('employee_id',employeeId),
    db().from('hadas_employee_private').select('*').eq('employee_id',employeeId).maybeSingle(),
  ]);
  const employee=assertDb(employeeR,'לא ניתן לטעון את העובד לאחר השמירה');
  const user=assertDb(userR,'לא ניתן לטעון את המשתמש לאחר השמירה');
  const patterns=assertDb(patternsR,'לא ניתן לטעון ימי עבודה') || [];
  const constraints=assertDb(constraintsR,'לא ניתן לטעון אילוצים') || [];
  const privateRow=assertDb(privateR,'לא ניתן לטעון הערה') || null;
  return {
    employee:{
      ...employee,
      phone:displayPhone(user.phone || employee.contact_phone),
      role:user.role,
      user_active:user.active,
      must_change_password:user.must_change_password,
      last_login_at:user.last_login_at || null,
      admin_notes:privateRow?.admin_notes || '',
      weekly_patterns:patterns,
    },
    constraints,
  };
}

async function ensureAdminRemains(userIdToChange, nextRole, nextActive) {
  const target = assertDb(await db().from('hadas_users').select('id,role,active').eq('id',userIdToChange).maybeSingle(), 'המשתמש לא נמצא');
  if (!target || target.role !== 'admin' || (nextRole === 'admin' && nextActive !== false)) return;
  const activeAdmins = assertDb(await db().from('hadas_users').select('id').eq('role','admin').eq('active',true), 'לא ניתן לבדוק מנהלים') || [];
  if (activeAdmins.length <= 1) throw httpError(409,'חייב להישאר לפחות מנהל פעיל אחד במערכת');
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
      const employee = assertDb(await db().from('hadas_employees').insert(payload).select('*').single(), 'לא ניתן ליצור עובד');
      try {
        const user = assertDb(await db().from('hadas_users').insert({
          employee_id:employee.id,
          phone,
          password_hash:await hashPassword('hadas'),
          role,
          active:true,
          must_change_password:true,
        }).select('id').single(), 'לא ניתן ליצור משתמש');
        await replaceWeeklyPatterns(employee.id,body.weekly_patterns,employee.assignment_mode);
        await replaceConstraints(employee.id,body.constraints,caller.employee.id);
        await upsertPrivate(employee.id,body.admin_notes);
        await audit(caller.employee.id,'create','employee',employee.id,{ role });
        await emitEvent('employees');
        const result = await employeeResult(employee.id);
        return send(res,201,{ ok:true,id:employee.id,userId:user.id,...result });
      } catch (error) {
        await db().from('hadas_employees').delete().eq('id',employee.id);
        throw error;
      }
    }

    if (req.method === 'PATCH') {
      const employeeId = String(body.id || '');
      if (!employeeId) throw httpError(400,'חסר מזהה עובד');
      const employee = assertDb(await db().from('hadas_employees').select('*').eq('id',employeeId).maybeSingle(), 'העובד לא נמצא');
      if (!employee) throw httpError(404,'העובד לא נמצא');
      const user = assertDb(await db().from('hadas_users').select('*').eq('employee_id',employeeId).maybeSingle(), 'המשתמש לא נמצא');
      if (!user) throw httpError(404,'לא נמצא משתמש לכרטיס העובד');

      const nextRole = body.role !== undefined ? body.role : user.role;
      const nextActive = body.active !== undefined ? Boolean(body.active) : user.active;
      if (!ALLOWED_ROLES.has(nextRole)) throw httpError(400,'הרשאה לא תקינה');
      await ensureAdminRemains(user.id,nextRole,nextActive);
      if (employeeId === caller.employee.id && nextActive === false) throw httpError(400,'לא ניתן להשבית את המשתמש המחובר');

      const employeeUpdate = employeePayload({ ...body, current_job_title:employee.job_title, current_primary_class_id:employee.primary_class_id });
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

      await Promise.all([
        Object.keys(employeeUpdate).length ? db().from('hadas_employees').update(employeeUpdate).eq('id',employeeId).then((r)=>assertDb(r,'לא ניתן לעדכן עובד')) : Promise.resolve(),
        Object.keys(userUpdate).length ? db().from('hadas_users').update(userUpdate).eq('id',user.id).then((r)=>assertDb(r,'לא ניתן לעדכן הרשאה')) : Promise.resolve(),
        Array.isArray(body.weekly_patterns) ? replaceWeeklyPatterns(employeeId,body.weekly_patterns,employeeUpdate.assignment_mode || employee.assignment_mode) : Promise.resolve(),
        Array.isArray(body.constraints) ? replaceConstraints(employeeId,body.constraints,caller.employee.id) : Promise.resolve(),
        upsertPrivate(employeeId,body.admin_notes),
      ]);
      if (body.reset_password || body.active === false) await revokeUserSessions(user.id);
      await audit(caller.employee.id,'update','employee',employeeId,{ fields:Object.keys(body) });
      await emitEvent('employees');
      const result = await employeeResult(employeeId);
      return send(res,200,{ ok:true,...result });
    }

    if (req.method === 'DELETE') {
      const employeeId = String(body.id || req.query?.id || '');
      if (!employeeId) throw httpError(400,'חסר מזהה עובד');
      if (employeeId === caller.employee.id) throw httpError(400,'לא ניתן להשבית את המשתמש המחובר');
      const user = assertDb(await db().from('hadas_users').select('*').eq('employee_id',employeeId).maybeSingle(), 'המשתמש לא נמצא');
      if (!user) throw httpError(404,'המשתמש לא נמצא');
      await ensureAdminRemains(user.id,user.role,false);
      assertDb(await db().from('hadas_users').update({ active:false }).eq('id',user.id), 'לא ניתן להשבית משתמש');
      assertDb(await db().from('hadas_employees').update({ active:false,ended_at:israelDateISO() }).eq('id',employeeId), 'לא ניתן להשבית עובד');
      await revokeUserSessions(user.id);
      await audit(caller.employee.id,'deactivate','employee',employeeId);
      await emitEvent('employees');
      return send(res,200,{ ok:true });
    }

    return send(res,405,{ ok:false,error:'Method not allowed' });
  } catch (error) { handleError(res,error); }
};
