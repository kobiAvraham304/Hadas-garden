const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { rankCandidates, scoreCandidate } = require('../lib/matching');

test('0.36 coverage ranks substitute + as-needed as a strong intended replacement', () => {
  const result = scoreCandidate({
    employee:{ id:'sub', assignment_mode:'substitute', weekly_hours:null, job_title:'סייעת/ סייע' },
    targetClassId:'target',
    neededRole:'staff',
    pattern:{ day_type:'as_needed' },
    constraint:null,
    weeklyMinutes:0,
    requestedMinutes:150,
    candidateType:'direct',
    sourceShift:null,
    availability:{ start:'07:30', end:'15:30' },
  });
  assert.ok(result.score >= 80, `expected substitute score >= 80, got ${result.score}`);
  assert.equal(result.recommended, true);
  assert.ok(result.reasons.some((reason) => /ממלא/.test(reason)));
  assert.ok(!result.cautions.some((reason) => /עדיפות נמוכה/.test(reason)));
});

test('0.36 daily matching can use a safe temporary slice of a longer source shift', () => {
  const date='2026-09-14';
  const employees=[
    { id:'mover', full_name:'עובדת להעברה', active:true, is_schedulable:true, assignment_mode:'fixed', primary_class_id:'source', job_title:'סייעת/ סייע', weekly_hours:null, max_weekly_hours:null },
    { id:'keeper', full_name:'עובדת מקור', active:true, is_schedulable:true, assignment_mode:'fixed', primary_class_id:'source', job_title:'סייעת/ סייע', weekly_hours:null, max_weekly_hours:null },
  ];
  const shifts=[
    { id:'s1', employee_id:'mover', class_id:'source', shift_date:date, start_time:'07:30', end_time:'15:30', shift_role:'staff' },
    { id:'s2', employee_id:'keeper', class_id:'source', shift_date:date, start_time:'07:30', end_time:'15:30', shift_role:'staff' },
  ];
  const patterns=[
    { employee_id:'mover', weekday:1, day_type:'work', start_time:'07:30', end_time:'15:30' },
    { employee_id:'keeper', weekday:1, day_type:'work', start_time:'07:30', end_time:'15:30' },
  ];
  const base={
    employees,shifts,patterns,requests:[],constraints:[],operations:[],attendance:[],
    classes:[{id:'target',name:'אודם',active:true},{id:'source',name:'סיני',active:true}],
    settings:{ opening_time:'07:30', morning_end_time:'08:15', closing_time:'15:30', morning_required_staff:1, required_staff:1, closing_required_staff:1, closing_window_minutes:30, validation_slot_minutes:30, require_leader:false },
    date,classId:'target',start:'08:00',end:'10:30',neededRole:'staff'
  };
  const daily=rankCandidates({...base,allowPartialTransfer:true});
  const mover=daily.candidates.find((row)=>row.employee_id==='mover');
  assert.ok(mover, 'temporary transfer should be available');
  assert.equal(mover.candidate_type,'transfer');
  assert.equal(mover.transfer_mode,'partial');
  assert.equal(mover.from_class_name,'סיני');
  assert.equal(mover.source_start_time,'07:30');
  assert.equal(mover.source_end_time,'15:30');

  const staticEditor=rankCandidates(base);
  assert.equal(staticEditor.candidates.some((row)=>row.employee_id==='mover'),false);
  assert.ok(staticEditor.rejected.some((row)=>row.employee_id==='mover' && /טווח שעות זהה/.test(row.reason)));
});

test('0.36 only Daily Operations enables partial transfers', () => {
  const daily=read('handlers/daily-operations.js');
  const suggestions=read('handlers/suggestions.js');
  assert.match(daily,/allowPartialTransfer:\s*true/);
  assert.doesNotMatch(suggestions,/allowPartialTransfer:\s*true/);
});

