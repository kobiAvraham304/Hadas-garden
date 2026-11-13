// v0.40.13 – request to work on a normally free, unscheduled day.
// Other request types continue through the existing legacy request workflow.
const {
  requireSession,parseBody,db,assertDb,isManager,notifyManagers,notifyEmployees,
  emitEvent,audit,send,handleError,httpError,israelDateISO
}=require('./server');

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOCK=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const dateAtNoon=value=>new Date(String(value)+'T12:00:00Z');
const dateISO=value=>value.toISOString().slice(0,10);
const weekday=date=>dateAtNoon(date).getUTCDay();
const plusDays=(date,days)=>{const d=dateAtNoon(date);d.setUTCDate(d.getUTCDate()+days);return dateISO(d);};

function isNormallyOff(employee,patterns,date) {
  const day=weekday(date);
  if(day===6)return false;
  const pattern=patterns.find(row=>Number(row.weekday)===day);
  // Missing patterns must not silently turn a normal working day into a free day.
  return pattern?pattern.day_type==='day_off':(employee.fixed_day_off!==null&&employee.fixed_day_off!==undefined&&Number(employee.fixed_day_off)===day);
}

async function availability(employeeId) {
  const today=israelDateISO(),until=plusDays(today,90);
  const [empR,patternsR,shiftR,requestsR]=await Promise.all([
    db().from('hadas_employees').select('id,full_name,active,is_schedulable,primary_class_id,fixed_day_off').eq('id',employeeId).maybeSingle(),
    db().from('hadas_employee_weekly_patterns').select('weekday,day_type').eq('employee_id',employeeId),
    db().from('hadas_shifts').select('shift_date').eq('employee_id',employeeId).gte('shift_date',today).lte('shift_date',until),
    db().from('hadas_requests').select('id,request_type,request_date,request_end_date,status').eq('requester_id',employeeId).lte('request_date',until).in('status',['pending','approved','applied']),
  ]);
  const employee=assertDb(empR,'לא ניתן לטעון עובד');
  if(!employee?.active||employee.is_schedulable===false)return {dates:[],employee:null};
  const patterns=assertDb(patternsR,'לא ניתן לבדוק ימים קבועים')||[];
  const assigned=new Set((assertDb(shiftR,'לא ניתן לבדוק שיבוצים')||[]).map(row=>row.shift_date));
  const requests=assertDb(requestsR,'לא ניתן לבדוק בקשות קודמות')||[];
  const closed=requests.filter(row=>['leave','day_off','sick'].includes(row.request_type)&&['approved','applied'].includes(row.status));
  const workPending=new Set(requests.filter(row=>row.request_type==='work'&&row.status==='pending').map(row=>row.request_date));
  const days=[];
  for(let i=0;i<=90;i++) {
    const d=plusDays(today,i);
    if(!isNormallyOff(employee,patterns,d)||assigned.has(d)||workPending.has(d))continue;
    if(closed.some(row=>row.request_date<=d&&d<=String(row.request_end_date||row.request_date)))continue;
    days.push(d);
  }
  return {dates:days,employee};
}

