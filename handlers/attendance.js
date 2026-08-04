const {
  requireSession, parseBody, db, assertDb, emitEvent, audit,
  send, handleError, httpError,
} = require('../lib/server');
const { timeToMinutes } = require('../lib/schedule');

const ATTENDANCE_STATUSES = new Set(['scheduled','present','late','left_early','absent','sick','replacement']);
const OPERATION_BY_STATUS = Object.freeze({ sick:'sick', absent:'absent', late:'late', left_early:'early_release' });

function shortTime(value) { return value ? String(value).slice(0,5) : null; }
function operationPayload(status, shift, actualStart, actualEnd, note, employeeId) {
  const operationType = OPERATION_BY_STATUS[status];
  if (!operationType) return null;
  return {
    operation_date:shift.shift_date,
    shift_id:shift.id,
    employee_id:shift.employee_id,
    class_id:shift.class_id,
    operation_type:operationType,
    start_time:operationType === 'late' ? actualStart : shortTime(shift.start_time),
    end_time:operationType === 'early_release' ? actualEnd : shortTime(shift.end_time),
    note:note || null,
    source:'attendance',
    created_by:employeeId,
  };
}
function operationChanged(existing, payload) {
  return existing.operation_type !== payload.operation_type
    || shortTime(existing.start_time) !== shortTime(payload.start_time)
    || shortTime(existing.end_time) !== shortTime(payload.end_time);
}
async function syncDailyOperation({ shift, status, actualStart, actualEnd, note, callerId }) {
  const existing = assertDb(
    await db().from('hadas_daily_operations').select('*').eq('shift_id', shift.id).eq('operation_date', shift.shift_date).maybeSingle(),
    'לא ניתן לסנכרן את התפעול היומי',
  );
  const payload = operationPayload(status, shift, actualStart, actualEnd, note, callerId);
  if (!payload) {
    if (existing?.source === 'attendance') {
      assertDb(await db().from('hadas_daily_operations').delete().eq('id', existing.id), 'לא ניתן להסיר אירוע תפעולי שכבר אינו רלוונטי');
      return { action:'deleted', operation:null };
    }
    return { action:'unchanged', operation:existing || null };
  }
  if (!existing) {
    const operation = assertDb(await db().from('hadas_daily_operations').insert(payload).select('*').single(), 'לא ניתן ליצור אירוע בתפעול היומי');
    return { action:'created', operation };
  }
  const changed = operationChanged(existing, payload);
  const update = {
    operation_type:payload.operation_type,
    start_time:payload.start_time,
    end_time:payload.end_time,
    note:payload.note,
    source:existing.source === 'manual' ? 'manual' : 'attendance',
  };
  if (changed) Object.assign(update, {
    status:'open', replacement_employee_id:null, replacement_from_class_id:null,
    replacement_type:null, replacement_start:null, replacement_end:null,
    resolved_by:null, resolved_at:null,
  });
  const operation = assertDb(await db().from('hadas_daily_operations').update(update).eq('id', existing.id).select('*').single(), 'לא ניתן לעדכן את התפעול היומי');
  return { action:changed ? 'updated' : 'unchanged', operation };
}

