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
  assert.match(patch, /button\.id='v036PdfBtn'/);
  assert.match(patch, /data-pdf-mode="week"/);
  assert.match(patch, /data-pdf-mode="month"/);
  assert.match(patch, /data-pdf-action="save"/);
  assert.match(patch, /data-pdf-action="share"/);
  assert.match(patch, /data-pdf-action="print"/);
  assert.match(patch, /\['#printBtn','#imageBtn','#monthImageBtn','#v031PrintBtn'\]/);
  assert.match(patch, /data-copy-schedule-day/);
  assert.match(patch, /v036-off-label/);
  assert.match(patch, /grid-template-columns:repeat\(6,minmax\(148px,1fr\)\)/);
  assert.match(patch, /v036-pdf-launch/);
  assert.match(patch, /canShowUnifiedPdf/);
  assert.doesNotMatch(patch, />העתק יום<\/span>/);
  assert.match(patch, /v036-copy-day-header::after/);
  assert.match(patch, /width:820px!important/);
  assert.match(patch, /size:22/);
  assert.match(patch, /const classColumnX = margin \+ tableWidth - classColumnWidth/);
  assert.match(patch, /function printCanvasDirect/);
  assert.match(patch, /async function pdfFromCanvases/);
  assert.match(patch, /function monthWeekStarts/);
  assert.match(patch, /async function monthSchedulePages/);
  assert.match(patch, /printCanvasesDirect\(context\.canvases\)/);
  assert.match(patch, /עמוד נפרד לכל שבוע/);
  assert.match(patch, /v036-pdf-page-preview/);
  assert.match(patch, /absence_type === 'day_off_worked'/);
  assert.match(patch, /#edf9f1/);
  assert.match(patch, /#fff0f0/);
  assert.match(patch, /const approvedLeave = item\.absence_type === 'leave'/);
  assert.match(patch, /approvedLeave \? '#fff0f0' : '#f8f8fb'/);
  assert.match(patch, /approvedLeave \? '#efb1b1' : '#d9dbe5'/);
  assert.match(patch, /function fitText/);
  assert.match(patch, /ellipsis = true/);
  assert.match(patch, /ellipsis:false/);
  assert.match(patch, /const meta =/);
  assert.match(patch, /size:30, minSize:25, weight:950/);
  assert.match(patch, /const dayHeaderHeight = 64/);
  assert.match(patch, /size:24\.5, minSize:20, weight:950/);
  assert.match(patch, /size:17\.4, minSize:12\.8/);
  assert.match(patch, /size:24, minSize:19, weight:950/);
  assert.match(patch, /const compact = height < 34/);
  assert.doesNotMatch(patch, /const fill = worked \? '#edf9f1' : '#fff0f0'/);
  assert.doesNotMatch(patch, /\+.*נוספים/);
  assert.match(patch, /size:27, minSize:20, weight:950/);
  assert.match(patch, /const absenceHeight = 192/);
  assert.match(patch, /className = 'v036-print-page'/);
  assert.doesNotMatch(patch, /window\.open\('',\s*'_blank'/);
  assert.match(patch, /v036-mobile-day-toggle/);
  assert.match(patch, /installMobileScheduleToggle/);
  assert.match(patch, /schedule-tools-menu:not\(\[open\]\)>\.schedule-secondary-actions/);
  assert.match(patch, /mobile-week-day-body\[hidden\]/);
  assert.match(patch, /state\.v030Validation\.approved = state\.v030Validation\.approved \|\| \[\]/);
  assert.match(patch, /v036-approved-toggle/);
  assert.match(patch, /publication-toggle\.is-unpublished/);
  assert.doesNotMatch(read('index.html'), /schedule-tools-menu" open/);
});

test('0.36 release bootstrap owns the final version guard after legacy layers', () => {
  const entry = read('patch-v025.js');
  const index = read('index.html');
  assert.match(entry, /V0342 = '\/patch-v0342\.js\?v=0370'/);
  assert.match(entry, /installReleaseVersionGuard/);
  assert.match(entry, /__hadasV034VersionObservers/);
  assert.match(entry, /__hadasReleaseVersionObservers/);
  assert.match(index, /patch-v025\.js\?v=0370/);
});
