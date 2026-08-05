const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const read = (file) => fs.readFileSync(path.join(root,file),'utf8');
const attendance = require('../handlers/attendance');
const daily = require('../handlers/daily-operations');

test('attendance statuses create the correct daily operational range',()=>{
  const shift={id:'s1',employee_id:'e1',class_id:'c1',shift_date:'2026-08-05',start_time:'07:30',end_time:'15:30'};
  assert.equal(attendance.operationPayload('present',shift,'07:30','15:30','', 'm1'),null);
  assert.deepEqual(attendance.operationPayload('late',shift,'09:00','15:30','פקק','m1'),{
    operation_date:'2026-08-05',shift_id:'s1',employee_id:'e1',class_id:'c1',operation_type:'late',start_time:'09:00',end_time:'15:30',note:'פקק',source:'attendance',created_by:'m1'
  });
  assert.equal(attendance.operationPayload('left_early',shift,'07:30','12:00','', 'm1').end_time,'12:00');
  assert.equal(attendance.operationPayload('sick',shift,null,null,'', 'm1').operation_type,'sick');
});

test('daily operations accept contexts without optional attendance arrays',()=>{
  const context={employees:[],shifts:[],requests:[],constraints:[],patterns:[],operations:[],settings:{opening_time:'07:30',closing_time:'15:30',required_staff:4,closing_required_staff:3,validation_slot_minutes:30}};
  assert.deepEqual(daily.buildSuggestions(context,{operation_date:'2026-08-05',employee_id:'x',class_id:'c',operation_type:'sick'},{start_time:'07:30',end_time:'15:30'}),[]);
});

test('0.12 migration is non destructive and links attendance to daily operations',()=>{
  const sql=read('supabase/update-v0.12.0.sql');
  assert.doesNotMatch(sql,/drop\s+table/i);
  assert.match(sql,/add column if not exists source/i);
  assert.match(sql,/attendance_date,status,employee_id/i);
  assert.match(sql,/'0\.12\.0'/);
});

test('daily operations UI contains attendance, bulk actions, filters and direct fixes',()=>{
  const html=read('index.html'); const app=read('app.js'); const css=read('styles.css');
  for(const id of ['dailyStatusChips','markAllPresentBtn','dailyAttendanceDialog','dailyAttendanceForm']) assert.match(html,new RegExp(`id="${id}"`));
  for(const fn of ['saveDailyAttendance','markAllPresent','handleDailyFilterClick','openDailyAttendanceDialog']) assert.match(app,new RegExp(`function ${fn}|async function ${fn}`));
  assert.match(app,/action:'mark_all_present'/);
  assert.match(css,/\.daily-command-center/);
  assert.match(css,/\.attendance-status-grid/);
});

test('shift dialog ranks relevant workers before the full list',()=>{
  const html=read('index.html'); const app=read('app.js');
  assert.match(html,/id="shiftRecommendations"/);
  assert.match(html,/id="shiftEmployeeSearch"/);
  assert.match(html,/id="shiftEmployeeOptionsList"/);
  assert.match(app,/<span>מומלצים<\/span>/);
  assert.match(app,/exclude_shift_id/);
  assert.match(app,/recommendation_level/);
});

test('published schedule changes require an explicit publication decision',()=>{
  const html=read('index.html'); const app=read('app.js');
  assert.match(html,/id="postPublishChangeDialog"/);
  assert.match(app,/showPostPublishChangePrompt/);
  assert.match(app,/השינוי נשמר בטיוטה/);
  assert.match(app,/publishPendingChangeNow/);
});

test('dashboard request and announcement cards are actionable',()=>{
  const app=read('app.js');
  assert.match(app,/data-dashboard-tab="requests"/);
  assert.match(app,/data-dashboard-tab="announcements"/);
  assert.match(app,/data-dashboard-notifications/);
});

test('daily and shift rendering have mobile-first controls',()=>{
  const css=read('styles.css');
  assert.match(css,/@media\(max-width:760px\)[\s\S]*\.daily-card-actions/);
  assert.match(css,/\.shift-recommendations\{display:flex;overflow-x:auto/);
  assert.match(css,/min-height:44px/);
});

test('daily coverage suggestions require a leader when the absent shift was the only leader',()=>{
  const context={
    employees:[
      {id:'staff',full_name:'צוות',job_title:'סייעת/ סייע',is_schedulable:true,can_lead:false},
      {id:'lead',full_name:'מובילה',job_title:'סייעת מובילה',is_schedulable:true,can_lead:true},
    ],
    shifts:[],requests:[],constraints:[],patterns:[],operations:[],attendance:[],
    settings:{opening_time:'07:30',closing_time:'15:30',required_staff:4,closing_required_staff:3,validation_slot_minutes:30,require_leader:true},
  };
  const operation={id:'op',operation_date:'2026-08-05',employee_id:'missing',class_id:'c1',operation_type:'sick'};
  const shift={start_time:'07:30',end_time:'15:30',shift_role:'teacher'};
  const result=daily.buildSuggestions(context,operation,shift);
  assert.equal(result.some((item)=>item.employee_id==='staff'),false);
  assert.equal(result[0].employee_id,'lead');
});