module.exports = async function handler(req,res) {
  try {
    if (req.method !== 'POST') return send(res,405,{ ok:false,error:'Method not allowed' });
    const caller = await requireSession(req,{ manager:true });
    const body = parseBody(req);

    if (body.action === 'mark_all_present') {
      const date = String(body.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400,'יש לבחור תאריך תקין');
      let query = db().from('hadas_shifts').select('*').eq('shift_date', date);
      if (body.class_id) query = query.eq('class_id', body.class_id);
      const shifts = assertDb(await query, 'לא ניתן לטעון את שיבוצי היום') || [];
      if (!shifts.length) throw httpError(409,'אין שיבוצים לסימון בתאריך שנבחר');
      const existing = assertDb(await db().from('hadas_attendance').select('*').in('shift_id', shifts.map((row) => row.id)), 'לא ניתן לבדוק נוכחות קיימת') || [];
      const existingMap = new Map(existing.map((row) => [row.shift_id,row]));
      const rows = shifts.filter((shift) => !existingMap.has(shift.id) || existingMap.get(shift.id).status === 'scheduled').map((shift) => ({
        shift_id:shift.id, employee_id:shift.employee_id, attendance_date:shift.shift_date,
        actual_start:shift.start_time, actual_end:shift.end_time, status:'present', note:null, updated_by:caller.employee.id,
      }));
      if (rows.length) assertDb(await db().from('hadas_attendance').upsert(rows,{ onConflict:'shift_id' }), 'לא ניתן לסמן נוכחות מרוכזת');
      const attendanceSourceOps = assertDb(await db().from('hadas_daily_operations').select('id,shift_id').eq('operation_date',date).eq('source','attendance'), 'לא ניתן לנקות דיווחי תפעול ישנים') || [];
      const affectedIds = new Set(rows.map((row) => row.shift_id));
      const deleteIds = attendanceSourceOps.filter((row) => affectedIds.has(row.shift_id)).map((row) => row.id);
      if (deleteIds.length) assertDb(await db().from('hadas_daily_operations').delete().in('id',deleteIds), 'לא ניתן לנקות דיווחי תפעול ישנים');
      await audit(caller.employee.id,'bulk_present','attendance',date,{ count:rows.length, class_id:body.class_id || null });
      await Promise.all([emitEvent('attendance'),emitEvent('daily_operations')]);
      return send(res,200,{ ok:true,count:rows.length });
    }

    if (!body.shift_id) throw httpError(400,'חסר שיבוץ');
    const shift = assertDb(await db().from('hadas_shifts').select('*').eq('id',body.shift_id).maybeSingle(),'השיבוץ לא נמצא');
    if (!shift) throw httpError(404,'השיבוץ לא נמצא');
    const status = ATTENDANCE_STATUSES.has(body.status) ? body.status : 'scheduled';
    let actualStart = body.actual_start || null;
    let actualEnd = body.actual_end || null;
    if (['absent','sick'].includes(status)) { actualStart=null; actualEnd=null; }
    if (status === 'late' && !actualStart) throw httpError(400,'באיחור יש להזין שעת הגעה בפועל');
    if (status === 'left_early' && !actualEnd) throw httpError(400,'בשחרור מוקדם יש להזין שעת יציאה בפועל');
    if ((actualStart && !actualEnd) || (!actualStart && actualEnd)) {
      if (status === 'late') actualEnd = shortTime(shift.end_time);
      else if (status === 'left_early') actualStart = shortTime(shift.start_time);
      else throw httpError(400,'יש להזין גם שעת התחלה וגם שעת סיום');
    }
    if (actualStart && timeToMinutes(actualEnd) <= timeToMinutes(actualStart)) throw httpError(400,'שעת הסיום בפועל חייבת להיות לאחר שעת ההתחלה');
    if (status === 'late' && timeToMinutes(actualStart) <= timeToMinutes(shift.start_time)) throw httpError(400,'שעת ההגעה באיחור חייבת להיות לאחר תחילת השיבוץ');
    if (status === 'left_early' && timeToMinutes(actualEnd) >= timeToMinutes(shift.end_time)) throw httpError(400,'שעת השחרור המוקדם חייבת להיות לפני סיום השיבוץ');
    const note = String(body.note || '').trim() || null;
    const row = {
      shift_id:shift.id, employee_id:shift.employee_id, attendance_date:shift.shift_date,
      actual_start:actualStart, actual_end:actualEnd, status, note, updated_by:caller.employee.id,
    };
    const attendance = assertDb(await db().from('hadas_attendance').upsert(row,{ onConflict:'shift_id' }).select('*').single(),'לא ניתן לשמור נוכחות');
    const daily = await syncDailyOperation({ shift,status,actualStart,actualEnd,note,callerId:caller.employee.id });
    await audit(caller.employee.id,'upsert','attendance',shift.id,{ status,daily_action:daily.action });
    await Promise.all([emitEvent('attendance'),emitEvent('daily_operations')]);
    return send(res,200,{ ok:true,attendance,operation:daily.operation,dailyAction:daily.action });
  } catch (error) { handleError(res,error); }
};

module.exports.operationPayload = operationPayload;
module.exports.operationChanged = operationChanged;
