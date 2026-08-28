const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const read = (file) => fs.readFileSync(path.join(root,file),'utf8');

test('login screen is clean and includes reset guidance, credit and product icon',()=>{
  const html=read('index.html');
  assert.doesNotMatch(html,/בדיקת חיבור/);
  assert.match(html,/לאיפוס סיסמה יש לפנות לאחראית השיבוצים או למנהלת המעון/);
  assert.match(html,/קובי אברהם/);
  assert.match(html,/favicon\.svg/);
  assert.ok(fs.existsSync(path.join(root,'favicon.svg')));
  assert.ok(fs.existsSync(path.join(root,'apple-touch-icon.png')));
  assert.ok(fs.existsSync(path.join(root,'site.webmanifest')));
});

test('schedule issues are hidden behind an accessible action button',()=>{
  const html=read('index.html'); const app=read('app.js'); const css=read('styles.css');
  assert.match(html,/id="scheduleIssuesToggle"/);
  assert.match(html,/id="scheduleWarnings" class="warnings-list hidden"/);
  assert.match(app,/function toggleScheduleIssues/);
  assert.match(app,/aria-expanded/);
  assert.match(css,/\.issues-toggle-btn/);
  assert.match(css,/\.schedule-issues-panel/);
});

test('worker suitability scores are normalized to 1-100 and visualized',()=>{
  const app=read('app.js'); const suggestions=read('handlers/suggestions.js'); const daily=read('handlers/daily-operations.js'); const css=read('styles.css');
  assert.match(app,/normalizeDisplayScore/);
  assert.match(app,/scoreScaleHtml/);
  assert.match(app,/\/100/);
  const matching=read('lib/matching.js');
  assert.match(matching,/function normalizeScore/);
  assert.match(suggestions,/normalizeScore/);
  assert.match(daily,/rankCandidates/);
  assert.match(css,/\.match-score/);
});

test('employee management exposes registration status only in manager payload',()=>{
  const data=read('handlers/data.js'); const app=read('app.js');
  assert.match(data,/last_login_at/);
  assert.match(data,/if \(!manager\) return base/);
  const baseBlock=data.match(/const base = \{([\s\S]*?)\n  \};/)?.[1]||'';
  assert.doesNotMatch(baseBlock,/last_login_at|must_change_password/);
  assert.match(app,/employeeRegistrationState/);
  assert.match(app,/employeeRegistrationSummary/);
});

test('shift roles and staffing settings use clearer language and simple controls',()=>{
  const html=read('index.html'); const app=read('app.js'); const css=read('styles.css');
  assert.match(html,/type="hidden" name="shift_role"/); assert.doesNotMatch(html,/תפקיד בשיבוץ הזה/); assert.match(app,/suggestedShiftRoleForEmployee/);
  assert.match(html,/standards-preset-cards/);
  assert.match(html,/data-step-field="required_staff"/);
  assert.match(app,/handleSettingsStepper/);
  assert.match(css,/\.staffing-stepper-card/);
  assert.match(css,/\.standards-live-summary/);
});

test('schedule validation is memoized for faster repeated rendering',()=>{
  const app=read('app.js');
  assert.match(app,/scheduleValidationCache/);
  assert.match(app,/function scheduleValidationKey/);
  assert.match(app,/state\.scheduleValidationCache\.key === validationKey/);
});
