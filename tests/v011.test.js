const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const { closingTimeForDate, validateWeek }=require('../lib/schedule');
const { scheduleScope, canViewClassSchedule, canViewFullSchedule }=require('../lib/server');
const daily=require('../handlers/daily-operations');

const settings={opening_time:'07:30',closing_time:'15:30',friday_closing_time:'12:00',required_staff:4,closing_required_staff:3,closing_window_minutes:30,validation_slot_minutes:30,require_leader:true};

function caller(title,role='employee',primary='c1'){
  return {user:{role},employee:{job_title:title,primary_class_id:primary}};
}

test('Friday closes at 12 while Sunday-Thursday close at 15:30',()=>{
  assert.equal(closingTimeForDate(settings,'2026-08-07'),'12:00');
  assert.equal(closingTimeForDate(settings,'2026-08-06'),'15:30');
});

test('Friday shifts after 12 are blocking errors',()=>{
  const result=validateWeek({
    shifts:[{id:'s',shift_date:'2026-08-07',class_id:'c',employee_id:'e',start_time:'07:30',end_time:'12:30',shift_role:'teacher'}],
    classes:[],employees:[{id:'e',full_name:'בדיקה',active:true,is_schedulable:true}],settings,weekStart:'2026-08-02',
  });
  assert.equal(result.errors.some((item)=>item.code==='outside_opening_hours'),true);
});

test('lead assistant receives class-only schedule scope',()=>{
  const lead=caller('סייעת מובילה');
  assert.equal(scheduleScope(lead),'class');
  assert.equal(canViewClassSchedule(lead),true);
  assert.equal(canViewFullSchedule(lead),false);
});

test('assistant receives personal scope while teacher, nurse, secretary and manager receive full scope',()=>{
  assert.equal(scheduleScope(caller('סייעת/ סייע')),'personal');
  for(const title of ['גננת','אחות','מזכירה','מנהלת מעון']) assert.equal(scheduleScope(caller(title)),'full',title);
  assert.equal(scheduleScope(caller('סייעת/ סייע','scheduler')),'full');
});

test('employee API defines exact nursery roles and assignment modes',()=>{
  const code=read('handlers/employees.js');
  for(const title of ['סייעת/ סייע','סייעת מובילה','גננת','מנהלת מעון','מזכירה','אחות']) assert.match(code,new RegExp(title));
  assert.match(code,/fixed','rotation','substitute','no_schedule/);
  assert.match(code,/dayType === 'as_needed'/);
  assert.match(code,/weekday === 5[\s\S]*12:00/);
});

test('manager, nurse and secretary are forced outside the scheduling pool',()=>{
  const code=read('handlers/employees.js');
  assert.match(code,/NON_SCHEDULABLE_TITLES = new Set\(\['מזכירה','אחות','מנהלת מעון'\]\)/);
  assert.match(code,/payload\.assignment_mode = 'no_schedule'/);
  assert.match(code,/payload\.primary_class_id = null/);
});

test('employee form exposes fixed class, rotation and substitute modes with no separate can-lead checkbox',()=>{
  const html=read('index.html');
  assert.match(html,/value="fixed">כיתה קבועה/);
  assert.match(html,/value="rotation">רוטציה בין כיתות/);
  assert.match(html,/value="substitute">משלימ\/ת מקום/);
  assert.doesNotMatch(html,/name="can_lead"/);
});

test('employee summary cards are clickable and filter role groups',()=>{
  const app=read('app.js');
  assert.match(app,/data-employee-summary-filter/);
  assert.match(app,/handleEmployeeSummaryClick/);
  for(const value of ['assistant','lead','teacher','flexible']) assert.match(app,new RegExp(`'${value}'`));
});

test('vacation request shows manual form reminder after two days and stores day-off scheduling choice',()=>{
  const html=read('index.html'); const app=read('app.js'); const api=read('handlers/requests.js');
  assert.match(html,/id="leaveManualReminder"/);
  assert.match(html,/name="allow_schedule_on_day_off"/);
  assert.match(app,/type==='leave'&&days>2/);
  assert.match(api,/inclusiveDays\(payload\.request_date,payload\.request_end_date\) > 2/);
  assert.match(api,/allow_schedule_on_day_off/);
});

test('daily operations screen and dialogs are wired in the UI and unified API',()=>{
  const html=read('index.html'); const app=read('app.js'); const vercel=JSON.parse(read('vercel.json'));
  for(const id of ['dailyPanel','dailyDate','dailySummary','dailyClasses','dailyReportDialog','dailySuggestionsDialog']) assert.match(html,new RegExp(`id="${id}"`));
  for(const fn of ['renderDailyOperations','loadDailyOperations','saveDailyReport','loadDailySuggestions','handleDailySuggestionClick']) assert.match(app,new RegExp(`function ${fn}|async function ${fn}`));
  assert.ok(vercel.rewrites.some((item)=>item.source==='/api/daily-operations'&&item.destination==='/api/index?route=daily-operations'));
});

test('daily operations API supports report, suggestions, assign and reopen actions',()=>{
  const code=read('handlers/daily-operations.js');
  for(const action of ['report','suggestions','assign','reopen']) assert.match(code,new RegExp(`action==='${action}'|action === '${action}'`));
  for(const type of ['sick','absent','late','early_release','other']) assert.match(code,new RegExp(type));
});