test('0.36 coverage UI is a single decision surface, not a two-column cards-list', () => {
  const index=read('index.html');
  const app=read('app.js');
  const patch=read('patch-v0342.js');
  assert.match(index,/id="dailySuggestionsList" class="daily-coverage-results"/);
  assert.doesNotMatch(index,/id="dailySuggestionsList" class="cards-list"/);
  assert.match(app,/function dailyCoverageSummary|daily-coverage-summary/);
  assert.match(app,/למה שאר הצוות לא הוצע/);
  assert.match(app,/מסך השיבוצים השבועי נשאר ללא שינוי/);
  assert.match(patch,/#dailySuggestionsList\.daily-coverage-results\{display:grid!important;grid-template-columns:minmax\(0,1fr\)!important/);
  assert.match(patch,/\.daily-modern-grid\{display:grid!important;grid-template-columns:minmax\(0,1fr\)!important/);
});

test('0.36 shift editor makes existing class assignment and replacement behavior explicit', () => {
  const app=read('app.js');
  const v026=read('patch-v026.js');
  const index=read('index.html');
  assert.match(app,/function shiftCurrentAssignments/);
  assert.match(app,/משובץ\/ת כרגע/);
  assert.match(app,/מה יקרה בשמירה\?/);
  assert.match(app,/לא ייווצר שיבוץ כפול/);
  assert.match(app,/קיים שיבוץ — השיבוץ הזה יועבר/);
  assert.match(app,/כבר משובץ\/ת בטווח הזה — לא ניתן ליצור שיבוץ כפול/);
  assert.match(v026,/בחירת עובד\/ת אחר\/ת/);
  assert.match(v026,/רק פותח את רשימת המועמדים/);
  assert.match(v026,/העובד\/ת הנוכחי\/ת נשאר\/ת בשיבוץ עד שתבחר\/י מחליף\/ה/);
  assert.match(index,/אם עובד\/ת כבר משובץ\/ת בכיתה אחרת/);
});

test('0.36 hf13 cache chain delivers mobile coverage fix plus existing matching/UI changes', () => {
  const index=read('index.html');
  const entry=read('patch-v025.js');
  assert.match(index,/app\.js\?v=0362/);
  assert.match(index,/patch-v025\.js\?v=0362/);
  assert.match(entry,/patch-v026\.js\?v=0321hf12/);
  assert.match(entry,/patch-v0342\.js\?v=0362/);
});


test('0.36 low-score coverage is explicitly backup-only and requires confirmation', () => {
  const app=read('app.js');
  const patch=read('patch-v0342.js');
  assert.match(app,/return 'גיבוי בלבד'/);
  assert.match(app,/אין כרגע כיסוי מומלץ/);
  assert.match(app,/לא מומלצת אוטומטית/);
  assert.match(app,/data-recommended=/);
  assert.match(app,/בחירה חריגה/);
  assert.match(app,/אינה אפשרות מומלצת \(ציון/);
  assert.doesNotMatch(app,/אפשרויות בטוחות/);
  assert.match(patch,/\.daily-coverage-option\.is-backup/);
  assert.match(patch,/\.daily-option-decision\.warn/);
  assert.match(patch,/\.daily-cover-action\.is-backup-action/);
});

test('0.36 coverage card and modal always stretch to usable width', () => {
  const patch=read('patch-v0342.js');
  assert.match(patch,/#dailySuggestionsDialog\{width:min\(1180px/);
  assert.match(patch,/\.daily-coverage-option\{width:100%!important/);
  assert.match(patch,/grid-template-areas:"decision decision"/);
  assert.match(patch,/grid-template-areas:"decision" "main" "source" "reasons" "cautions" "action"/);
});


test('0.36 mobile coverage keeps decision area and full-width content', () => {
  const patch=read('patch-v0342.js');
  assert.match(patch,/grid-template-areas:"decision" "main" "source" "reasons" "cautions" "action"!important/);
  assert.match(patch,/\.daily-option-main\{grid-area:main!important;display:grid!important;grid-template-columns:minmax\(0,1fr\) 72px!important/);
  assert.match(patch,/\.daily-option-badges>span\{[^}]*white-space:nowrap!important/);
  assert.match(patch,/\.daily-cover-action\{grid-area:action!important;width:100%!important/);
});
