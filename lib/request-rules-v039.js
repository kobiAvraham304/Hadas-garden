function dateAtNoon(value){return new Date(`${value}T12:00:00Z`);}
function weekdayOf(value){return dateAtNoon(value).getUTCDay();}
function weekStart(value){const d=dateAtNoon(value);d.setUTCDate(d.getUTCDate()-d.getUTCDay());return d.toISOString().slice(0,10);}
function addDays(value,days){const d=dateAtNoon(value);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function approved(request){return ['approved','applied'].includes(String(request?.status||''));}
function selectedFixedDays(request){
  if(Array.isArray(request?.available_fixed_day_weekdays)&&request.available_fixed_day_weekdays.length)return request.available_fixed_day_weekdays.map(Number);
  if(request?.available_fixed_day_weekday===null||request?.available_fixed_day_weekday===undefined)return [];
  return [Number(request.available_fixed_day_weekday)];
}
function fixedDayWorkAuthorization(requests=[],employeeId,date){
  const weekday=weekdayOf(date);
  return requests.filter((request)=>{
    if(String(request?.requester_id||request?.employee_id||'')!==String(employeeId||''))return false;
    if(!approved(request)||!['leave','day_off'].includes(String(request.request_type||'')))return false;
    if(!(request.allow_schedule_on_day_off===true||String(request.allow_schedule_on_day_off)==='true'))return false;
    if(!selectedFixedDays(request).includes(weekday))return false;
    const from=weekStart(String(request.request_date));
    const to=addDays(weekStart(String(request.request_end_date||request.request_date)),5);
    return date>=from&&date<=to;
  }).sort((a,b)=>Number(b.preferred_fixed_day_weekday===weekday)-Number(a.preferred_fixed_day_weekday===weekday))[0]||null;
}
function approvedTimeBounds(requests=[],employeeId,date){
  const rows=requests.filter((r)=>String(r?.requester_id||r?.employee_id||'')===String(employeeId||'')&&approved(r)&&r.request_date===date);
  const late=rows.filter(r=>r.request_type==='late_start'&&r.requested_start).map(r=>String(r.requested_start).slice(0,5)).sort();
  const early=rows.filter(r=>r.request_type==='early_finish'&&r.requested_end).map(r=>String(r.requested_end).slice(0,5)).sort();
  return{lateStart:late.length?late[late.length-1]:null,earlyFinish:early.length?early[0]:null};
}
function approvedAbsence(requests=[],employeeId,date){
  return requests.find((r)=>String(r?.requester_id||r?.employee_id||'')===String(employeeId||'')&&approved(r)&&['leave','day_off','sick'].includes(String(r.request_type||''))&&r.request_date<=date&&date<=String(r.request_end_date||r.request_date))||null;
}
module.exports={weekdayOf,weekStart,addDays,approved,selectedFixedDays,fixedDayWorkAuthorization,approvedTimeBounds,approvedAbsence};