test('daily recommendation engine excludes fixed day off and forbidden class',()=>{
  const context={
    employees:[
      {id:'off',full_name:'חופשי',job_title:'סייעת/ סייע',is_schedulable:true,assignment_mode:'fixed',max_weekly_hours:40},
      {id:'blocked',full_name:'אסור',job_title:'סייעת/ סייע',is_schedulable:true,assignment_mode:'rotation',max_weekly_hours:40},
      {id:'needed',full_name:'לפי צורך',job_title:'סייעת/ סייע',is_schedulable:true,assignment_mode:'substitute',max_weekly_hours:40},
      {id:'missing',full_name:'חסר',job_title:'סייעת/ סייע',is_schedulable:true,assignment_mode:'fixed',max_weekly_hours:40},
    ],
    shifts:[],requests:[],operations:[],settings,
    constraints:[{employee_id:'blocked',class_id:'c1',constraint_type:'forbidden'}],
    patterns:[
      {employee_id:'off',weekday:1,day_type:'day_off'},
      {employee_id:'needed',weekday:1,day_type:'as_needed'},
    ],
  };
  const operation={operation_date:'2026-08-03',employee_id:'missing',class_id:'c1',operation_type:'sick'};
  const shift={start_time:'07:30',end_time:'15:30'};
  const result=daily.buildSuggestions(context,operation,shift);
  assert.equal(result.some((item)=>item.employee_id==='off'),false);
  assert.equal(result.some((item)=>item.employee_id==='blocked'),false);
  assert.equal(result[0].employee_id,'needed');
});

test('emergency transfer is rejected when source class would lose its leader or staffing',()=>{
  const context={settings,operations:[],shifts:[
    {shift_date:'2026-08-03',class_id:'source',employee_id:'leader',start_time:'07:30',end_time:'15:30',shift_role:'lead'},
    {shift_date:'2026-08-03',class_id:'source',employee_id:'a',start_time:'07:30',end_time:'15:30',shift_role:'staff'},
    {shift_date:'2026-08-03',class_id:'source',employee_id:'b',start_time:'07:30',end_time:'15:30',shift_role:'staff'},
    {shift_date:'2026-08-03',class_id:'source',employee_id:'c',start_time:'07:30',end_time:'15:30',shift_role:'staff'},
  ]};
  assert.equal(daily.sourceClassCanRelease(context,'source','leader','2026-08-03','08:00','10:00'),false);
  assert.equal(daily.sourceClassCanRelease(context,'source','a','2026-08-03','08:00','10:00'),false); // only 3 remain, below regular 4
});

test('daily operational coverage removes absent employees and adds resolved replacements',()=>{
  const app=read('app.js');
  assert.match(app,/function dailyCoverageForClass/);
  assert.match(app,/active\.delete\(operation\.employee_id\)/);
  assert.match(app,/active\.set\(operation\.replacement_employee_id/);
  assert.match(app,/replacement_from_class_id===classId/);
});

test('staffing settings expose Friday close, closing window, validation interval and leader rule',()=>{
  const html=read('index.html'); const app=read('app.js'); const api=read('handlers/settings.js');
  for(const name of ['friday_closing_time','closing_window_minutes','validation_slot_minutes','require_leader']) assert.match(html,new RegExp(`name="${name}"`));
  assert.match(app,/שישי/); assert.match(app,/fridayClosing/);
  assert.match(api,/ביום שישי המעון פועל עד 12:00/);
});

test('0.11 migration is non-destructive and adds all new database fields',()=>{
  const sql=read('supabase/update-v0.11.0.sql');
  assert.match(sql,/begin;/i); assert.match(sql,/commit;/i); assert.doesNotMatch(sql,/drop table/i);
  assert.match(sql,/friday_closing_time/); assert.match(sql,/require_leader/); assert.match(sql,/allow_schedule_on_day_off/);
  assert.match(sql,/assignment_mode in \('fixed','rotation','substitute','no_schedule'\)/);
  assert.match(sql,/day_type in \('work','day_off','as_needed'\)/);
  assert.match(sql,/create table if not exists public\.hadas_daily_operations/);
  assert.match(sql,/hadas_daily_operations_shift_unique/);
  assert.match(sql,/values\(1,'0\.11\.0','0\.11\.0'\)/);
});

test('employee private fields remain server-side for non managers',()=>{
  const data=read('handlers/data.js');
  assert.match(data,/if \(!manager\) return base/);
  const base=data.match(/const base = \{([\s\S]*?)\n  \};/)?.[1]||'';
  for(const field of ['admin_notes','phone','weekly_hours','max_weekly_hours','weekly_patterns']) assert.doesNotMatch(base,new RegExp(field));
  assert.match(read('index.html'),/המידע בכרטיס העובד חסוי/);
});

test('responsive styling covers daily operations and horizontal employee summaries',()=>{
  const css=read('styles.css');
  for(const selector of ['.daily-classes','.daily-worker-card','.daily-reason-grid','.employee-summary-button']) assert.match(css,new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(css,/@media\(max-width:760px\)[\s\S]*\.daily-classes\{grid-template-columns:1fr/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*\.employee-summary\{display:flex;overflow-x:auto/);
});

test('clean schema creates manager account as non schedulable without a class',()=>{
  const schema=read('supabase/schema.sql');
  assert.match(schema,/VALUES\('אילנית זאדייב','\+972544594513','מנהלת מעון',false,true,'no_schedule',false,null\)/i);
  assert.match(schema,/assignment_mode='no_schedule', is_schedulable=false, primary_class_id=null/);
});

test('application initializes after all runtime functions are defined',()=>{
  const app=read('app.js').trim();
  assert.match(app,/init\(\);$/);
});

test('saving a daily absence immediately opens safe coverage suggestions',()=>{
  const app=read('app.js');
  assert.match(app,/result\.operation\?\.id\)await loadDailySuggestions\(result\.operation\.id\)/);
  assert.match(app,/הדיווח נשמר — מוצגות אפשרויות כיסוי/);
});
