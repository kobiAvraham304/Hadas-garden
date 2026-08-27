const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const { requiredStaffAt, validateWeek }=require('../lib/schedule');
const { generateAutomaticSchedule }=require('../lib/auto-schedule');

function sample(){
  const classes=[{id:'a',name:'אודם',active:true,sort_order:1},{id:'b',name:'סיני',active:true,sort_order:2}];
  const employees=[
    {id:'ta',full_name:'גננת אודם',job_title:'גננת',active:true,is_schedulable:true,assignment_mode:'fixed',primary_class_id:'a',weekly_hours:40,max_weekly_hours:45,default_start:'07:30',default_end:'15:30'},
    {id:'tb',full_name:'גננת סיני',job_title:'גננת',active:true,is_schedulable:true,assignment_mode:'fixed',primary_class_id:'b',weekly_hours:40,max_weekly_hours:45,default_start:'07:30',default_end:'15:30'},
  ];
  for(let i=0;i<3;i++){ employees.push({id:`a${i}`,full_name:`אודם ${i}`,job_title:'סייעת/ סייע',active:true,is_schedulable:true,assignment_mode:'fixed',primary_class_id:'a',weekly_hours:40,max_weekly_hours:45,default_start:'07:30',default_end:'15:30'}); employees.push({id:`b${i}`,full_name:`סיני ${i}`,job_title:'סייעת/ סייע',active:true,is_schedulable:true,assignment_mode:'fixed',primary_class_id:'b',weekly_hours:40,max_weekly_hours:45,default_start:'07:30',default_end:'15:30'}); }
  const patterns=[]; for(const e of employees) for(let weekday=0;weekday<=5;weekday++) patterns.push({employee_id:e.id,weekday,day_type:'work',start_time:'07:30',end_time:weekday===5?'12:00':'15:30'});
  return {weekStart:'2026-08-02',classes,employees,patterns,constraints:[],requests:[],existingShifts:[],previousShifts:[],settings:{opening_time:'07:30',morning_end_time:'08:15',morning_required_staff:4,closing_time:'15:30',friday_closing_time:'12:00',required_staff:4,closing_required_staff:3,closing_window_minutes:30,validation_slot_minutes:30,require_leader:true}};
}

test('0.19 morning staffing uses its own requirement until 08:15',()=>{
  const settings=sample().settings;
  assert.equal(requiredStaffAt(settings,'2026-08-03',450),4);
  assert.equal(requiredStaffAt({...settings,morning_required_staff:5},'2026-08-03',480),5);
  assert.equal(requiredStaffAt({...settings,morning_required_staff:5},'2026-08-03',495),4);
});

test('0.19 teacher cannot be assigned outside primary class in validation or auto schedule',()=>{
  const input=sample();
  const plan=generateAutomaticSchedule({...input,mode:'rebuild'});
  for(const row of plan.finalRows.filter(r=>r.employee_id==='ta')) assert.equal(row.class_id,'a');
  const invalid=[{shift_date:'2026-08-02',class_id:'b',employee_id:'ta',start_time:'07:30',end_time:'15:30',shift_role:'teacher'}];
  assert.ok(validateWeek({shifts:invalid,classes:input.classes,employees:input.employees,settings:input.settings,constraints:[],weeklyPatterns:input.patterns,weekStart:input.weekStart}).errors.some(e=>e.code==='teacher_fixed_class'));
});

test('0.19 substitute avoid day is supported but explicitly deprioritized',()=>{
  const auto=read('lib/auto-schedule.js'); const matching=read('lib/matching.js'); const employees=read('handlers/employees.js'); const sql=read('supabase/update-v0.19.0.sql');
  assert.match(auto,/day_type === 'avoid'/); assert.match(matching,/עדיף להימנע/); assert.match(employees,/\['work','day_off','as_needed','avoid'\]/); assert.match(sql,/hadas_employee_weekly_patterns_times_check/);
});

test('0.19 auto scheduling supports week choice, issue decisions and borrowed-worker explanations',()=>{
  const html=read('index.html'); const app=read('app.js'); const handler=read('handlers/shifts.js');
  assert.match(html,/id="autoScheduleWeek"/); assert.match(app,/autoScheduleIssueDecisions/); assert.match(app,/data-auto-issue-action="approve"/); assert.match(app,/data-auto-issue-action="reject"/); assert.match(app,/data-auto-issue-action="fix"/); assert.match(handler,/assignmentNotes/); assert.match(app,/auto-assignment-note/);
});

test('0.19 employee editor keeps employee name sticky and saves without full refresh',()=>{
  const html=read('index.html'); const app=read('app.js'); const css=read('styles.css');
  assert.match(html,/id="employeeDialogTitle"/); assert.match(css,/\.employee-sticky-heading\{position:sticky/); const save=app.slice(app.indexOf('async function saveEmployee'),app.indexOf('async function handleEmployeeClick')); assert.doesNotMatch(save,/refreshAll\(/); assert.match(save,/result\.employee/);
});

test('0.19 feedback is available to all and managed only by Linor phone',()=>{
  const html=read('index.html'); const handler=read('handlers/feedback.js'); const router=read('api/index.js'); const vercel=read('vercel.json'); const migration=read('supabase/update-v0.19.0.sql');
  assert.match(html,/id="feedbackBtn"/); assert.match(html,/id="feedbackDialog"/); assert.match(handler,/\+972542521780/); assert.match(handler,/action === 'reply'/); assert.match(handler,/req\.method === 'DELETE'/); assert.match(router,/'feedback'/); assert.match(vercel,/\/api\/feedback/); assert.match(migration,/create table if not exists public\.hadas_feedback/);
});

test('0.19 staffing editor exposes simple morning, day and closing zones',()=>{
  const html=read('index.html'); const app=read('app.js'); const settings=read('handlers/settings.js');
  assert.match(html,/name="morning_required_staff"/); assert.match(html,/name="morning_end_time"/); assert.match(app,/morningRequired/); assert.match(settings,/morning_required_staff/); assert.match(settings,/morning_end_time/);
});

test('0.19 clean schema and migration metadata are current and migration stays non-destructive',()=>{
  const schema=read('supabase/schema.sql'); const migration=read('supabase/update-v0.19.0.sql');
  assert.match(schema,/'0\.19\.0'/); assert.match(schema,/hadas_feedback/); assert.match(schema,/morning_required_staff/); assert.match(schema,/day_type in \('work','day_off','as_needed','avoid'\)/); assert.doesNotMatch(migration,/drop table/i); assert.match(migration,/'0\.19\.0'/);
});
