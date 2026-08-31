const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { rankCandidates, unavailableReason } = require('../lib/matching');

function employee(id, extra = {}) {
  return { id, full_name:`עובד ${id}`, active:true, is_schedulable:true, assignment_mode:'rotation', default_start:'07:30', default_end:'15:30', job_title:'סייעת/סייע', weekly_hours:40, max_weekly_hours:45, ...extra };
}
function context() {
  const date='2026-08-02';
  return {
    date, classId:'a', start:'07:30', end:'15:30', neededRole:'staff',
    employees:[
      employee('fixed-other',{assignment_mode:'fixed',primary_class_id:'b'}),
      employee('sub',{assignment_mode:'substitute'}),
      employee('rotation'),
      employee('pending'),
      employee('approved'),
      employee('resolved-cover'),
      employee('forbidden'),
    ],
    shifts:[],
    requests:[
      {requester_id:'pending',request_type:'leave',status:'pending',request_date:date,request_end_date:date},
      {requester_id:'approved',request_type:'leave',status:'approved',request_date:date,request_end_date:date},
    ],
    constraints:[{employee_id:'forbidden',class_id:'a',constraint_type:'forbidden'}],
    patterns:[], attendance:[], classes:[{id:'a',name:'אודם'},{id:'b',name:'סיני'}],
    operations:[{id:'op',operation_date:date,status:'resolved',replacement_employee_id:'resolved-cover',replacement_start:'07:30',replacement_end:'15:30'}],
    settings:{opening_time:'07:30',closing_time:'15:30',friday_closing_time:'12:00',required_staff:4,closing_required_staff:3,closing_window_minutes:30,validation_slot_minutes:30,require_leader:true},
  };
}

test('0.17 matching keeps valid fixed-class alternatives and excludes only true blockers', () => {
  const result=rankCandidates(context());
  const ids=result.candidates.map(x=>x.employee_id);
  assert.ok(ids.includes('fixed-other'), 'fixed employee from another class remains a visible lower-priority option when free');
  assert.ok(ids.includes('sub'));
  assert.ok(ids.includes('rotation'));
  assert.ok(ids.includes('pending'), 'pending leave does not block until approved');
  assert.ok(!ids.includes('approved'));
  assert.ok(!ids.includes('resolved-cover'));
  assert.ok(!ids.includes('forbidden'));
  assert.ok(result.rejected.some(x=>x.employee_id==='approved' && /חופשה/.test(x.reason)));
  assert.ok(result.rejected.some(x=>x.employee_id==='resolved-cover' && /כיסוי/.test(x.reason)));
});

test('0.17 matching results are score-normalized, explained and consistently ordered', () => {
  const result=rankCandidates(context());
  assert.ok(result.candidates.every(x=>x.score>=1 && x.score<=100));
  assert.ok(result.candidates.every(x=>Array.isArray(x.reasons) && x.reasons.length));
  const scores=result.candidates.map(x=>x.score);
  assert.deepEqual(scores,[...scores].sort((a,b)=>b-a));
});

test('0.17 add, replace and daily operations share the same matching module', () => {
  const suggestions=read('handlers/suggestions.js');
  const daily=read('handlers/daily-operations.js');
  assert.match(suggestions,/require\('\.\.\/lib\/matching'\)/);
  assert.match(daily,/require\('\.\.\/lib\/matching'\)/);
  assert.match(suggestions,/rankCandidates\(/);
  assert.match(daily,/rankCandidates\(/);
});

test('0.17 export uses direct landscape canvas and monthly weekly image files', () => {
  const app=read('app.js');
  const index=read('index.html');
  assert.match(app,/function drawWeeklyScheduleCanvas/);
  assert.match(app,/const width = 1920/);
  assert.match(app,/files\.push\(new File/);
  assert.match(index,/שבוע כתמונה/);
  assert.doesNotMatch(index,/html2canvas/i);
  assert.doesNotMatch(app,/html2canvas/i);
});

test('0.17 mobile surface avoids horizontal carousels and bottom browser conflicts', () => {
  const css=read('styles.css');
  assert.match(css,/\.main-nav\{position:sticky!important;top:56px!important/);
  assert.match(css,/\.filter-chips,\.employee-form-nav\{display:flex!important;flex-wrap:wrap!important;overflow:visible!important/);
  assert.match(css,/\.calendar-shell\{inline-size:100%!important;max-inline-size:100%!important;overflow:hidden!important/);
  assert.match(css,/dialog\.modal\{position:fixed!important;inset:0!important/);
  const finalBlock=css.slice(css.lastIndexOf('v0.17.0 final mobile hardening'));
  assert.doesNotMatch(finalBlock,/\.filter-chips\{[^}]*overflow-x:auto/);
});

test('0.17 cache headers force mobile browsers to receive the current UI', () => {
  const index=read('index.html');
  const vercel=JSON.parse(read('vercel.json'));
  assert.match(index,/styles\.css\?v=0332/);
  assert.match(index,/app\.js\?v=0332/);
  assert.match(index,/patch-v025\.css\?v=0332/);
  assert.match(index,/patch-v025\.js\?v=0332/);
  const serialized=JSON.stringify(vercel);
  assert.match(serialized,/no-store/);
});

test('0.17 rejected candidate explanations are present in both employee picker and replacement dialog', () => {
  const app=read('app.js');
  assert.match(app,/function rejectedReasonsHtml/);
  assert.match(app,/למה עובדים אחרים לא הופיעו/);
  assert.match(app,/state\.shiftPickerRejected = result\.rejected/);
  assert.match(app,/const rejectedHtml = rejectedReasonsHtml/);
});

test('0.17 QA fixtures cover schedule, sticky dialog and fitted month grid', () => {
  for (const file of ['qa/v017/mobile-schedule.html','qa/v017/shift-dialog.html','qa/v017/calendar.html']) assert.ok(fs.existsSync(path.join(root,file)),file);
});