async function handler(req,res){
  try {
    if(req.method!=='POST')return send(res,405,{ok:false,error:'Method not allowed'});
    const caller=await requireSession(req);
    const body=parseBody(req),action=String(body.action||'create');
    if(action==='work_days') {
      const employeeId=isManager(caller)&&body.requester_id?String(body.requester_id):caller.employee.id;
      if(!UUID.test(employeeId))throw httpError(400,'עובד לא תקין');
      const result=await availability(employeeId);
      return send(res,200,{ok:true,dates:result.dates,primary_class_id:result.employee?.primary_class_id||null});
    }
    if(action==='create'&&body.request_type==='work') {
      const selected=String(body.requester_id||'');
      const onBehalf=Boolean(selected&&selected!==caller.employee.id);
      if(onBehalf&&!isManager(caller))throw httpError(403,'אין הרשאה להגיש בקשה עבור עובד אחר');
      const employeeId=onBehalf?selected:caller.employee.id;
      const date=String(body.request_date||'');
      const start=String(body.requested_start||'').trim();
      const end=String(body.requested_end||'').trim();
      if(!DATE.test(date)||!CLOCK.test(start)||!CLOCK.test(end)||end<=start)throw httpError(400,'יש לבחור תאריך ושעות עבודה תקינות');
      const available=await availability(employeeId);
      if(!available.dates.includes(date))throw httpError(409,'היום אינו יום חופשי קבוע פנוי. אפשר להגיש רק בימי חופש ללא שיבוץ או היעדרות');
      const note=String(body.reason||'').trim().slice(0,2000);
      const row=assertDb(await db().from('hadas_requests').insert({
        requester_id:employeeId,created_by:caller.employee.id,submitted_by_manager:onBehalf,
        request_type:'work',request_date:date,requested_start:start,requested_end:end,
        reason:note||null,status:'pending',manager_preapproved:false,
      }).select('*').single(),'לא ניתן להגיש בקשה לעבוד');
      const jobs=[audit(caller.employee.id,'create','request',row.id,{type:'work',requester_id:employeeId}),
        notifyManagers({
          type:'request',title:'בקשה לעבוד – ממתינה לשיבוץ',
          message:`${available.employee.full_name} מבקש/ת לעבוד ב-${date}, ${start}–${end}.`,
          entityType:'request',entityId:row.id,actionRequired:true,push:true,
          pushUrl:`/?push=request&id=${encodeURIComponent(row.id)}`,
          pushTag:`hadas-work-request-${row.id}`,
        },onBehalf?null:caller.employee.id),emitEvent('requests')];
      await Promise.allSettled(jobs);
      return send(res,201,{ok:true,request:row});
    }
    if(action==='approve_work') {
      if(!isManager(caller))throw httpError(403,'אין הרשאה לאשר בקשה');
      const requestId=String(body.id||''),classId=String(body.class_id||'');
      const start=String(body.approved_start||'').trim(),end=String(body.approved_end||'').trim();
      if(!UUID.test(requestId)||!UUID.test(classId)||!CLOCK.test(start)||!CLOCK.test(end)||end<=start)
        throw httpError(400,'יש לבחור כיתה ושעות שיבוץ תקינות');
      const row=assertDb(await db().from('hadas_requests').select('*').eq('id',requestId).maybeSingle(),'הבקשה לא נמצאה');
      if(!row||row.request_type!=='work')throw httpError(404,'בקשה לעבוד לא נמצאה');
      if(row.status!=='pending')throw httpError(409,'הבקשה כבר טופלה');
      const result=await db().rpc('hadas_approve_work_request',{
        p_request_id:requestId,p_actor_id:caller.employee.id,p_class_id:classId,
        p_start_time:start,p_end_time:end,
        p_manager_note:String(body.manager_note||'').trim().slice(0,1000)||null,
      });
      const shiftId=assertDb(result,'לא ניתן ליצור שיבוץ – לא בוצע אישור');
      const after=assertDb(await db().from('hadas_requests').select('*').eq('id',requestId).single(),'לא ניתן לרענן את הבקשה');
      await Promise.allSettled([
        db().from('hadas_notifications').update({read_at:new Date().toISOString(),action_required:false}).eq('entity_type','request').eq('entity_id',requestId).eq('action_required',true),
        notifyEmployees([row.requester_id],{
          type:'request',title:'בקשתך לעבוד אושרה ושובצה',
          message:`אושרה משמרת ב-${row.request_date} בשעות ${start}–${end}; השיבוץ בטיוטה עד פרסומו.`,
          entityType:'request',entityId:row.id,actionRequired:false,push:true,
          pushUrl:`/?push=request&id=${encodeURIComponent(row.id)}`,
        },caller.employee.id),
        audit(caller.employee.id,'approve_work','request',row.id,{shift_id:shiftId,class_id:classId}),
        emitEvent('requests'),emitEvent('shifts'),
      ]);
      return send(res,200,{ok:true,request:after,shift_id:shiftId});
    }
    throw httpError(400,'פעולה לא מוכרת');
  } catch(error){return handleError(res,error);}
}
module.exports=handler;
module.exports.isNormallyOff=isNormallyOff;
module.exports.availability=availability;
