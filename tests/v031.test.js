const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('0.31 guided tour remains available as the legacy onboarding layer', () => {
  const patch = read('patch-v031.js');
  const login = read('handlers/auth-login.js');
  const me = read('handlers/auth-me.js');
  const migration = read('supabase/update-v0.31.0.sql');
  assert.match(patch, /const VERSION = '0\.31\.0'/);
  assert.match(patch, /דלג על ההדרכה/);
  assert.match(patch, /data-v031-tour-next/);
  assert.match(patch, /onboarding_completed !== false/);
  assert.match(patch, /action:'complete_onboarding'/);
  assert.match(login, /onboarding_completed:Boolean\(user\.onboarding_completed_at\)/);
  assert.match(me, /complete_onboarding/);
  assert.match(me, /onboarding_completed_at/);
  assert.match(migration, /add column if not exists onboarding_completed_at timestamptz/i);
  assert.match(migration, /schema_version = '0\.31\.0'/);
});

test('0.31 image and A4 export layer remains in the compatibility chain', () => {
  const patch = read('patch-v031.js');
  assert.match(patch, /const EXPORT_SCALE = 3/);
  assert.match(patch, /function isFixedDayOff/);
  assert.match(patch, /absence_type:'day_off_worked'/);
  assert.match(patch, /v031PrintBtn/);
  assert.match(patch, /@page\{size:A4 landscape/);
});

test('0.31 validation and picker behavior remains available underneath newer patches', () => {
  const patch = read('patch-v031.js');
  const css = read('patch-v031.css');
  assert.match(patch, /אישור למרות החריגה/);
  assert.match(patch, /ביטול אישור/);
  assert.match(patch, />זמינים<\/button>/);
  assert.match(patch, />בחופשה<\/button>/);
  assert.match(patch, />כולם<\/button>/);
  assert.match(css, /v031-validation-card/);
});

test('0.31 version observer stays scoped to version labels, not the whole DOM', () => {
  const patch = read('patch-v031.js');
  assert.match(patch, /MutationObserver/);
  assert.match(patch, /observer\.observe\(node/);
  assert.doesNotMatch(patch, /observer\.observe\(document\.documentElement/);
});
