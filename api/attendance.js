const { requireSession, parseBody, db, assertDb, emitEvent, audit, send, handleError, httpError } = require('../lib/server');
const { timeToMinutes } = require('../lib/schedule');
module.exports = async function handler(req,res) {
  try {
    if (req.method !== 'POST') return send(res,405,{ ok:false,error:'Method not allowed' });
    const caller = await requireSession(req,{ manager:true });
    const body = parseBody(req);
    if (!body.shift_id) throw httpError(400,'חסר שיבוץ');
    const shift = assertDb(await db().from('hadas_shifts').select('*').eq('id',body.shift_id).maybeSingle(),'השיבוץ לא נמצא');
    if (!shift) throw httpError(404,'השיבוץ לא נמצא');
    const status = ['scheduled','present','late','left_early','absent','sick','replacement'].includes(body.status) ? body.status : 'scheduled';
    let actualStart=body.actual_start || null;
    let actualEnd=body.actual_end || null;
    if (['absent','sick'].includes(status)) { actualStart=null; actualEnd=null; }
    if ((actualStart && !actualEnd) || (!actualStart && actualEnd)) throw httpError(400,'יש להזין גם שעת התחלה וגם שעת סיום');
    if (actualStart && timeToMinutes(actualEnd) <= timeToMinutes(actualStart)) throw httpError(400,'שעת הסיום בפועל חייבת להיות לאחר שעת ההתחלה');
    const row = {
      shift_id:shift.id,
      employee_id:shift.employee_id,
      attendance_date:shift.shift_date,
      actual_start:actualStart,
      actual_end:actualEnd,
      status,
      note:String(body.note || '').trim() || null,
      updated_by:caller.employee.id,
    };
    assertDb(await db().from('hadas_attendance').upsert(row,{ onConflict:'shift_id' }),'לא ניתן לשמור נוכחות');
    await audit(caller.employee.id,'upsert','attendance',shift.id,{ status });
    await emitEvent('attendance');
    send(res,200,{ ok:true });
  } catch (error) { handleError(res,error); }
};
