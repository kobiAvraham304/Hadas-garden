const {
  requireSession, parseBody, db, assertDb, emitEvent, audit,
  send, handleError, httpError,
} = require('../lib/server');
const { validateWeek, timeToMinutes } = require('../lib/schedule');

function addDays(dateString, days) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0,10);
}

function getSunday(dateString) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0,10);
}

async function validateShift(payload, id, overrideDayOff=false) {
  if (!payload.shift_date || !payload.class_id || !payload.employee_id) throw httpError(400,'חסרים פרטי שיבוץ');
  if (!payload.start_time || !payload.end_time || timeToMinutes(payload.end_time) <= timeToMinutes(payload.start_time)) throw httpError(400,'שעות השיבוץ אינן תקינות');
  const [employeeR,classR,settingsR] = await Promise.all([
    db().from('hadas_employees').select('*').eq('id',payload.employee_id).maybeSingle(),
    db().from('hadas_classes').select('*').eq('id',payload.class_id).maybeSingle(),
    db().from('hadas_app_settings').select('*').eq('id',1).maybeSingle(),
  ]);
  const employee = assertDb(employeeR,'העובדת לא נמצאה');
  const classItem = assertDb(classR,'הכיתה לא נמצאה');
  const settings = assertDb(settingsR,'הגדרות המערכת לא נמצאו');
  if (!employee?.active) throw httpError(409,'העובדת אינה פעילה');
  if (!classItem?.active) throw httpError(409,'הכיתה אינה פעילה');
  if (timeToMinutes(payload.start_time) < timeToMinutes(settings.opening_time) || timeToMinutes(payload.end_time) > timeToMinutes(settings.closing_time)) {
    throw httpError(409,`השיבוץ חייב להיות בין ${String(settings.opening_time).slice(0,5)} ל-${String(settings.closing_time).slice(0,5)}`);
  }
  const constraintRows = assertDb(
    await db().from('hadas_employee_class_constraints')
      .select('id,reason,valid_from,valid_to')
      .eq('employee_id',payload.employee_id)
      .eq('class_id',payload.class_id)
      .eq('constraint_type','forbidden'),
    'בדיקת אילוצים נכשלה'
  ) || [];
  const forbidden = constraintRows.find((item) =>
    (!item.valid_from || item.valid_from <= payload.shift_date)
    && (!item.valid_to || item.valid_to >= payload.shift_date)
  );
  if (forbidden) throw httpError(409, forbidden.reason ? `קיים איסור שיבוץ בכיתה: ${forbidden.reason}` : 'קיים איסור לשבץ את העובדת בכיתה זו');
  const day = new Date(`${payload.shift_date}T12:00:00Z`).getUTCDay();
  if (employee.fixed_day_off === day && !overrideDayOff) throw httpError(409,'זהו היום החופשי הקבוע של העובדת. ניתן לשמור רק לאחר אישור חריגה');
  const existingQuery = db().from('hadas_shifts').select('id').eq('employee_id',payload.employee_id).eq('shift_date',payload.shift_date).lt('start_time',payload.end_time).gt('end_time',payload.start_time);
  if (id) existingQuery.neq('id',id);
  const overlaps = assertDb(await existingQuery,'בדיקת חפיפה נכשלה') || [];
  if (overlaps.length) throw httpError(409,'העובדת כבר משובצת בשעות חופפות');
  return { employee,classItem };
}

async function getWeekValidation(weekStart) {
  const weekEnd = addDays(weekStart,5);
  const [shiftsR,classesR,employeesR,settingsR,constraintsR] = await Promise.all([
    db().from('hadas_shifts').select('*').gte('shift_date',weekStart).lte('shift_date',weekEnd),
    db().from('hadas_classes').select('*').eq('active',true),
    db().from('hadas_employees').select('*').eq('active',true),
    db().from('hadas_app_settings').select('*').eq('id',1).single(),
    db().from('hadas_employee_class_constraints').select('*'),
  ]);
  const shifts = assertDb(shiftsR,'לא ניתן לטעון שיבוצים') || [];
  return {
    shifts,
    validation:validateWeek({
      shifts,
      classes:assertDb(classesR,'לא ניתן לטעון כיתות') || [],
      employees:assertDb(employeesR,'לא ניתן לטעון עובדות') || [],
      settings:assertDb(settingsR,'לא ניתן לטעון הגדרות') || {},
      constraints:assertDb(constraintsR,'לא ניתן לטעון אילוצים') || [],
      weekStart,
    }),
  };
}

