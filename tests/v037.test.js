const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { generateAutomaticSchedule } = require('../lib/auto-schedule');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const settings = {
  opening_time:'07:30', morning_end_time:'08:15', morning_required_staff:2,
  closing_time:'15:30', friday_closing_time:'12:00', required_staff:2,
  closing_required_staff:2, closing_window_minutes:30, validation_slot_minutes:30,
  require_leader:false, max_daily_staff:5,
};
const baseEmployee=(id,extra={})=>({
  id, full_name:id, job_title:'סייעת/ סייע', active:true, is_schedulable:true,
  assignment_mode:'fixed', primary_class_id:'c1', default_start:'07:30', default_end:'15:30',
  weekly_hours:null, max_weekly_hours:null, ...extra,
});
const pattern=(id,day_type,start='07:30',end='15:30')=>({employee_id:id,weekday:0,day_type,start_time:start,end_time:end});

test('0.37 automatic schedule does not silently create a partial as-needed shift', () => {
  const employees=[
    baseEmployee('full'),
    baseEmployee('late-regular'),
    baseEmployee('need',{assignment_mode:'substitute',primary_class_id:null}),
  ];
  const plan=generateAutomaticSchedule({
    weekStart:'2026-09-20',selectedDates:['2026-09-20'],employees,
    classes:[{id:'c1',name:'סיני',active:true,sort_order:1}],
    patterns:[
      pattern('full','work','07:30','15:30'),
      pattern('late-regular','work','11:30','15:30'),
      pattern('need','as_needed','07:30','15:30'),
    ],
    constraints:[],requests:[],settings,existingShifts:[],previousShifts:[],
  });
  assert.equal(plan.generated.some((row)=>row.employee_id==='need'),false);
  assert.equal(plan.generated.some((row)=>row.employee_id==='late-regular'&&String(row.start_time).startsWith('11:30')),true);
  const suggestion=plan.reviewSuggestions.find((row)=>row.employee_id==='need'&&row.class_id==='c1');
  assert.ok(suggestion,'expected a review suggestion for the as-needed worker');
  assert.equal(suggestion.shift_date,'2026-09-20');
  assert.ok(String(suggestion.explanation||'').includes('מומלץ להוסיף'));
  assert.ok(Array.isArray(suggestion.reasons)&&suggestion.reasons.length);
});

test('0.37 approved late start and early finish remain valid automatic regular hours', () => {
  const employees=[baseEmployee('regular')];
  const plan=generateAutomaticSchedule({
    weekStart:'2026-09-20',selectedDates:['2026-09-20'],employees,
    classes:[{id:'c1',name:'סיני',active:true,sort_order:1}],
    patterns:[pattern('regular','work','07:30','15:30')],
    constraints:[],
    requests:[
      {requester_id:'regular',request_type:'late_start',request_date:'2026-09-20',status:'approved',requested_start:'09:00'},
      {requester_id:'regular',request_type:'early_finish',request_date:'2026-09-20',status:'approved',requested_end:'14:00'},
    ],
    settings:{...settings,morning_required_staff:1,required_staff:1,closing_required_staff:1},
    existingShifts:[],previousShifts:[],
  });
  const row=plan.generated.find((item)=>item.employee_id==='regular');
  assert.ok(row);
  assert.equal(String(row.start_time).slice(0,5),'09:00');
  assert.equal(String(row.end_time).slice(0,5),'14:00');
});

test('0.37 copied day uses human Hebrew absence labels', () => {
  const patch=read('patch-v0342.js');
  assert.match(patch,/function copiedAbsenceLabel/);
  for(const label of ['יום חופשי קבוע','מחלה מאושרת','חופשה מאושרת','יום חופשי מאושר']) assert.match(patch,new RegExp(label));
  assert.match(patch,/copiedAbsenceLabel\(row\)/);
  assert.doesNotMatch(patch,/— \$\{row\.label\|\|row\.absence_type\|\|'חופש'\}/);
});

test('0.37 wide mobile week uses a deterministic LTR scroll origin with an RTL table', () => {
  const patch=read('patch-v033.js');
  assert.match(patch,/direction:ltr!important/);
  assert.match(patch,/schedule-table\{display:table!important;[^}]*direction:rtl!important/);
  assert.match(patch,/schedule-table thead th\{position:static!important/);
  assert.match(patch,/schedule-table \.class-name\{position:static!important/);
  assert.match(patch,/root\.scrollWidth-root\.clientWidth/);
  assert.match(patch,/root\.scrollLeft=maxScroll/);
});

test('0.37 automatic review suggestions are rendered and require an explicit add action', () => {
  const app=read('app.js');
  const shifts=read('handlers/shifts.js');
  assert.match(app,/function autoReviewSuggestionHtml/);
  assert.match(app,/data-auto-review-add/);
  assert.match(app,/הוסף לשיבוץ/);
  assert.match(app,/approveAutoReviewSuggestion/);
  assert.match(app,/revalidateAutomaticPreview/);
  assert.match(shifts,/reviewSuggestions: plan\.reviewSuggestions \|\| \[\]/);
  assert.match(shifts,/reviewSuggestionCount/);
});

test('0.37 release cache chain exposes all changed client layers', () => {
  const index=read('index.html');
  const entry=read('patch-v025.js');
  const pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.version,'0.37.3');
  assert.match(index,/app\.js\?v=0373/);
  assert.match(index,/patch-v025\.js\?v=0373/);
  assert.match(entry,/patch-v033\.js\?v=0333hf14/);
  assert.match(entry,/patch-v0342\.js\?v=0370/);
});


test('0.37 assistant and lead schedule permissions remain constrained on mobile rerenders', () => {
  const patch=read('patch-v033.js');
  const data=read('handlers/data.js');
  assert.match(patch,/setHidden\('#publishScheduleBtn', kind !== 'manager'\)/);
  assert.match(patch,/setHidden\('#scheduleIssuesToggle', kind !== 'manager'\)/);
  assert.match(patch,/setHidden\('#v028ScheduleEmployeeSearch', kind === 'regular'\)/);
  assert.match(patch,/if \(kind === 'regular'\) \{[\s\S]*state\.scheduleMode = 'mine'/);
  assert.match(patch,/state\.profile\.schedule_scope === 'class'/);
  assert.match(data,/publication: manager \? publication : null/);
  assert.match(data,/const visibleScheduleAbsences = fullScheduleViewer/);
});

test('0.37 motion stays lightweight and honors reduced motion', () => {
  const patch=read('patch-v033.js');
  assert.match(patch,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(patch,/animation:v0366PanelIn \.18s/);
  assert.match(patch,/transition:transform \.12s ease/);
  assert.doesNotMatch(patch,/animation-duration:\s*[2-9]s/);
});
