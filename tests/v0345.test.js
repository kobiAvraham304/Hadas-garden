const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('validation sync hotfix is loaded after the current announcement layers', () => {
  const entry = read('patch-v025.js');
  assert.match(entry, /const V0345 = '\/patch-v0345\.js\?v=0345a'/);
  assert.match(entry, /await loadScript\(V0344, 'v0344'\);\s*\n\s*await loadScript\(V0345, 'v0345'\)/);
});

test('managers never see raw validation errors while server approvals are unresolved', () => {
  const patch = read('patch-v0345.js');
  assert.match(patch, /if \(isManager\(\) && !validationIsCurrent\(\)\) return \{ errors: \[\], warnings: \[\], pending: true \}/);
  assert.match(patch, /toggle\.classList\.remove\('has-errors', 'has-warnings', 'is-ok'\)/);
  assert.match(patch, /count\.textContent = 'מסנכרן בדיקות…'/);
  assert.match(patch, /האישורים שכבר נשמרו נטענים לפני הצגת תוצאות/);
});

test('weekly refresh keeps current approval state when the actual schedule did not change', () => {
  const patch = read('patch-v0345.js');
  assert.match(patch, /const beforeKey = validationKey\(\)/);
  assert.match(patch, /const hadCurrentValidation = validationIsCurrent\(\)/);
  assert.match(patch, /fetchScheduleWeek\(state\.weekStart, \{ force, apply: false \}\)/);
  assert.match(patch, /const scheduleUnchanged = beforeKey === afterKey/);
  assert.match(patch, /if \(!\(hadCurrentValidation && scheduleUnchanged\)\) \{\s*await ensureValidationCurrent\(\{ force: true \}\)/);
  assert.doesNotMatch(patch, /v030ValidationKey\s*=\s*''/);
});

test('changed schedules synchronize approvals before rendering validation state', () => {
  const patch = read('patch-v0345.js');
  const syncIndex = patch.indexOf("await ensureValidationCurrent({ force: true });");
  const renderIndex = patch.indexOf('renderSchedule();', syncIndex);
  assert.ok(syncIndex > 0);
  assert.ok(renderIndex > syncIndex);
  assert.match(patch, /state\.v0345ValidationPromise/);
  assert.match(patch, /await waitForLegacyValidation\(\)/);
});
