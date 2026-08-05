const crypto = require('node:crypto');
const {
  requireSession, parseBody, db, assertDb, isManager, notifyEmployees, notifyManagers,
  safeStoragePathPart, uploadPrivateFile, createPrivateFileUrl, deletePrivateFile,
  emitEvent, audit, send, handleError, httpError,
} = require('../lib/server');
const { timeToMinutes } = require('../lib/schedule');

const REQUEST_TYPES = new Set(['leave','day_off','late_start','early_finish','sick','swap']);
const CERTIFICATE_TYPES = new Set(['application/pdf','image/jpeg','image/png','image/webp']);
const CERTIFICATE_BUCKET = 'hadas-sick-certificates';

function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')); }
function inclusiveDays(start,end){ const a=new Date(`${start}T12:00:00Z`),b=new Date(`${end||start}T12:00:00Z`); return Math.floor((b-a)/86400000)+1; }
function requestRangeLabel(request) {
  return request.request_end_date && request.request_end_date !== request.request_date
    ? `${request.request_date}–${request.request_end_date}` : request.request_date;
}
async function getRequest(id) {
  return assertDb(await db().from('hadas_requests').select('*').eq('id',id).maybeSingle(),'הבקשה לא נמצאה');
}

async function swapCandidates(date, requesterId) {
  if (!validDate(date)) throw httpError(400,'יש לבחור תאריך תקין');
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const [employeesR, usersR, patternsR, dayOffRequestsR, unavailableRequestsR, shiftsR] = await Promise.all([
    db().from('hadas_employees').select('id,full_name,job_title,fixed_day_off,is_schedulable,active').eq('active',true).eq('is_schedulable',true),
    db().from('hadas_users').select('employee_id').eq('active',true),
    db().from('hadas_employee_weekly_patterns').select('employee_id,weekday,day_type').eq('weekday',weekday),
    db().from('hadas_requests').select('requester_id').eq('request_type','day_off').eq('request_date',date).in('status',['approved','applied']),
    db().from('hadas_requests').select('requester_id,request_date,request_end_date').in('request_type',['leave','sick']).in('status',['approved','applied']).lte('request_date',date),
    db().from('hadas_shifts').select('employee_id').eq('shift_date',date),
  ]);
  const employees = assertDb(employeesR,'לא ניתן לטעון עובדים') || [];
  const activeAccounts = new Set((assertDb(usersR,'לא ניתן לבדוק חשבונות פעילים') || []).map((row) => row.employee_id));
  const patterns = assertDb(patternsR,'לא ניתן לבדוק ימי חופשה') || [];
  const dayOffRequests = assertDb(dayOffRequestsR,'לא ניתן לבדוק בקשות יום חופשי') || [];
  const unavailableRequests = assertDb(unavailableRequestsR,'לא ניתן לבדוק חופשות ומחלות') || [];
  const shifts = assertDb(shiftsR,'לא ניתן לבדוק שיבוצים') || [];
  const patternByEmployee = new Map(patterns.map((row) => [row.employee_id,row.day_type]));
  const requestedOff = new Set(dayOffRequests.map((row) => row.requester_id));
  const unavailable = new Set(unavailableRequests.filter((row) => date <= (row.request_end_date || row.request_date)).map((row) => row.requester_id));
  const scheduled = new Set(shifts.map((row) => row.employee_id));
  return employees.filter((employee) => {
    if (employee.id === requesterId || !activeAccounts.has(employee.id) || scheduled.has(employee.id) || unavailable.has(employee.id)) return false;
    const pattern = patternByEmployee.get(employee.id);
    return requestedOff.has(employee.id) || pattern === 'day_off' || (pattern === undefined && Number(employee.fixed_day_off) === weekday);
  }).map(({ id,full_name,job_title }) => ({ id,full_name,job_title }));
}

async function validateSwapTarget(date, requesterId, targetId) {
  const candidates = await swapCandidates(date, requesterId);
  if (!candidates.some((item) => item.id === targetId)) throw httpError(409,'ניתן לבחור רק עובד שנמצא ביום חופשי ואינו משובץ בתאריך זה');
  const own = assertDb(await db().from('hadas_shifts').select('id').eq('employee_id',requesterId).eq('shift_date',date),'לא ניתן לבדוק את השיבוץ שלך') || [];
  if (!own.length) throw httpError(409,'אין לך שיבוץ בתאריך שנבחר');
}

