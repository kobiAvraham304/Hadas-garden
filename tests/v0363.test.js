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
  assert.match(app, /נדרש כיסוי/);
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

test('0.36 hf10 cache chain exposes the daily coverage update', () => {
  const index = read('index.html');
  const entry = read('patch-v025.js');
  assert.match(index, /app\.js\?v=0360hf10/);
  assert.match(index, /patch-v025\.js\?v=0360hf10/);
  assert.match(entry, /patch-v0342\.js\?v=0360hf10/);
});
