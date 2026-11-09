// Small, server-only aggregates for the management employee cards.
const TIME_ZONE='Asia/Jerusalem';

function dateIsrael(timestamp) {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(timestamp));
  const values=Object.fromEntries(parts.filter(p=>['year','month','day'].includes(p.type)).map(p=>[p.type,p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function sundayOf(dateValue) {
  const value=String(dateValue);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('Invalid Israel date');
  const day=new Date(value+'T12:00:00Z');
  day.setUTCDate(day.getUTCDate()-day.getUTCDay());
  return day.toISOString().slice(0,10);
}

function activitySinceUtc(weekStart) {
  // Start the query one calendar day before local Sunday; filter sessions
  // by Israel local date afterward to cover both UTC+2 and UTC+3.
  const d=new Date(weekStart+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()-1);
  return d.toISOString();
}

function summarizeActivity({users=[],sessions=[],subscriptions=[],weekStart}) {
  const perEmployee={};
  const employeeByUser=new Map();
  for(const user of users){
    if(!user?.employee_id)continue;
    employeeByUser.set(String(user.id),String(user.employee_id));
    perEmployee[String(user.employee_id)]={logins_this_week:0,push_enabled:false};
  }
  for(const session of sessions){
    const employeeId=employeeByUser.get(String(session.user_id));
    if(employeeId&&session.created_at&&dateIsrael(session.created_at)>=weekStart)perEmployee[employeeId].logins_this_week++;
  }
  for(const row of subscriptions){
    const employeeId=String(row.employee_id||'');
    if(perEmployee[employeeId]&&row.active!==false)perEmployee[employeeId].push_enabled=true;
  }
  return perEmployee;
}

module.exports={dateIsrael,sundayOf,activitySinceUtc,summarizeActivity};
