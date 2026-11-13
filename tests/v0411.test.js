const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

const activity=require('../lib/employee-activity');

test('weekly login counter uses Sunday-start Israel calendar dates, including UTC boundary',()=>{
 assert.equal(activity.sundayOf('2026-11-09'),'2026-11-08');
 assert.equal(activity.dateIsrael('2026-11-07T22:30:00Z'),'2026-11-08');
 assert.equal(activity.dateIsrael('2026-11-07T21:30:00Z'),'2026-11-07');
 const rows=activity.summarizeActivity({
  weekStart:'2026-11-08',
  users:[{id:'u1',employee_id:'e1'},{id:'u2',employee_id:'e2'}],
  sessions:[
   {user_id:'u1',created_at:'2026-11-07T21:30:00Z'},
   {user_id:'u1',created_at:'2026-11-07T22:30:00Z'},
   {user_id:'u1',created_at:'2026-11-09T06:30:00Z'},
   {user_id:'u2',created_at:'2026-11-08T12:00:00Z'},
  ],
  subscriptions:[{employee_id:'e1',active:true},{employee_id:'e1',active:true},{employee_id:'e2',active:false}],
 });
 assert.deepEqual(rows.e1,{logins_this_week:2,push_enabled:true});
 assert.deepEqual(rows.e2,{logins_this_week:1,push_enabled:false});
 assert.ok(activity.activitySinceUtc('2026-11-08').startsWith('2026-11-07'));
});
test('only authenticated managers can fetch minimal activity summary',()=>{
 const api=read('handlers/employees.js');
 assert.match(api,/requireSession\(req,\{ manager:true \}\)/);
 assert.match(api,/req\.method==='GET' && String\(req\.query\?\.activity\|\|''\)==='weekly'/);
 assert.match(api,/select\('user_id,created_at'\)/);
 assert.match(api,/select\('employee_id,active'\)\.eq\('active',true\)/);
 assert.match(api,/summarizeActivity\(\{users,sessions,subscriptions,weekStart\}\)/);
 assert.doesNotMatch(api,/send\(res,200,\{[^}]+endpoint/);
 const app=read('app.js');
 assert.match(app,/if\(!isManager\(\)\|\|state\.activeTab!=='employees'\|\|state\.employeeActivityLoading\)return/);
 assert.match(app,/apiFetch\('\/api\/employees\?activity=weekly'/);
});
test('small card activity chips show numeric weekly logins and push registration',()=>{
 const app=read('app.js'),style=read('styles.css');
 assert.match(app,/logins_this_week/);
 assert.match(app,/push_enabled/);
 assert.match(app,/כניסות השבוע/);
 assert.match(app,/פוש פעיל/);
 assert.match(app,/פוש כבוי/);
 assert.match(app,/\$\{activityBadges\}<div class="employee-card-meta"/);
 assert.match(style,/\.employee-card-activity\{display:flex/);
 assert.match(style,/\.employee-activity-pill\.push-state\.enabled/);
 assert.match(style,/@media\(max-width:760px\).*employee-card-activity/s);
});
test('every employee-submitted request type creates a manager push with direct URL',()=>{
 const requests=read('handlers/requests.js');
 for(const type of ['leave','day_off','late_start','early_finish','sick','swap'])assert.ok(requests.includes(type));
 assert.match(requests,/if\(!onBehalf\) \{/);
 assert.match(requests,/notice=requestNotificationText\(request,caller\.employee\.full_name\)/);
 assert.match(requests,/postCreateTasks\.push\(notifyManagers\(\{/);
 assert.match(requests,/push:true,pushUrl:`\/\?push=request&id=\$\{encodeURIComponent\(request\.id\)\}`/);
 assert.match(requests,/actionRequired:true/);
 assert.match(requests,/hadas-swap-ready-/);
 const cancel=read('lib/requests-v030.js');
 assert.match(cancel,/hadas-request-cancel-/);
 assert.match(cancel,/push:true,pushUrl:/);
 const push=read('push-v0372.js');
 assert.match(push,/target==='request'/);
 assert.match(push,/focusRequestCard\(requestId\)/);
});
test('decided requests stop looking pending, without hiding employee outcome notices',()=>{
 const app=read('app.js');
 const start=app.indexOf('function notificationIsUnread(item) {');
 const end=app.indexOf('function notificationOpenLabel(',start);
 assert.ok(start>=0&&end>start);
 const state={profile:{role:'scheduler'},requests:[{id:'r1',status:'approved',request_type:'leave'},{id:'r2',status:'pending',request_type:'leave'},{id:'r3',status:'approved',cancellation_status:'pending'}]};
 const funcs=new Function('state','isManager',app.slice(start,end)+'return {notificationIsUnread,notificationNeedsAction};')(state,()=>true);
 assert.equal(funcs.notificationIsUnread({entity_type:'request',entity_id:'r1',title:'בקשה חדשה: חופשה',read_at:null}),false);
 assert.equal(funcs.notificationNeedsAction({entity_type:'request',entity_id:'r1',action_required:true}),false);
 assert.equal(funcs.notificationIsUnread({entity_type:'request',entity_id:'r2',title:'בקשה חדשה: חופשה',read_at:null}),true);
 assert.equal(funcs.notificationNeedsAction({entity_type:'request',entity_id:'r2',action_required:true}),true);
 assert.equal(funcs.notificationIsUnread({entity_type:'request',entity_id:'r3',title:'בקשת ביטול חופשה ממתינה לאישור',read_at:null}),true);
 assert.equal(funcs.notificationIsUnread({entity_type:'request',entity_id:'r1',title:'הבקשה שלך אושרה',read_at:null}),true);
 assert.match(read('handlers/requests.js'),/action_required',true/);
 assert.match(read('handlers/requests.js'),/read_at:new Date\(\)\.toISOString\(\)/);
 assert.match(read('lib/requests-v030.js'),/read_at:new Date\(\)\.toISOString\(\)/);
 assert.match(app,/state\.notifications\.filter\(notificationIsUnread\)\.length/);
 assert.match(app,/focusRequestCard\(card\.dataset\.entityId\)/);
});
test('release assets are versioned and retain existing scheduling module',()=>{
 const index=read('index.html'),boot=read('patch-v025.js');
 assert.equal(require('../package.json').version,'0.40.13');
 for(const file of ['app.js','patch-v025.js'])assert.ok(index.includes(file+'?v=0413')); for(const file of ['styles.css','push-v0372.js'])assert.ok(index.includes(file+'?v=0411'));
 assert.match(boot,/const VERSION = '0\.40\.13'/);
 assert.match(read('api/index.js'),/'shifts': require\('\.\.\/lib\/shifts-v039'\)/);
});
