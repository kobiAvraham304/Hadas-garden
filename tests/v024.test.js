const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const {buildScheduleAvailability,timeToMinutes}=require('../lib/schedule');
const {generateAutomaticSchedule,partialAsNeededIssue}=require('../lib/auto-schedule');

test('0.24 availability includes recurring days off and distinguishes an exceptional worked day',()=>{
  const employees=[
    {id:'fixed',active:true,is_schedulable:true},
    {id:'worked',active:true,is_schedulable:true},
    {id:'leave',active:true,is_schedulable:true},
  ];
  const weeklyPatterns=employees.map((employee)=>({employee_id:employee.id,weekday:0,day_type:employee.id==='leave'?'work':'day_off'}));
  const rows=buildScheduleAvailability({
    employees,weeklyPatterns,weekStart:'2026-08-30',
    shifts:[{employee_id:'worked',shift_date:'2026-08-30'}],
    requests:[{requester_id:'leave',request_type:'leave',status:'approved',request_date:'2026-08-30',request_end_date:'2026-08-30'}],
  });
  assert.deepEqual(rows.map((row)=>[row.employee_id,row.absence_type,row.absence_kind]),[
    ['fixed','fixed_day_off','fixed_day_off'],
    ['leave','leave','one_time_absence'],
    ['worked','day_off_worked','worked_day_off'],
  ]);
});

test('0.24 automatic scheduler expands a tiny as-needed fragment only within availability and weekly limit',()=>{
  const input={
    weekStart:'2026-08-30',selectedDates:['2026-08-30'],mode:'rebuild',
    employees:[
      {id:'fixed',full_name:'קבוע',job_title:'סייעת/ סייע',active:true,is_schedulable:true,assignment_mode:'fixed',primary_class_id:'c',default_start:'07:45',default_end:'15:30'},
      {id:'sub',full_name:'מחליף',job_title:'סייעת/ סייע',active:true,is_schedulable:true,assignment_mode:'substitute',primary_class_id:null,default_start:'07:30',default_end:'15:30',max_weekly_hours:2},
    ],
    classes:[{id:'c',name:'כיתה',active:true,sort_order:1}],
    patterns:[
      {employee_id:'fixed',weekday:0,day_type:'work',start_time:'07:45',end_time:'15:30'},
      {employee_id:'sub',weekday:0,day_type:'as_needed',start_time:null,end_time:null},
    ],
    constraints:[],requests:[],existingShifts:[],previousShifts:[],
    settings:{opening_time:'07:30',morning_end_time:'07:30',closing_time:'15:30',friday_closing_time:'12:00',morning_required_staff:1,required_staff:1,closing_required_staff:1,closing_window_minutes:30,validation_slot_minutes:15,require_leader:false},
  };
  const plan=generateAutomaticSchedule(input);
  const row=plan.generated.find((item)=>item.employee_id==='sub');
  assert.ok(row);
  assert.ok(row.start_time<='07:30'&&row.end_time>='07:45');
  assert.equal(timeToMinutes(row.end_time)-timeToMinutes(row.start_time),120);
  assert.equal(plan.validation.errors.some((item)=>item.code==='max_weekly_hours'||item.code==='short_nonfixed_shift'),false);
  assert.equal(plan.metrics.coveragePercent,100);
});

test('0.24 preview signature changes when inputs change even if the resulting rows are identical',()=>{
  const input={
    weekStart:'2026-08-30',selectedDates:['2026-08-30'],mode:'rebuild',
    employees:[{id:'e',full_name:'שם א',job_title:'סייעת/ סייע',active:true,is_schedulable:true,assignment_mode:'fixed',primary_class_id:'c',default_start:'07:30',default_end:'15:30'}],
    classes:[{id:'c',name:'כיתה',active:true}],patterns:[{employee_id:'e',weekday:0,day_type:'work',start_time:'07:30',end_time:'15:30'}],
    constraints:[],requests:[],existingShifts:[],previousShifts:[],
    settings:{opening_time:'07:30',morning_end_time:'08:15',closing_time:'15:30',friday_closing_time:'12:00',morning_required_staff:1,required_staff:1,closing_required_staff:1,closing_window_minutes:30,validation_slot_minutes:30,require_leader:false},
  };
  const first=generateAutomaticSchedule(input);
  const second=generateAutomaticSchedule({...input,employees:[{...input.employees[0],full_name:'שם ב'}]});
  const comparable=(rows)=>rows.map(({shift_date,class_id,employee_id,start_time,end_time})=>({shift_date,class_id,employee_id,start_time,end_time}));
  assert.deepEqual(comparable(first.generated),comparable(second.generated));
  assert.notEqual(first.signature,second.signature);
});

test('0.24 treats practical partial shifts as warnings and tiny fragments as blocking issues',()=>{
  const employee={id:'e',full_name:'עובד'};const availability={start:'07:30',end:'15:30'};
  const practical=partialAsNeededIssue({employee,availability,row:{employee_id:'e',class_id:'c',shift_date:'2026-08-30',start_time:'13:30',end_time:'15:30'}});
  const tiny=partialAsNeededIssue({employee,availability,row:{employee_id:'e',class_id:'c',shift_date:'2026-08-30',start_time:'13:30',end_time:'14:00'}});
  assert.equal(practical.severity,'warning');assert.equal(practical.code,'partial_as_needed_shift');
  assert.equal(tiny.severity,'error');assert.equal(tiny.code,'short_nonfixed_shift');
});

test('0.24 migration applies automatic schedules atomically and only through the service role',()=>{
  const sql=read('supabase/update-v0.24.0.sql');const schema=read('supabase/schema.sql');
  for(const source of [sql,schema]){
    assert.match(source,/function public\.hadas_apply_automatic_schedule/);
    assert.match(source,/security invoker/i);
    assert.match(source,/pg_advisory_xact_lock/);
    assert.match(source,/hadas_attendance/);assert.match(source,/hadas_daily_operations/);assert.match(source,/בקשה פתוחה/);
    assert.match(source,/with deleted as[\s\S]*insert into public\.hadas_schedule_changes/i);
    assert.match(source,/revoke all on function public\.hadas_apply_automatic_schedule[^;]+from public,anon,authenticated/i);
    assert.match(source,/grant execute on function public\.hadas_apply_automatic_schedule[^;]+to service_role/i);
  }
  assert.doesNotMatch(sql,/drop table|truncate table/i);
  assert.match(sql,/values\(1,'0\.24\.0','0\.24\.0'/);
});

test('0.24 UI explains calendar leave, clarifies notifications and renders daily operations as a responsive table',()=>{
  const app=read('app.js'),html=read('index.html'),css=read('styles.css'),shifts=read('handlers/shifts.js'),daily=read('handlers/daily-operations.js');
  assert.match(app,/approved_leave: 'חופשה מאושרת'/);assert.match(app,/חופשה מאושרת ממערכת הבקשות/);assert.match(app,/calendarEventLabel/);
  assert.match(html,/data-notification-filter="action"/);assert.match(app,/notificationNeedsAction/);assert.match(app,/הטיפול הושלם/);
  assert.match(app,/daily-operations-table/);assert.doesNotMatch(app,/>דיווח על העובד</);assert.match(app,/daily-schedule-source/);assert.match(css,/\.daily-operations-table/);
  assert.match(daily,/scheduleMeta/);assert.match(daily,/latest_shift_update/);
  assert.match(shifts,/automaticSchedulesMatch/);assert.match(shifts,/assertShiftsSafeToDelete/);
});