module.exports = async function handler(req,res) {
  try {
    const caller = await requireSession(req,{ manager:req.method !== 'POST' || parseBody(req).action !== 'ack' });
    const body = parseBody(req);

    if (req.method === 'POST' && body.action === 'ack') {
      const weekStart = getSunday(String(body.week_start || new Date().toISOString().slice(0,10)));
      assertDb(await db().from('hadas_schedule_acknowledgements').upsert({ employee_id:caller.employee.id,week_start:weekStart,acknowledged_at:new Date().toISOString() },{ onConflict:'employee_id,week_start' }), 'לא ניתן לשמור אישור קריאה');
      await emitEvent('schedule_ack');
      return send(res,200,{ ok:true });
    }

    if (req.method === 'POST' && body.action === 'validate') {
      const weekStart = getSunday(String(body.week_start));
      const result = await getWeekValidation(weekStart);
      return send(res,200,{ ok:true,...result.validation });
    }

    if (req.method === 'POST' && body.action === 'publish') {
      const weekStart = getSunday(String(body.week_start));
      const status = body.status;
      if (!['temporary','final'].includes(status)) throw httpError(400,'מצב פרסום לא תקין');
      const { shifts,validation } = await getWeekValidation(weekStart);
      if (!shifts.length) throw httpError(409,'אין שיבוצים בשבוע זה');
      if (status === 'final' && validation.errors.length) throw httpError(409,'לא ניתן לפרסם שיבוץ סופי לפני טיפול בשגיאות',validation);
      if (status === 'temporary' && validation.errors.length && !body.force) {
        return send(res,409,{ ok:false,error:'בשיבוץ קיימות שגיאות. ניתן לפרסם זמנית רק לאחר אישור חריגה.',validation,canForce:true });
      }
      const weekEnd = addDays(weekStart,5);
      assertDb(await db().from('hadas_shifts').update({ status }).gte('shift_date',weekStart).lte('shift_date',weekEnd), 'לא ניתן לפרסם את השבוע');
      await audit(caller.employee.id,'publish','schedule',weekStart,{ status,errors:validation.errors.length,warnings:validation.warnings.length });
      await emitEvent('shifts');
      return send(res,200,{ ok:true,validation });
    }

    if (req.method === 'POST' && body.action === 'copy_previous') {
      const weekStart = getSunday(String(body.week_start));
      const previousStart = addDays(weekStart,-7);
      const previousEnd = addDays(previousStart,5);
      const previous = assertDb(await db().from('hadas_shifts').select('*').gte('shift_date',previousStart).lte('shift_date',previousEnd), 'לא ניתן לטעון שבוע קודם') || [];
      if (!previous.length) throw httpError(409,'לא נמצאו שיבוצים בשבוע הקודם');
      const existing = assertDb(await db().from('hadas_shifts').select('id').gte('shift_date',weekStart).lte('shift_date',addDays(weekStart,5)), 'לא ניתן לבדוק את השבוע') || [];
      if (existing.length && !body.force) throw httpError(409,'כבר קיימים שיבוצים בשבוע זה');
      if (existing.length) assertDb(await db().from('hadas_shifts').delete().gte('shift_date',weekStart).lte('shift_date',addDays(weekStart,5)), 'לא ניתן לנקות את השבוע');
      const rows = previous.map((shift) => ({
        shift_date:addDays(shift.shift_date,7), class_id:shift.class_id, employee_id:shift.employee_id,
        start_time:shift.start_time, end_time:shift.end_time, shift_role:shift.shift_role,
        status:'draft', public_note:shift.public_note, created_by:caller.employee.id,
      }));
      assertDb(await db().from('hadas_shifts').insert(rows), 'לא ניתן להעתיק את השבוע');
      await audit(caller.employee.id,'copy_previous','schedule',weekStart,{ count:rows.length });
      await emitEvent('shifts');
      return send(res,201,{ ok:true,count:rows.length });
    }

    if (req.method === 'POST') {
      const payload = {
        shift_date:String(body.shift_date || ''), class_id:body.class_id, employee_id:body.employee_id,
        start_time:body.start_time, end_time:body.end_time,
        shift_role:['teacher','lead','staff','replacement'].includes(body.shift_role) ? body.shift_role : 'staff',
        status:['draft','temporary','final'].includes(body.status) ? body.status : 'draft',
        public_note:String(body.public_note || '').trim() || null,
        created_by:caller.employee.id,
      };
      await validateShift(payload,null,Boolean(body.override_day_off));
      const shift = assertDb(await db().from('hadas_shifts').insert(payload).select('*').single(), 'לא ניתן לשמור שיבוץ');
      await audit(caller.employee.id,'create','shift',shift.id,payload);
      await emitEvent('shifts');
      return send(res,201,{ ok:true,shift });
    }

    if (req.method === 'PATCH') {
      const id = String(body.id || '');
      if (!id) throw httpError(400,'חסר מזהה שיבוץ');
      const current = assertDb(await db().from('hadas_shifts').select('*').eq('id',id).maybeSingle(), 'השיבוץ לא נמצא');
      if (!current) throw httpError(404,'השיבוץ לא נמצא');
      const payload = {
        shift_date:body.shift_date || current.shift_date,
        class_id:body.class_id || current.class_id,
        employee_id:body.employee_id || current.employee_id,
        start_time:body.start_time || current.start_time,
        end_time:body.end_time || current.end_time,
        shift_role:body.shift_role || current.shift_role,
        status:body.status || current.status,
        public_note:body.public_note === undefined ? current.public_note : (String(body.public_note || '').trim() || null),
      };
      await validateShift(payload,id,Boolean(body.override_day_off));
      assertDb(await db().from('hadas_shifts').update(payload).eq('id',id), 'לא ניתן לעדכן שיבוץ');
      await audit(caller.employee.id,'update','shift',id,payload);
      await emitEvent('shifts');
      return send(res,200,{ ok:true });
    }

    if (req.method === 'DELETE') {
      const id = String(body.id || req.query?.id || '');
      if (!id) throw httpError(400,'חסר מזהה שיבוץ');
      assertDb(await db().from('hadas_shifts').delete().eq('id',id), 'לא ניתן למחוק שיבוץ');
      await audit(caller.employee.id,'delete','shift',id);
      await emitEvent('shifts');
      return send(res,200,{ ok:true });
    }

    return send(res,405,{ ok:false,error:'Method not allowed' });
  } catch (error) { handleError(res,error); }
};
