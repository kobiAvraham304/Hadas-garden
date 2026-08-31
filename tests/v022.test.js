const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const root=path.resolve(__dirname,'..');const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const {generateAutomaticSchedule}=require('../lib/auto-schedule');
const {validateWeek}=require('../lib/schedule');

test('0.22 metadata and migration align',()=>{
  assert.equal(JSON.parse(read('package.json')).version,'0.33.0');
  assert.match(read('handlers/health.js'),/schema_version === '0\.33\.0'/);
  const sql=read('supabase/update-v0.22.0.sql');
  assert.match(sql,/max_work_days_per_week/);assert.match(sql,/priority_rank/);assert.doesNotMatch(sql,/drop table/i);
});

test('employee card supports ranked class priorities and substitute weekly day cap',()=>{
  const html=read('index.html'),app=read('app.js'),handler=read('handlers/employees.js');
  assert.match(html,/name="max_work_days_per_week"/);assert.match(app,/עדיפות 1/);assert.match(app,/constraint-priority/);
  assert.match(handler,/max_work_days_per_week/);assert.match(handler,/priority_rank/);
  assert.match(app,/activeClasses\.filter\(\(item\)=>item\.id!==primary\)/);
});

test('partial auto scheduling changes only selected dates',()=>{
  const employees=[{id:'e',full_name:'עובד',active:true,is_schedulable:true,assignment_mode:'substitute',job_title:'סייעת/ סייע',default_start:'07:30',default_end:'15:30'}];
  const classes=[{id:'c',name:'כיתה',active:true}];
  const patterns=Array.from({length:6},(_,weekday)=>({employee_id:'e',weekday,day_type:'as_needed'}));
  const existing=[{id:'keep',employee_id:'e',class_id:'c',shift_date:'2026-08-31',start_time:'07:30',end_time:'08:00',shift_role:'staff',status:'draft'}];
  const settings={opening_time:'07:30',morning_end_time:'08:15',closing_time:'15:30',friday_closing_time:'12:00',morning_required_staff:1,required_staff:1,closing_required_staff:1,closing_window_minutes:30,validation_slot_minutes:30,require_leader:false};
  const plan=generateAutomaticSchedule({weekStart:'2026-08-30',selectedDates:['2026-09-01'],employees,classes,patterns,constraints:[],requests:[],settings,existingShifts:existing,previousShifts:[],mode:'rebuild'});
  assert.deepEqual(plan.selectedDates,['2026-09-01']);
  assert.ok(plan.finalRows.some((row)=>row.id==='keep'&&row.shift_date==='2026-08-31'));
  assert.ok(plan.generated.every((row)=>row.shift_date==='2026-09-01'));
});

test('substitute max work days is enforced by validator',()=>{
  const employee={id:'e',full_name:'משלימה',active:true,is_schedulable:true,max_work_days_per_week:2};
  const shifts=['2026-08-30','2026-08-31','2026-09-01'].map((date)=>({employee_id:'e',class_id:'c',shift_date:date,start_time:'08:15',end_time:'09:00',shift_role:'staff'}));
  const validation=validateWeek({shifts,classes:[{id:'c',name:'כיתה',active:true}],employees:[employee],settings:{opening_time:'07:30',morning_end_time:'08:15',closing_time:'15:30',friday_closing_time:'12:00',morning_required_staff:0,required_staff:0,closing_required_staff:0,closing_window_minutes:30,validation_slot_minutes:30,require_leader:false},weekStart:'2026-08-30',constraints:[],weeklyPatterns:[],requests:[]});
  assert.ok(validation.errors.some((item)=>item.code==='max_weekly_days'));
});

test('editing existing shift preserves current hours and schedule cards are direct-edit',()=>{
  const app=read('app.js');
  assert.match(app,/form\.dataset\.originalEmployeeId=initialEmployee/);
  assert.match(app,/preserveExistingHours/);
  const block=app.slice(app.indexOf('function shiftCardHtml'),app.indexOf('function renderMobileWeekClass'));
  assert.match(block,/data-action="edit"/);assert.doesNotMatch(block,/טרם פורסם/);assert.doesNotMatch(block,/מציאת מחליף/);
  assert.doesNotMatch(app.slice(app.indexOf('function renderScheduleWeek'),app.indexOf('function renderScheduleDay')),/suggest-empty/);
});

test('auto decisions show current staffing and flag short non-fixed shifts',()=>{
  const app=read('app.js'),auto=read('lib/auto-schedule.js');
  assert.match(app,/function autoIssuePresenceHtml/);assert.match(app,/מי נמצא כרגע/);
  assert.match(auto,/short_nonfixed_shift/);assert.match(read('handlers/shifts.js'),/selectedDatesForWeek/);
});

test('availability list shows fixed days off, approved absences and worked-day-off exceptions',()=>{
  const handler=read('handlers/shifts.js'),schedule=read('lib/schedule.js'),app=read('app.js'),css=read('styles.css');
  assert.match(handler,/buildScheduleAvailability/);
  assert.match(schedule,/worked \? 'day_off_worked' : 'fixed_day_off'/);
  assert.match(schedule,/absence_kind: worked \? 'worked_day_off' : 'fixed_day_off'/);
  assert.match(app,/day_off_worked/);assert.match(app,/fixed_day_off/);assert.match(css,/one-time-absence/);assert.match(css,/worked-day-off/);assert.match(css,/fixed-day-off/);
});

test('times are force-isolated LTR in RTL schedule',()=>{assert.match(read('styles.css'),/\.time-value.*direction:ltr/s);});
