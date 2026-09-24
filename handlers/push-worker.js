const crypto = require('crypto');
const {
  db, assertDb, sendPushNotifications, safeEqual, israelDateISO,
  send, handleError, httpError,
} = require('../lib/server');

function minutesOf(value) {
  const [h,m] = String(value || '').slice(0,5).split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : -1;
}

function israelMinuteOfDay(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone:'Asia/Jerusalem', hour:'2-digit', minute:'2-digit', hourCycle:'h23',
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type,part.value]));
  return Number(map.hour) * 60 + Number(map.minute);
}

function trimTime(value) { return String(value || '').slice(0,5); }

function fingerprint(segments) {
  const normalized = [...segments]
    .sort((a,b) => String(a.start_time).localeCompare(String(b.start_time)) || String(a.class_id).localeCompare(String(b.class_id)))
    .map((row) => [row.class_id,trimTime(row.start_time),trimTime(row.end_time)].join('|'))
    .join('||');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function segmentText(segments, classMap) {
  return [...segments]
    .sort((a,b) => String(a.start_time).localeCompare(String(b.start_time)))
    .map((row) => `${trimTime(row.start_time)}–${trimTime(row.end_time)} בכיתת ${classMap.get(row.class_id) || 'הכיתה'}`)
    .join(' • ');
}

async function workerToken() {
  const result = await db().rpc('hadas_get_shift_reminder_worker_token_v038');
  const value = assertDb(result, 'לא ניתן לאמת את שירות התזכורות');
  return typeof value === 'string' ? value : String(value || '');
}

async function claim(employeeId, date, reminderType, scheduleFingerprint) {
  const result = await db().rpc('hadas_claim_shift_reminder_v038', {
    p_employee_id:employeeId,
    p_shift_date:date,
    p_reminder_type:reminderType,
    p_schedule_fingerprint:scheduleFingerprint,
  });
  return Boolean(assertDb(result, 'לא ניתן לשריין תזכורת משמרת'));
}

async function finishDelivery(employeeId,date,reminderType,{ok,sent,error=null}) {
  const payload = ok
    ? { status:'sent', push_sent_count:sent, sent_at:new Date().toISOString(), last_error:null, updated_at:new Date().toISOString() }
    : { status:'failed', push_sent_count:sent, last_error:String(error || 'Push delivery failed').slice(0,500), updated_at:new Date().toISOString() };
  const result = await db().from('hadas_shift_reminder_deliveries')
    .update(payload)
    .eq('employee_id',employeeId)
    .eq('shift_date',date)
    .eq('reminder_type',reminderType);
  if (result.error) console.error('Shift reminder delivery update failed', result.error);
}

async function deliver({employee,date,type,segments,classMap,changed}) {
  const firstName = String(employee.full_name || '').trim().split(/\s+/)[0] || 'יקרה';
  const detail = segmentText(segments,classMap);
  const scheduleFingerprint = fingerprint(segments);
  const canClaim = await claim(employee.id,date,type,scheduleFingerprint);
  if (!canClaim) return { skipped:true, reason:'already_claimed' };

  const isStart = type === 'shift_start';
  const title = isStart ? 'המשמרת התחילה 🌤️' : 'תזכורת למשמרת ⏰';
  const changedText = changed ? 'לתשומת לבך — השיבוץ השתנה מאז התזכורת הקודמת. ' : '';
  const message = isStart
    ? `בוקר טוב ${firstName} 🌷 ${changedText}המשמרת שלך התחילה עכשיו. השיבוץ שלך היום: ${detail}. לא לשכוח לדווח נוכחות.`
    : `בוקר טוב ${firstName} 🌷 המשמרת שלך מתחילה בעוד שעה. השיבוץ שלך היום: ${detail}. יום נעים!`;
  const url = isStart ? `/?push=attendance&date=${encodeURIComponent(date)}` : `/?push=home&date=${encodeURIComponent(date)}`;
  const tag = `hadas-shift-${type}-${date}-${employee.id}`;
  const results = await sendPushNotifications([employee.id], { title,message,url,tag,type:'shift_reminder' });
  const settled = (results || []).map((item) => item?.value).filter(Boolean);
  const sent = settled.filter((item) => item.ok).length;
  const failed = settled.filter((item) => !item.ok).length;
  await finishDelivery(employee.id,date,type,{
    ok:sent>0,
    sent,
    error:sent>0 ? null : (failed ? 'Push service rejected all active subscriptions' : 'No active Push subscription'),
  });
  return { sent,failed,ok:sent>0 };
}

module.exports = async function pushWorkerHandler(req,res) {
  try {
    if (req.method !== 'POST') return send(res,405,{ok:false,error:'Method not allowed'});
    const expected = await workerToken();
    const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
    if (!expected || !safeEqual(supplied,expected)) throw httpError(401,'Unauthorized');

    const now = new Date();
    const date = israelDateISO(now);
    const nowMinutes = israelMinuteOfDay(now);

    const prefs = assertDb(await db().from('hadas_push_preferences')
      .select('employee_id')
      .eq('smart_shift_reminders',true), 'לא ניתן לטעון העדפות תזכורת') || [];
    if (!prefs.length) return send(res,200,{ok:true,date,checked:0,sent:0});

    const preferredIds = [...new Set(prefs.map((row) => row.employee_id).filter(Boolean))];
    const subscriptions = assertDb(await db().from('hadas_push_subscriptions')
      .select('employee_id')
      .in('employee_id',preferredIds)
      .eq('active',true), 'לא ניתן לבדוק מנויי Push') || [];
    const eligibleIds = [...new Set(subscriptions.map((row) => row.employee_id).filter(Boolean))];
    if (!eligibleIds.length) return send(res,200,{ok:true,date,checked:0,sent:0});

    const shifts = assertDb(await db().from('hadas_shifts')
      .select('id,shift_date,employee_id,class_id,start_time,end_time,status,updated_at')
      .eq('shift_date',date)
      .in('employee_id',eligibleIds)
      .in('status',['draft','published']), 'לא ניתן לטעון את השיבוץ העדכני') || [];
    if (!shifts.length) return send(res,200,{ok:true,date,checked:eligibleIds.length,sent:0});

    const employeeIds = [...new Set(shifts.map((row) => row.employee_id))];
    const classIds = [...new Set(shifts.map((row) => row.class_id))];
    const [employeesR,classesR,oneHourR] = await Promise.all([
      db().from('hadas_employees').select('id,full_name,active').in('id',employeeIds).eq('active',true),
      db().from('hadas_classes').select('id,name').in('id',classIds),
      db().from('hadas_shift_reminder_deliveries').select('employee_id,schedule_fingerprint,status').eq('shift_date',date).eq('reminder_type','one_hour'),
    ]);
    const employees = assertDb(employeesR,'לא ניתן לטעון עובדים') || [];
    const classes = assertDb(classesR,'לא ניתן לטעון כיתות') || [];
    const oneHourRows = assertDb(oneHourR,'לא ניתן לבדוק תזכורות קודמות') || [];
    const employeeMap = new Map(employees.map((row) => [row.id,row]));
    const classMap = new Map(classes.map((row) => [row.id,row.name]));
    const oneHourMap = new Map(oneHourRows.filter((row) => row.status==='sent').map((row) => [row.employee_id,row.schedule_fingerprint]));
    const byEmployee = new Map();
    for (const row of shifts) {
      if (!employeeMap.has(row.employee_id)) continue;
      if (!byEmployee.has(row.employee_id)) byEmployee.set(row.employee_id,[]);
      byEmployee.get(row.employee_id).push(row);
    }

    let attempted=0,sent=0,skipped=0;
    const details=[];
    for (const [employeeId,segments] of byEmployee) {
      segments.sort((a,b) => String(a.start_time).localeCompare(String(b.start_time)));
      const firstStart = minutesOf(segments[0]?.start_time);
      if (firstStart < 0) continue;
      const delta = firstStart - nowMinutes;
      const elapsed = nowMinutes - firstStart;
      const scheduleFingerprint = fingerprint(segments);

      let type=null;
      if (delta >= 57 && delta <= 60) type='one_hour';
      else if (elapsed >= 0 && elapsed <= 5) type='shift_start';
      if (!type) continue;

      attempted += 1;
      const employee = employeeMap.get(employeeId);
      const changed = type==='shift_start' && Boolean(oneHourMap.get(employeeId)) && oneHourMap.get(employeeId)!==scheduleFingerprint;
      try {
        const outcome = await deliver({employee,date,type,segments,classMap,changed});
        if (outcome?.skipped) skipped += 1;
        else sent += Number(outcome?.sent || 0);
        details.push({employeeId,type,changed,sent:Number(outcome?.sent || 0),skipped:Boolean(outcome?.skipped)});
      } catch(error) {
        console.error('Smart shift reminder failed',{employeeId,type,message:error?.message});
        details.push({employeeId,type,error:'delivery_failed'});
      }
    }

    console.log(JSON.stringify({level:'info',msg:'smart_shift_reminder_worker',date,nowMinutes,checked:byEmployee.size,attempted,sent,skipped}));
    return send(res,200,{ok:true,date,checked:byEmployee.size,attempted,sent,skipped,details});
  } catch(error) {
    return handleError(res,error);
  }
};

module.exports._test = { minutesOf,israelMinuteOfDay,fingerprint,segmentText };