function decodeCertificate(body, employeeId) {
  if (!body.attachment_data) return null;
  const match = String(body.attachment_data).match(/^data:([^;]+);base64,(.+)$/s);
  if (!match || !CERTIFICATE_TYPES.has(match[1])) throw httpError(400,'אפשר לצרף PDF או תמונה מסוג JPG, PNG או WEBP');
  let buffer;
  try { buffer = Buffer.from(match[2],'base64'); } catch { throw httpError(400,'הקובץ שצורף אינו תקין'); }
  if (!buffer.length || buffer.length > 3 * 1024 * 1024) throw httpError(400,'אישור המחלה חייב להיות בגודל של עד 3MB');
  const originalName = String(body.attachment_name || 'אישור-מחלה').slice(0,180);
  const extension = ({'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[match[1]];
  const path = `requests/${employeeId}/${crypto.randomUUID()}-${safeStoragePathPart(originalName.replace(/\.[^.]+$/,''))}.${extension}`;
  return { buffer, path, name:originalName, type:match[1], size:buffer.length };
}

module.exports = async function handler(req,res) {
  try {
    if (req.method !== 'POST') return send(res,405,{ ok:false,error:'Method not allowed' });
    const caller = await requireSession(req);
    const body = parseBody(req);
    const action = body.action || 'create';

    if (action === 'swap_candidates') {
      const candidates = await swapCandidates(String(body.request_date || ''), caller.employee.id);
      return send(res,200,{ ok:true,candidates });
    }

    if (action === 'attachment_url') {
      const request = await getRequest(body.id);
      if (!request) throw httpError(404,'הבקשה לא נמצאה');
      if (!isManager(caller) && request.requester_id !== caller.employee.id) throw httpError(403,'אין הרשאה לצפות באישור זה');
      if (!request.attachment_path) throw httpError(404,'לא צורף אישור לבקשה');
      const url = await createPrivateFileUrl(CERTIFICATE_BUCKET, request.attachment_path, 300);
      return send(res,200,{ ok:true,url,name:request.attachment_name || 'אישור מחלה' });
    }

    if (action === 'create') {
      const type = String(body.request_type || '');
      if (!REQUEST_TYPES.has(type)) throw httpError(400,'סוג הבקשה אינו תקין');
      if (!validDate(body.request_date)) throw httpError(400,'יש לבחור תאריך');
      const endDate = ['leave','sick'].includes(type) && body.request_end_date ? String(body.request_end_date) : null;
      if (endDate && (!validDate(endDate) || endDate < body.request_date)) throw httpError(400,'תאריך הסיום חייב להיות לאחר תאריך ההתחלה');
      const payload = {
        requester_id:caller.employee.id,
        request_type:type,
        request_date:String(body.request_date),
        request_end_date:endDate,
        requested_start:body.requested_start || null,
        requested_end:body.requested_end || null,
        shift_id:body.shift_id || null,
        target_employee_id:body.target_employee_id || null,
        target_shift_id:null,
        reason:String(body.reason || '').trim() || null,
        allow_schedule_on_day_off:['leave','day_off'].includes(type) ? (body.allow_schedule_on_day_off === true || String(body.allow_schedule_on_day_off) === 'true') : false,
        available_fixed_day_weekday: body.available_fixed_day_weekday !== undefined && body.available_fixed_day_weekday !== '' ? Number(body.available_fixed_day_weekday) : null,
        status:'pending',
      };
      if (payload.available_fixed_day_weekday !== null && (!Number.isInteger(payload.available_fixed_day_weekday) || payload.available_fixed_day_weekday < 0 || payload.available_fixed_day_weekday > 5)) throw httpError(400,'יום החופשי הקבוע אינו תקין');
      if (!payload.allow_schedule_on_day_off) payload.available_fixed_day_weekday = null;
      let own = null;
      if (['late_start','early_finish'].includes(type)) {
        if (!payload.shift_id) throw httpError(400,'יש לבחור את השיבוץ הרלוונטי');
        own = assertDb(await db().from('hadas_shifts').select('*').eq('id',payload.shift_id).maybeSingle(),'השיבוץ שלך לא נמצא');
        if (!own || own.employee_id !== caller.employee.id) throw httpError(409,'השיבוץ שנבחר אינו שייך לך');
        payload.request_date = own.shift_date;
      }
      if (type === 'late_start' && (!payload.requested_start || timeToMinutes(payload.requested_start) <= timeToMinutes(own.start_time) || timeToMinutes(payload.requested_start) >= timeToMinutes(own.end_time))) throw httpError(400,'שעת ההתחלה המבוקשת חייבת להיות בתוך שעות השיבוץ');
      if (type === 'early_finish' && (!payload.requested_end || timeToMinutes(payload.requested_end) <= timeToMinutes(own.start_time) || timeToMinutes(payload.requested_end) >= timeToMinutes(own.end_time))) throw httpError(400,'שעת הסיום המבוקשת חייבת להיות בתוך שעות השיבוץ');
      if (type === 'swap') {
        if (!payload.target_employee_id) throw httpError(400,'יש לבחור עובד שנמצא ביום חופשי');
        if (payload.target_employee_id === caller.employee.id) throw httpError(400,'לא ניתן לבחור את עצמך');
        await validateSwapTarget(payload.request_date,caller.employee.id,payload.target_employee_id);
      }
      const certificate = type === 'sick' ? decodeCertificate(body,caller.employee.id) : null;
      if (certificate) {
        await uploadPrivateFile(CERTIFICATE_BUCKET,certificate.path,certificate.buffer,certificate.type);
        Object.assign(payload,{ attachment_path:certificate.path,attachment_name:certificate.name,attachment_type:certificate.type,attachment_size:certificate.size });
      }
      let request;
      try {
        request = assertDb(await db().from('hadas_requests').insert(payload).select('*').single(),'לא ניתן לשלוח את הבקשה');
      } catch (error) {
        if (certificate) await deletePrivateFile(CERTIFICATE_BUCKET,certificate.path);
        throw error;
      }
      if (type === 'swap') {
        await notifyEmployees([payload.target_employee_id],{
          type:'swap',title:'בקשת החלפה ממתינה לאישור שלך',
          message:`${caller.employee.full_name} ביקש להחליף איתך בתאריך ${payload.request_date}.`,
          entityType:'request',entityId:request.id,actionRequired:true,
        });
      } else {
        const manualNote = type === 'leave' && inclusiveDays(payload.request_date,payload.request_end_date) > 2 ? ' נדרשת גם השלמת טופס חופשה ידני.' : '';
        await notifyManagers({ type:'request',title:'בקשה חדשה ממתינה לטיפול',message:`${caller.employee.full_name} שלח בקשת ${type === 'leave' ? 'חופשה' : type === 'sick' ? 'מחלה' : type === 'day_off' ? 'יום חופשי' : 'שינוי שעות'} (${requestRangeLabel(request)}).${manualNote}`,entityType:'request',entityId:request.id,actionRequired:true },caller.employee.id);
      }
      await audit(caller.employee.id,'create','request',request.id,{ type });
      await emitEvent('requests');
      return send(res,201,{ ok:true,request });
    }

    const request = await getRequest(body.id);
    if (!request) throw httpError(404,'הבקשה לא נמצאה');

    if (action === 'cancel') {
      if (request.requester_id !== caller.employee.id || request.status !== 'pending') throw httpError(403,'לא ניתן לבטל את הבקשה');
      assertDb(await db().from('hadas_requests').update({ status:'cancelled' }).eq('id',request.id),'לא ניתן לבטל את הבקשה');
      if (request.target_employee_id) await notifyEmployees([request.target_employee_id],{ type:'swap',title:'בקשת ההחלפה בוטלה',message:`${caller.employee.full_name} ביטל את בקשת ההחלפה.`,entityType:'request',entityId:request.id });
    } else if (action === 'target_accept') {
      if (request.target_employee_id !== caller.employee.id) throw httpError(403,'רק העובד שקיבל את ההצעה יכול לאשר');
      if (request.status !== 'pending') throw httpError(409,'הבקשה כבר טופלה');
      if (request.target_approved) throw httpError(409,'ההחלפה כבר אושרה על ידך');
      assertDb(await db().from('hadas_requests').update({ target_approved:true }).eq('id',request.id),'לא ניתן לאשר את ההחלפה');
      await notifyEmployees([request.requester_id],{ type:'swap',title:'בקשת ההחלפה אושרה על ידי העובד',message:`${caller.employee.full_name} אישר את ההחלפה. הבקשה הועברה לאישור מנהלת המעון או אחראית השיבוץ.`,entityType:'request',entityId:request.id });
      await notifyManagers({ type:'swap',title:'החלפה ממתינה לאישור הנהלה',message:`${caller.employee.full_name} אישר את בקשת ההחלפה לתאריך ${request.request_date}.`,entityType:'request',entityId:request.id,actionRequired:true },caller.employee.id);
    } else if (action === 'target_reject') {
      if (request.target_employee_id !== caller.employee.id) throw httpError(403,'רק העובד שקיבל את ההצעה יכול לדחות');
      if (request.status !== 'pending' || request.target_approved) throw httpError(409,'הבקשה כבר טופלה');
      assertDb(await db().from('hadas_requests').update({ status:'rejected',manager_note:'העובד שנבחר דחה את בקשת ההחלפה',decided_by:caller.employee.id,decided_at:new Date().toISOString() }).eq('id',request.id),'לא ניתן לדחות את ההחלפה');
      await notifyEmployees([request.requester_id],{ type:'swap',title:'בקשת ההחלפה נדחתה',message:`${caller.employee.full_name} לא אישר את בקשת ההחלפה לתאריך ${request.request_date}.`,entityType:'request',entityId:request.id });
    } else if (action === 'decide') {
      if (!isManager(caller)) throw httpError(403,'אין הרשאה לטפל בבקשה');
      if (!['approved','rejected'].includes(body.status)) throw httpError(400,'החלטה לא תקינה');
      if (request.request_type === 'swap' && body.status === 'approved' && !request.target_approved) throw httpError(409,'העובד שנבחר עדיין לא אישר את ההחלפה');
      const managerNote = String(body.manager_note || '').trim() || null;
      assertDb(await db().from('hadas_requests').update({ status:body.status,manager_note:managerNote,decided_by:caller.employee.id,decided_at:new Date().toISOString() }).eq('id',request.id),'לא ניתן לעדכן את הבקשה');
      const statusText = body.status === 'approved' ? 'אושרה' : 'נדחתה';
      await notifyEmployees([request.requester_id],{ type:'request',title:`הבקשה שלך ${statusText}`,message:managerNote || `בקשתך לתאריך ${requestRangeLabel(request)} ${statusText}.`,entityType:'request',entityId:request.id,actionRequired:false });
      if (request.target_employee_id) await notifyEmployees([request.target_employee_id],{ type:'swap',title:`בקשת ההחלפה ${statusText}`,message:`הבקשה לתאריך ${request.request_date} ${statusText} על ידי מנהלת המעון או אחראית השיבוץ.`,entityType:'request',entityId:request.id });
    } else if (action === 'apply') {
      if (!isManager(caller)) throw httpError(403,'אין הרשאה להזרים בקשה');
      if (request.status !== 'approved') throw httpError(409,'יש לאשר את הבקשה לפני הזרמתה');
      assertDb(await db().rpc('hadas_apply_approved_request',{ p_request_id:request.id,p_actor_id:caller.employee.id }),'לא ניתן להזרים את הבקשה לשיבוץ');
      await notifyEmployees([request.requester_id],{ type:'request',title:'הבקשה הוזרמה לשיבוץ',message:`הבקשה לתאריך ${requestRangeLabel(request)} עודכנה בטיוטת השיבוץ.`,entityType:'request',entityId:request.id });
      if (request.target_employee_id) await notifyEmployees([request.target_employee_id],{ type:'swap',title:'ההחלפה הוזרמה לשיבוץ',message:`השיבוץ לתאריך ${request.request_date} הועבר אליך בטיוטת השיבוץ.`,entityType:'request',entityId:request.id });
    } else {
      throw httpError(400,'פעולה לא מוכרת');
    }
    await audit(caller.employee.id,action,'request',request.id);
    await emitEvent('requests');
    if (action === 'apply') await emitEvent('shifts');
    return send(res,200,{ ok:true });
  } catch (error) { handleError(res,error); }
};
