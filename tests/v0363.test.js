const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('0.36 daily coverage uses the current shared matching engine with full candidate detail', () => {
  const daily = read('handlers/daily-operations.js');
  assert.match(daily, /rankCandidates\(/);
  assert.match(daily, /function buildSuggestionsDetailed/);
  assert.match(daily, /candidate_type/);
  assert.match(daily, /source_shift_id/);
  assert.match(daily, /rejected:matching\.rejected/);
  assert.match(daily, /summary:\{/);
  assert.match(daily, /needed_role:matching\.neededRole/);
  assert.match(daily, /affectedRange\(operation, shift\)/);
});

test('0.36 daily coverage renders the modern shift-editor matching language', () => {
  const app = read('app.js');
  assert.match(app, /function dailySuggestionCandidateCard/);
  assert.match(app, /daily-option-badges/);
  assert.match(app, /daily-coverage-option/);
  assert.match(app, /צריך כיסוי עכשיו/);
  assert.match(app, /function dailyRejectedReasonHtml/);
  assert.match(app, /למה שאר הצוות לא הוצע/);
  assert.match(app, /daily-option-cautions/);
  assert.match(app, /העברה זמנית/);
  assert.doesNotMatch(app, /<article class="daily-suggestion-card/);
});

test('0.36 daily apply stays operational and never mutates the static weekly schedule directly', () => {
  const app = read('app.js');
  const daily = read('handlers/daily-operations.js');
  assert.match(app, /action:'assign',id:state\.dailySuggestionsContext\.id/);
  assert.match(app, /source_shift_id:button\.dataset\.sourceShiftId\|\|null/);
  assert.match(app, /\/api\/daily-operations/);
  assert.match(daily, /hadas_daily_operations'\)\.update\(update\)/);
  assert.doesNotMatch(daily, /from\('hadas_shifts'\)\.update\(/);
  assert.match(daily, /source_shift_id.*chosen\.source_shift_id/);
});

test('0.36 daily matching is responsive on narrow screens', () => {
  const patch = read('patch-v0342.js');
  assert.match(patch, /\.daily-modern-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(patch, /\.daily-modern-grid\{grid-template-columns:1fr!important\}/);
  assert.match(patch, /\.daily-matching-intro/);
  assert.match(patch, /\.daily-rejected-worker/);
});

test('0.36 hf11 cache chain exposes the daily coverage update', () => {
  const index = read('index.html');
  const entry = read('patch-v025.js');
  assert.match(index, /app\.js\?v=0362/);
  assert.match(index, /patch-v025\.js\?v=0365/);
  assert.match(entry, /patch-v0342\.js\?v=0362/);
});


test('0.36.3 validation offers safe proposed fixes and keeps explicit approval separate', () => {
  const core = read('patch-v032-core.js');
  assert.match(core, /הצעת פתרון/);
  assert.match(core, /אישור ותיקון/);
  assert.match(core, /לא נמצא כרגע עובד מומלץ/);
  assert.match(core, /bestRecommended/);
  assert.match(core, /apply_suggestion/);
  assert.match(core, /אישור למרות החריגה/);
  assert.match(core, /data-v032-focus/);
  assert.match(core, /remainingCoverageIssue/);
});

test('0.36.5 mobile schedule controls remain user-controlled and focus uses visible targets', () => {
  const v033 = read('patch-v033.js');
  const v032 = read('patch-v032.js');
  const core = read('patch-v032-core.js');
  const entry = read('patch-v025.js');
  assert.match(v033, /v0364OpenInitialized/);
  assert.match(v033, /tools\.dataset\.v0364OpenInitialized = 'true'/);
  assert.match(core, /visibleFocusNode/);
  assert.match(core, /mobile-week-day\[data-day-index=/);
  assert.match(core, /scrollIntoView\(\{behavior:'smooth',block:'center',inline:'nearest'\}\)/);
  assert.match(v032, /patch-v032-core\.js\?v=0321hf10/);
  assert.match(v033, /patch-v032\.js\?v=0321hf10/);
  assert.match(entry, /patch-v033\.js\?v=0333hf11/);
});


test('0.36.5 validation toggle exposes a rotating open-state chevron', () => {
  const core = read('patch-v032-core.js');
  assert.match(core, /v0364-issues-chevron/);
  assert.match(core, /#scheduleIssuesToggle\[aria-expanded="true"\]/);
  assert.match(core, /insertAdjacentHTML\('beforeend','<i class="v0364-issues-chevron"/);
});

test('0.36.5 mobile compact week can open the existing full horizontal schedule and return', () => {
  const v033 = read('patch-v033.js');
  assert.match(v033, /installV0364MobileWeekInteraction/);
  assert.match(v033, /mobile-week-intro/);
  assert.match(v033, /data-hadas-mobile-wide-week/);
  assert.match(v033, /schedule-desktop-week/);
  assert.match(v033, /overflow-x:auto!important/);
  assert.match(v033, /data-v0364-compact-week/);
  assert.match(v033, /state\.v0364MobileWideWeek = false/);
});


test('0.36.5 full horizontal mobile week overrides the legacy hidden-table rule', () => {
  const v033 = read('patch-v033.js');
  assert.match(v033, /#scheduleExport\.mode-week \.schedule-table\{display:table!important/);
  assert.match(v033, /\.schedule-table-scroll\{display:block!important;overflow:visible!important/);
  assert.match(v033, /-webkit-tap-highlight-color:transparent/);
  assert.doesNotMatch(v033, /mobile-week-intro\[role="button"\]:active\{transform:scale/);
});
