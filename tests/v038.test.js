const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const read=p=>fs.readFileSync(p,'utf8');

test('0.38.0 exposes compact general and smart Push switches',()=>{
  const html=read('index.html'),css=read('push-v0372.css'),js=read('push-v0372.js');
  assert.match(html,/id="pushToggleBtn"/);assert.match(html,/id="pushSmartToggleBtn"/);
  assert.match(html,/תזכורות משמרת חכמות/);assert.match(css,/\.notifications-modal \.notifications-shell/);
  assert.match(css,/\.push-switch\.is-on/);assert.match(js,/set_smart_shift_reminders/);
});

test('0.38.0 requests device permission when general Push is enabled and defaults smart reminders on',()=>{
  const js=read('push-v0372.js'),api=read('handlers/push.js');
  assert.match(js,/Notification\.requestPermission\(\)/);
  assert.match(js,/button\.addEventListener\('click',\(\)=>generalActive\?disable\(\):enable\(\)\)/);
  assert.match(api,/smart_shift_reminders:true/);
  assert.match(api,/smartShiftReminders:preference\?\.smart_shift_reminders !== false/);
});

test('0.38.0 smart reminder worker reads current shifts, handles multiple segments and detects changes',()=>{
  const worker=read('handlers/push-worker.js');
  assert.match(worker,/from\('hadas_shifts'\)/);
  assert.match(worker,/\.in\('status',\['draft','published'\]\)/);
  assert.match(worker,/byEmployee/);assert.match(worker,/segmentText/);
  assert.match(worker,/oneHourMap\.get\(employeeId\)!==scheduleFingerprint/);
  assert.match(worker,/לא לשכוח לדווח נוכחות/);
  assert.match(worker,/\?push=attendance/);assert.match(worker,/\?push=home/);
});

test('0.38.0 deep links shift reminder Pushes to home and attendance',()=>{
  const js=read('push-v0372.js');
  assert.match(js,/target==='attendance'\?'attendance'/);
  assert.match(js,/target==='home'\?'dashboard'/);
});

test('0.38.0 prevents duplicate reminder deliveries in the database',()=>{
  const sql=read('supabase/update-v0.38.0.sql');
  assert.match(sql,/unique\(employee_id,shift_date,reminder_type\)/i);
  assert.match(sql,/hadas_claim_shift_reminder_v038/);
  assert.match(sql,/on conflict\(employee_id,shift_date,reminder_type\) do nothing/i);
  assert.match(sql,/attempts<3/);assert.match(sql,/enable row level security/i);
  assert.match(sql,/revoke all on public\.hadas_shift_reminder_deliveries from anon,authenticated/i);
});

test('0.38.0 uses Supabase pg_cron and pg_net with a Vault token instead of Vercel Hobby cron',()=>{
  const cron=read('supabase/enable-v0.38.0-smart-shift-cron.sql'),vercel=JSON.parse(read('vercel.json')),router=read('api/index.js');
  assert.match(cron,/pg_cron/);assert.match(cron,/pg_net/);assert.match(cron,/vault\.decrypted_secrets/);
  assert.match(cron,/\* \* \* \* \*/);assert.equal(vercel.crons,undefined);
  assert.ok(vercel.rewrites.some(item=>item.source==='/api/push-worker'));
  assert.match(router,/'push-worker': require\('\.\.\/handlers\/push-worker'\)/);
});

test('0.38.0 Push worker is protected by a server-only token and does not create internal notification noise',()=>{
  const worker=read('handlers/push-worker.js'),migration=read('supabase/update-v0.38.0.sql');
  assert.match(worker,/safeEqual\(supplied,expected\)/);
  assert.match(migration,/hadas_get_shift_reminder_worker_token_v038/);
  assert.match(migration,/vault\.create_secret/);
  assert.doesNotMatch(worker,/notifyEmployees\(/);
});
