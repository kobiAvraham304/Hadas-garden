const previousHandler=require('./shifts-v032');
const {requireSession,parseBody,db,assertDb,handleError,httpError}=require('./server');
const rules=require('./request-rules-v039');
const {timeToMinutes}=require('./schedule');

async function mergedShiftBody(req,body){
  if(req.method!=='PATCH')return body;
  const id=String(body.id||'');
  if(!id)return body;
  const current=assertDb(await db().from('hadas_shifts').select('*').eq('id',id).maybeSingle(),'השיבוץ לא נמצא');
  return current?{...current,...body}:body;
}

async function approvedRequestsFor(employeeId,date){
  const weekEnd=rules.addDays(rules.weekStart(date),5);
  return assertDb(
    await db().from('hadas_requests')
      .select('id,requester_id,request_type,request_date,request_end_date,requested_start,requested_end,status,allow_schedule_on_day_off,available_fixed_day_weekday,available_fixed_day_weekdays,preferred_fixed_day_weekday')
      .eq('requester_id',employeeId)
      .in('status',['approved','applied'])
      .lte('request_date',weekEnd),
    'לא ניתן לבדוק בקשות מאושרות'
  )||[];
}

async function enforce(req,body){
  const payload=await mergedShiftBody(req,body);
  const employeeId=String(payload.employee_id||'');
  const date=String(payload.shift_date||'');
  if(!employeeId||!/^\d{4}-\d{2}-\d{2}$/.test(date))return;

  const requests=await approvedRequestsFor(employeeId,date);
  const absence=rules.approvedAbsence(requests,employeeId,date);
  if(absence){
    throw httpError(
      409,
      absence.request_type==='sick'
        ? 'לעובד יש מחלה מאושרת בתאריך זה'
        : 'לעובד יש חופשה/יום חופשי מאושרים בתאריך זה'
    );
  }

  const bounds=rules.approvedTimeBounds(requests,employeeId,date);
  if(bounds.lateStart&&payload.start_time&&timeToMinutes(payload.start_time)<timeToMinutes(bounds.lateStart)){
    throw httpError(409,`לעובד אושרה התחלה מאוחרת בשעה ${bounds.lateStart}. אין לשבץ לפני שעה זו`);
  }
  if(bounds.earlyFinish&&payload.end_time&&timeToMinutes(payload.end_time)>timeToMinutes(bounds.earlyFinish)){
    throw httpError(409,`לעובד אושר סיום מוקדם בשעה ${bounds.earlyFinish}. אין לשבץ לאחר שעה זו`);
  }

  const pattern=assertDb(
    await db().from('hadas_employee_weekly_patterns')
      .select('weekday,day_type')
      .eq('employee_id',employeeId)
      .eq('weekday',rules.weekdayOf(date))
      .maybeSingle(),
    'לא ניתן לבדוק את היום הקבוע'
  );
  if(pattern?.day_type==='day_off'&&rules.fixedDayWorkAuthorization(requests,employeeId,date)){
    req.body={...body,override_day_off:true};
  }
}

module.exports=async function shiftsV039(req,res){
  try{
    const body=parseBody(req);
    const manualPost=req.method==='POST'&&!body.action;
    if(manualPost||req.method==='PATCH'){
      await requireSession(req,{manager:true});
      await enforce(req,body);
    }
    return previousHandler(req,res);
  }catch(error){
    return handleError(res,error);
  }
};

module.exports.enforceApprovedRequestRules=enforce;
