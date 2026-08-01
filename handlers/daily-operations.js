const {
  requireSession, parseBody, db, assertDb, emitEvent, audit, notifyEmployees,
  send, handleError, httpError, israelDateISO,
} = require('../lib/server');
const { overlaps, timeToMinutes, closingTimeForDate, calculateWeeklyMinutes } = require('../lib/schedule');

const TYPES = new Set(['sick','absent','late','early_release','other']);
const REPLACEMENT_TYPES = new Set(['replacement','transfer']);

function minutes(value) { return timeToMinutes(String(value || '').slice(0,5)); }
function sunday(dateString) { const d=new Date(`${dateString}T12:00:00Z`); d.setUTCDate(d.getUTCDate()-d.getUTCDay()); return d.toISOString().slice(0,10); }
function addDays(dateString,days){ const d=new Date(`${dateString}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
function dayOf(dateString){ return new Date(`${dateString}T12:00:00Z`).getUTCDay(); }

function affectedRange(operation, shift) {
  if (['sick','absent'].includes(operation.operation_type)) return { start:String(shift.start_time).slice(0,5), end:String(shift.end_time).slice(0,5) };
  if (operation.operation_type === 'late') return { start:String(shift.start_time).slice(0,5), end:String(operation.start_time || shift.end_time).slice(0,5) };
  if (operation.operation_type === 'early_release') return { start:String(operation.end_time || shift.start_time).slice(0,5), end:String(shift.end_time).slice(0,5) };
  return { start:String(operation.start_time || shift.start_time).slice(0,5), end:String(operation.end_time || shift.end_time).slice(0,5) };
}

async function loadContext(date) {
  const weekStart=sunday(date), weekEnd=addDays(weekStart,5);
  const [employeesR,shiftsR,requestsR,constraintsR,patternsR,settingsR,operationsR] = await Promise.all([
    db().from('hadas_employees').select('*').eq('active',true),
    db().from('hadas_shifts').select('*').gte('shift_date',weekStart).lte('shift_date',weekEnd),
    db().from('hadas_requests').select('*').in('request_type',['leave','day_off','sick']).in('status',['approved','applied']).lte('request_date',date),
    db().from('hadas_employee_class_constraints').select('*'),
    db().from('hadas_employee_weekly_patterns').select('*'),
    db().from('hadas_app_settings').select('*').eq('id',1).single(),
    db().from('hadas_daily_operations').select('*').eq('operation_date',date),
  ]);
  return {
    employees:assertDb(employeesR,'לא ניתן לטעון עובדים')||[], shifts:assertDb(shiftsR,'לא ניתן לטעון שיבוצים')||[],
    requests:(assertDb(requestsR,'לא ניתן לטעון היעדרויות')||[]).filter(r=>date<=String(r.request_end_date||r.request_date)),
    constraints:assertDb(constraintsR,'לא ניתן לטעון העדפות')||[], patterns:assertDb(patternsR,'לא ניתן לטעון ימים קבועים')||[],
    settings:assertDb(settingsR,'לא ניתן לטעון תקינה')||{}, operations:assertDb(operationsR,'לא ניתן לטעון תפעול יומי')||[],
  };
}

function isForbidden(context, employeeId, classId, date) {
  return context.constraints.some(c=>c.employee_id===employeeId&&c.class_id===classId&&c.constraint_type==='forbidden'&&(!c.valid_from||c.valid_from<=date)&&(!c.valid_to||c.valid_to>=date));
}
function isUnavailable(context, employeeId, date) {
  return context.requests.some(r=>r.requester_id===employeeId&&r.request_date<=date&&date<=String(r.request_end_date||r.request_date))
    || context.operations.some(o=>o.employee_id===employeeId&&o.operation_date===date);
}
function dayPattern(context, employeeId, date) { return context.patterns.find(p=>p.employee_id===employeeId&&Number(p.weekday)===dayOf(date)); }
function activeInRange(shift,start,end){ return overlaps(shift.start_time,shift.end_time,start,end); }

function sourceClassCanRelease(context, sourceClassId, employeeId, date, start, end) {
  const open=minutes(context.settings.opening_time||'07:30');
  const close=minutes(closingTimeForDate(context.settings,date));
  const slot=Math.max(15,Number(context.settings.validation_slot_minutes||30));
  const closingWindow=Math.max(15,Number(context.settings.closing_window_minutes||30));
  for(let point=Math.max(open,minutes(start));point<Math.min(close,minutes(end));point+=slot){
    const slotStart=`${String(Math.floor(point/60)).padStart(2,'0')}:${String(point%60).padStart(2,'0')}`;
    const slotEndMinutes=Math.min(point+slot,minutes(end),close);
    const slotEnd=`${String(Math.floor(slotEndMinutes/60)).padStart(2,'0')}:${String(slotEndMinutes%60).padStart(2,'0')}`;
    const unavailableIds=new Set(context.operations.filter(o=>o.operation_date===date&&o.employee_id!==employeeId&&activeInRange({start_time:o.start_time||slotStart,end_time:o.end_time||slotEnd},slotStart,slotEnd)).map(o=>o.employee_id));
    const transferredIds=new Set(context.operations.filter(o=>o.operation_date===date&&o.status==='resolved'&&o.replacement_type==='transfer'&&o.replacement_from_class_id===sourceClassId&&activeInRange({start_time:o.replacement_start||slotStart,end_time:o.replacement_end||slotEnd},slotStart,slotEnd)).map(o=>o.replacement_employee_id));
    const remainingShifts=context.shifts.filter(s=>s.shift_date===date&&s.class_id===sourceClassId&&s.employee_id!==employeeId&&!unavailableIds.has(s.employee_id)&&!transferredIds.has(s.employee_id)&&activeInRange(s,slotStart,slotEnd));
    const people=new Set(remainingShifts.map(s=>s.employee_id));
    const required=point>=close-closingWindow?Number(context.settings.closing_required_staff||3):Number(context.settings.required_staff||4);
    if(people.size<required) return false;
    if(context.settings.require_leader!==false&&!remainingShifts.some(s=>['teacher','lead'].includes(s.shift_role))) return false;
  }
  return true;
}

function buildSuggestions(context, operation, shift) {
  const date=operation.operation_date;
  const range=affectedRange(operation,shift);
  if(!range.start||!range.end||minutes(range.end)<=minutes(range.start)) return [];
  const weeklyShifts=context.shifts;
  const suggestions=[];
  for(const employee of context.employees.filter(e=>e.is_schedulable!==false&&e.id!==operation.employee_id)){
    if(isUnavailable(context,employee.id,date)||isForbidden(context,employee.id,operation.class_id,date)) continue;
    const dayShifts=weeklyShifts.filter(s=>s.employee_id===employee.id&&s.shift_date===date);
    const overlapping=dayShifts.filter(s=>activeInRange(s,range.start,range.end));
    const pattern=dayPattern(context,employee.id,date);
    const requestedMinutes=Math.max(0,minutes(range.end)-minutes(range.start));
    const currentMinutes=calculateWeeklyMinutes(weeklyShifts,employee.id);
    if(employee.max_weekly_hours!=null&&currentMinutes+requestedMinutes>Number(employee.max_weekly_hours)*60&&overlapping.length===0) continue;

    if(overlapping.length===0){
      if(pattern?.day_type==='day_off') continue;
      if(pattern?.day_type==='work'&&(minutes(range.start)<minutes(pattern.start_time)||minutes(range.end)>minutes(pattern.end_time))) continue;
      let score=50; const reasons=['פנוי/ה בשעות החסרות'];
      if(employee.assignment_mode==='substitute'){score+=35;reasons.push('משלימ/ת מקום');}
      if(employee.assignment_mode==='rotation'){score+=22;reasons.push('ברוטציה בין כיתות');}
      if(pattern?.day_type==='as_needed'){score+=25;reasons.push('מוגדר/ת לפי צורך ביום זה');}
      if(pattern?.day_type==='work'){score+=8;reasons.push('השעות בתוך יום העבודה הקבוע');}
      if(employee.primary_class_id===operation.class_id){score+=18;reasons.push('מכיר/ה את הכיתה');}
      const preferred=context.constraints.some(c=>c.employee_id===employee.id&&c.class_id===operation.class_id&&c.constraint_type==='preferred');
      const avoid=context.constraints.some(c=>c.employee_id===employee.id&&c.class_id===operation.class_id&&c.constraint_type==='avoid');
      if(preferred){score+=16;reasons.push('עדיפות לכיתה');}
      if(avoid){score-=18;reasons.push('קיימת העדפה להימנע מהכיתה — מוצג כאפשרות אחרונה');}
      suggestions.push({ employee_id:employee.id, full_name:employee.full_name, job_title:employee.job_title, replacement_type:'replacement', from_class_id:null, start_time:range.start, end_time:range.end, score, reasons });
      continue;
    }

    const source=overlapping.find(s=>s.class_id!==operation.class_id);
    if(!source||!sourceClassCanRelease(context,source.class_id,employee.id,date,range.start,range.end)) continue;
    let score=28; const reasons=['ניתן להעביר זמנית מכיתה אחרת בלי לפגוע בתקן המקור'];
    if(employee.assignment_mode==='rotation') {score+=18;reasons.push('מוגדר/ת ברוטציה');}
    if(employee.assignment_mode==='substitute') {score+=15;reasons.push('משלימ/ת מקום');}
    const preferred=context.constraints.some(c=>c.employee_id===employee.id&&c.class_id===operation.class_id&&c.constraint_type==='preferred');
    const avoid=context.constraints.some(c=>c.employee_id===employee.id&&c.class_id===operation.class_id&&c.constraint_type==='avoid');
    if(preferred){score+=14;reasons.push('עדיפות לכיתת היעד');}
    if(avoid){score-=20;reasons.push('עדיף להימנע מכיתת היעד — אפשרות אחרונה');}
    suggestions.push({ employee_id:employee.id, full_name:employee.full_name, job_title:employee.job_title, replacement_type:'transfer', from_class_id:source.class_id, start_time:range.start, end_time:range.end, score, reasons });
  }
  return suggestions.sort((a,b)=>b.score-a.score||a.full_name.localeCompare(b.full_name,'he')).slice(0,16);
}

module.exports=async function handler(req,res){
  try{
    const caller=await requireSession(req,{manager:true});
    const body=parseBody(req);
    if(req.method==='GET'){
      const date=String(req.query?.date||israelDateISO());
      const [rowsR,shiftsR]=await Promise.all([db().from('hadas_daily_operations').select('*').eq('operation_date',date).order('created_at',{ascending:false}),db().from('hadas_shifts').select('*').eq('shift_date',date).order('start_time')]);
      const rows=assertDb(rowsR,'לא ניתן לטעון תפעול יומי')||[];
      const shifts=assertDb(shiftsR,'לא ניתן לטעון את שיבוץ היום')||[];
      return send(res,200,{ok:true,operations:rows,shifts,date});
    }
    if(req.method!=='POST') return send(res,405,{ok:false,error:'Method not allowed'});
    const action=String(body.action||'report');
    if(action==='report'){
      const shift=assertDb(await db().from('hadas_shifts').select('*').eq('id',body.shift_id).maybeSingle(),'השיבוץ לא נמצא');
      if(!shift) throw httpError(404,'השיבוץ לא נמצא');
      const type=String(body.operation_type||'');
      if(!TYPES.has(type)) throw httpError(400,'סיבת ההיעדרות אינה תקינה');
      let start=body.start_time||null,end=body.end_time||null;
      if(type==='late'){ if(!start||minutes(start)<=minutes(shift.start_time)||minutes(start)>=minutes(shift.end_time)) throw httpError(400,'יש להזין שעת הגעה מאוחרת תקינה'); end=shift.end_time; }
      if(type==='early_release'){ if(!end||minutes(end)<=minutes(shift.start_time)||minutes(end)>=minutes(shift.end_time)) throw httpError(400,'יש להזין שעת שחרור מוקדם תקינה'); start=shift.start_time; }
      if(['sick','absent'].includes(type)){ start=shift.start_time; end=shift.end_time; }
      if(type==='other'&&(!start||!end||minutes(end)<=minutes(start))) throw httpError(400,'יש להזין טווח שעות תקין');
      const existing=assertDb(await db().from('hadas_daily_operations').select('id,status').eq('shift_id',shift.id).eq('operation_date',shift.shift_date).maybeSingle(),'לא ניתן לבדוק דיווח קיים');
      if(existing) throw httpError(409,'כבר קיים דיווח תפעולי לשיבוץ הזה. אפשר לפתוח או לעדכן אותו במסך התפעול.');
      const row={ operation_date:shift.shift_date,shift_id:shift.id,employee_id:shift.employee_id,class_id:shift.class_id,operation_type:type,start_time:start,end_time:end,note:String(body.note||'').trim()||null,status:'open',created_by:caller.employee.id };
      const operation=assertDb(await db().from('hadas_daily_operations').insert(row).select('*').single(),'לא ניתן לשמור דיווח תפעולי');
      await audit(caller.employee.id,'create','daily_operation',operation.id,row); await emitEvent('daily_operations');
      return send(res,201,{ok:true,operation});
    }
    const operation=assertDb(await db().from('hadas_daily_operations').select('*').eq('id',body.id).maybeSingle(),'הדיווח לא נמצא');
    if(!operation) throw httpError(404,'הדיווח לא נמצא');
    const shift=assertDb(await db().from('hadas_shifts').select('*').eq('id',operation.shift_id).maybeSingle(),'השיבוץ לא נמצא');
    if(!shift) throw httpError(404,'השיבוץ לא נמצא');
    const context=await loadContext(operation.operation_date);
    const suggestions=buildSuggestions(context,operation,shift);
    if(action==='suggestions') return send(res,200,{ok:true,suggestions,range:affectedRange(operation,shift)});
    if(action==='assign'){
      const employeeId=String(body.employee_id||''); const replacementType=String(body.replacement_type||'');
      if(!REPLACEMENT_TYPES.has(replacementType)) throw httpError(400,'סוג ההחלפה אינו תקין');
      const chosen=suggestions.find(s=>s.employee_id===employeeId&&s.replacement_type===replacementType);
      if(!chosen) throw httpError(409,'העובד כבר אינו זמין להחלפה זו');
      const update={replacement_employee_id:employeeId,replacement_from_class_id:chosen.from_class_id,replacement_type:replacementType,replacement_start:chosen.start_time,replacement_end:chosen.end_time,status:'resolved',resolved_by:caller.employee.id,resolved_at:new Date().toISOString()};
      assertDb(await db().from('hadas_daily_operations').update(update).eq('id',operation.id),'לא ניתן לשמור את ההחלפה');
      await notifyEmployees([employeeId],{type:'daily_operation',title:'שינוי תפעולי להיום',message:`נקבע עבורך ${replacementType==='transfer'?'מעבר זמני':'שיבוץ החלפה'} לכיתה אחרת בין ${chosen.start_time}–${chosen.end_time}.`,entityType:'daily_operation',entityId:operation.id,actionRequired:true});
      await audit(caller.employee.id,'assign','daily_operation',operation.id,update); await emitEvent('daily_operations');
      return send(res,200,{ok:true});
    }
    if(action==='reopen'){
      assertDb(await db().from('hadas_daily_operations').update({status:'open',replacement_employee_id:null,replacement_from_class_id:null,replacement_type:null,replacement_start:null,replacement_end:null,resolved_by:null,resolved_at:null}).eq('id',operation.id),'לא ניתן לפתוח מחדש');
      await emitEvent('daily_operations'); return send(res,200,{ok:true});
    }
    throw httpError(400,'פעולה לא נתמכת');
  }catch(error){handleError(res,error);}
};

// Exposed for deterministic automated tests of the recommendation engine.
module.exports.buildSuggestions = buildSuggestions;
module.exports.sourceClassCanRelease = sourceClassCanRelease;
module.exports.affectedRange = affectedRange;
