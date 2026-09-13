const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { generateAutomaticSchedule } = require('../lib/auto-schedule');
const { validationApprovalKey } = require('../lib/schedule-approvals');
const shiftsV030 = require('../lib/shifts-v030');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const settings = {
  opening_time:'07:30', morning_end_time:'08:15', morning_required_staff:4,
  closing_time:'15:30', friday_closing_time:'12:00', required_staff:4,
  closing_required_staff:3, closing_window_minutes:30, validation_slot_minutes:30,
  require_leader:false, max_daily_staff:5,
};
const employee = (id) => ({
  id, full_name:id, job_title:'סייעת/ סייע', active:true, is_schedulable:true,
  assignment_mode:'fixed', primary_class_id:'c1', default_start:'07:30', default_end:'15:30',
  weekly_hours:null, max_weekly_hours:null,
});
const work = (id) => ({ employee_id:id, weekday:0, day_type:'work', start_time:'07:30', end_time:'15:30' });

test('0.36 automatic schedule never exceeds max_daily_staff in a class', () => {
  const employees = Array.from({ length:6 }, (_, index) => employee(`e${index + 1}`));
  const plan = generateAutomaticSchedule({
    weekStart:'2026-08-30',
    selectedDates:['2026-08-30'],
    employees,
    classes:[{ id:'c1', name:'אודם', active:true, sort_order:1 }],
    patterns:employees.map((row) => work(row.id)),
    constraints:[], requests:[], settings, existingShifts:[], previousShifts:[],
  });
  const rows = plan.finalRows.filter((row) => row.shift_date === '2026-08-30' && row.class_id === 'c1');
  assert.equal(new Set(rows.map((row) => row.employee_id)).size, 5);
  assert.equal(plan.excluded.some((row) => /מקסימום התקינה בכיתה הוא 5/.test(row.reason || '')), true);
});

test('0.36 general day off is excluded from automatic scheduling', () => {
  const employees = Array.from({ length:4 }, (_, index) => employee(`e${index + 1}`));
  const plan = generateAutomaticSchedule({
    weekStart:'2026-08-30',
    selectedDates:['2026-08-30'],
    employees,
    classes:[{ id:'c1', name:'אודם', active:true, sort_order:1 }],
    patterns:employees.map((row) => work(row.id)),
    constraints:[], requests:[], settings, existingShifts:[], previousShifts:[],
    generalDaysOff:[{ event_date:'2026-08-30', is_general_day_off:true, title:'חופשה כללית' }],
  });
  assert.deepEqual(plan.selectedDates, []);
  assert.equal(plan.finalRows.length, 0);
});

test('0.36 automatic approvals use the same stable key as regular validation approvals', () => {
  const issue = {
    code:'understaffed', date:'2026-08-30', class_id:'c1',
    time:'09:00', end_time:'09:30', count:3, expected:4,
    message:'חסר איש צוות אחד',
  };
  assert.equal(validationApprovalKey(issue), shiftsV030.validationIssueKey(issue));
});

test('0.36 schedule export is unified and keeps old image actions hidden', () => {
  const patch = read('patch-v0342.js');
  assert.match(patch, /button\.textContent = 'שיבוץ PDF'/);
  assert.match(patch, /data-pdf-mode="week"/);
  assert.match(patch, /data-pdf-mode="month"/);
  assert.match(patch, /data-pdf-action="save"/);
  assert.match(patch, /data-pdf-action="share"/);
  assert.match(patch, /data-pdf-action="print"/);
  assert.match(patch, /\['#imageBtn','#monthImageBtn','#v031PrintBtn'\]/);
  assert.match(patch, /data-copy-schedule-day/);
  assert.match(patch, /v036-general-day/);
  assert.match(patch, /grid-template-columns:repeat\(6,minmax\(148px,1fr\)\)/);
  assert.match(patch, /data-v036-pdf/);
  assert.match(patch, /canShowUnifiedPdf/);
  assert.doesNotMatch(patch, />העתק יום<\/span>/);
  assert.match(patch, /v036-copy-day-header::after/);
  assert.match(patch, /width:820px!important/);
  assert.match(patch, /size: 20\.5/);
});

test('0.36 release bootstrap owns the final version guard after legacy layers', () => {
  const entry = read('patch-v025.js');
  const index = read('index.html');
  assert.match(entry, /V0342 = '\/patch-v0342\.js\?v=0360hf1'/);
  assert.match(entry, /installReleaseVersionGuard/);
  assert.match(entry, /__hadasV034VersionObservers/);
  assert.match(entry, /__hadasReleaseVersionObservers/);
  assert.match(index, /patch-v025\.js\?v=0360hf1/);
});
