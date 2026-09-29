const previous=require('./hotfix-v0342');
const schedule=require('./schedule');
const auto=require('./auto-schedule');
const rules=require('./request-rules-v039');

const originalValidateWeek=schedule.validateWeek;
const originalGenerate=auto.generateAutomaticSchedule;
const originalAvailability=auto.employeeAvailability;

function short(value){return value?String(value).slice(0,5):'';}
function patternFor(input,employeeId,date){
  const weekday=rules.weekdayOf(date);
  return (input.patterns||[]).find((row)=>row.employee_id===employeeId&&Number(row.weekday)===weekday);
}
function fixedDayApproved(input,employeeId,date){
  const pattern=patternFor(input,employeeId,date);
  return pattern?.day_type==='day_off'&&rules.fixedDayWorkAuthorization(input.requests||[],employeeId,date);
}

schedule.validateWeek=function validateWeekV039(args={}){
  const result=originalValidateWeek(args);
  const errors=(result.errors||[]).filter((issue)=>!(
    issue.code==='fixed_day_off'&&rules.fixedDayWorkAuthorization(args.requests||[],issue.employee_id,issue.date)
  ));
  const seen=new Set(errors.map((item)=>[item.code,item.date,item.employee_id,item.class_id].join('|')));

  for(const shift of args.shifts||[]){
    const bounds=rules.approvedTimeBounds(args.requests||[],shift.employee_id,shift.shift_date);
    const employee=(args.employees||[]).find((item)=>item.id===shift.employee_id);
    const name=employee?.full_name||'העובד';

    if(bounds.lateStart&&schedule.timeToMinutes(shift.start_time)<schedule.timeToMinutes(bounds.lateStart)){
      const issue={
        code:'approved_late_start',
        date:shift.shift_date,
        employee_id:shift.employee_id,
        class_id:shift.class_id,
        message:`${name} מתחיל לפני שעת ההתחלה המאוחרת שאושרה (${bounds.lateStart})`,
      };
      const key=[issue.code,issue.date,issue.employee_id,issue.class_id].join('|');
      if(!seen.has(key)){errors.push(issue);seen.add(key);}
    }

    if(bounds.earlyFinish&&schedule.timeToMinutes(shift.end_time)>schedule.timeToMinutes(bounds.earlyFinish)){
      const issue={
        code:'approved_early_finish',
        date:shift.shift_date,
        employee_id:shift.employee_id,
        class_id:shift.class_id,
        message:`${name} מסיים אחרי שעת הסיום המוקדם שאושרה (${bounds.earlyFinish})`,
      };
      const key=[issue.code,issue.date,issue.employee_id,issue.class_id].join('|');
      if(!seen.has(key)){errors.push(issue);seen.add(key);}
    }
  }

  return{...result,errors};
};

auto.employeeAvailability=function employeeAvailabilityV039(args={}){
  const base=originalAvailability(args);
  if(base)return base;

  const {employee,date,patterns=[],requests=[],settings={}}=args;
  const pattern=patterns.find((row)=>row.employee_id===employee?.id&&Number(row.weekday)===rules.weekdayOf(date));
  const authorization=pattern?.day_type==='day_off'&&rules.fixedDayWorkAuthorization(requests,employee?.id,date);
  if(!employee||!authorization||rules.approvedAbsence(requests,employee.id,date))return null;

  const open=short(settings.opening_time)||'07:30';
  const close=schedule.closingTimeForDate(settings,date);
  let start=short(employee.default_start)||open;
  let end=short(employee.default_end)||close;
  const bounds=rules.approvedTimeBounds(requests,employee.id,date);

  if(bounds.lateStart&&schedule.timeToMinutes(bounds.lateStart)>schedule.timeToMinutes(start))start=bounds.lateStart;
  if(bounds.earlyFinish&&schedule.timeToMinutes(bounds.earlyFinish)<schedule.timeToMinutes(end))end=bounds.earlyFinish;
  if(schedule.timeToMinutes(end)<=schedule.timeToMinutes(start))return null;

  return{
    start,end,
    source:'approved_fixed_day',
    asNeeded:true,
    confidence:authorization.preferred_fixed_day_weekday===rules.weekdayOf(date)?4:-8,
    dayType:'day_off',
    fixedDayAuthorization:authorization,
    preferredFixedDay:authorization.preferred_fixed_day_weekday===rules.weekdayOf(date),
  };
};

function transformedInput(input={}){
  const dates=Array.isArray(input.selectedDates)&&input.selectedDates.length
    ? input.selectedDates
    : schedule.dateRange(input.weekStart,6);

  const patterns=(input.patterns||[]).map((pattern)=>{
    if(pattern.day_type!=='day_off')return pattern;
    const approvedDate=dates.find((date)=>
      rules.weekdayOf(date)===Number(pattern.weekday)
      && rules.fixedDayWorkAuthorization(input.requests||[],pattern.employee_id,date)
    );
    return approvedDate?{...pattern,day_type:'as_needed',start_time:null,end_time:null}:pattern;
  });
  return{...input,patterns};
}

function annotate(plan,input){
  if(!plan)return plan;
  const notes=[];

  for(const collection of [plan.generated||[],plan.finalRows||[]]){
    for(const row of collection){
      if(!fixedDayApproved(input,row.employee_id,row.shift_date))continue;
      if(!row.public_note)row.public_note='עבודה ביום חופשי שאושרה בבקשה';
      notes.push({
        shift_date:row.shift_date,
        class_id:row.class_id,
        employee_id:row.employee_id,
        note:'עבודה ביום חופשי שאושרה בבקשה',
      });
    }
  }

  const unique=new Map(
    [...(plan.assignmentNotes||[]),...notes]
      .map((note)=>[[note.shift_date,note.class_id,note.employee_id,note.note].join('|'),note])
  );
  plan.assignmentNotes=[...unique.values()];
  return plan;
}

auto.generateAutomaticSchedule=function generateAutomaticScheduleV039(input={}){
  return annotate(originalGenerate(transformedInput(input)),input);
};

module.exports={...previous,requestRules:rules};
