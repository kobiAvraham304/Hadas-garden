const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('0.31 candidate metadata and legacy entrypoint are aligned', () => {
  assert.equal(JSON.parse(read('package.json')).version, '0.31.0');
  assert.match(read('VERSION.md'), /גרסה 0\.31\.0/);
  const entry = read('patch-v025.js');
  const cssEntry = read('patch-v025.css');
  assert.match(entry, /const VERSION = '0\.31\.0'/);
  assert.match(entry, /V031 = '\/patch-v031\.js\?v=0310'/);
  assert.match(entry, /await loadScript\(V031, 'v031'\)/);
  assert.match(cssEntry, /patch-v031\.css\?v=0310/);
  assert.match(read('patch-v031.css'), /content:'v0\.31\.0'/);
  assert.match(read('patch-v031.js'), /MutationObserver/);
  assert.match(read('patch-v031.js'), /__HADAS_RELEASE_VERSION/);
});

test('0.31 guided tour is short, skippable and persisted per user', () => {
  const patch = read('patch-v031.js');
  const login = read('handlers/auth-login.js');
  const me = read('handlers/auth-me.js');
  const migration = read('supabase/update-v0.31.0.sql');
  assert.match(patch, /דלג על ההדרכה/);
  assert.match(patch, /data-v031-tour-next/);
  assert.match(patch, /onboarding_completed === false/);
  assert.match(patch, /action:'complete_onboarding'/);
  assert.match(login, /onboarding_completed:Boolean\(user\.onboarding_completed_at\)/);
  assert.match(me, /complete_onboarding/);
  assert.match(me, /onboarding_completed_at/);
  assert.match(migration, /add column if not exists onboarding_completed_at timestamptz/i);
  assert.match(migration, /last_login_at is not null/i);
  assert.match(migration, /schema_version = '0\.31\.0'/);
});

test('0.31 image exports derive worked fixed days off and use high resolution', () => {
  const patch = read('patch-v031.js');
  assert.match(patch, /const EXPORT_SCALE = 3/);
  assert.match(patch, /function isFixedDayOff/);
  assert.match(patch, /absence_type:'day_off_worked'/);
  assert.match(patch, /exportAvailabilityRows/);
  assert.match(patch, /image\/png/);
  assert.match(patch, /שבוע כתמונה/);
  assert.match(patch, /חודש כתמונות/);
});

test('0.31 adds an A4 landscape print flow based on the weekly image', () => {
  const patch = read('patch-v031.js');
  assert.match(patch, /v031PrintBtn/);
  assert.match(patch, /הדפסה A4/);
  assert.match(patch, /@page\{size:A4 landscape/);
  assert.match(patch, /283mm/);
  assert.match(patch, /196mm/);
  assert.match(patch, /window\.print\(\)/);
});

test('0.31 validation refresh happens before first panel render and supports approve/revoke', () => {
  const patch = read('patch-v031.js');
  const css = read('patch-v031.css');
  assert.match(patch, /await window\.__hadasV030RefreshValidation\?\.\(\{ force:true, rerender:false \}\)/);
  assert.match(patch, /אישור למרות החריגה/);
  assert.match(patch, /ביטול אישור/);
  assert.match(patch, /approve_issue/);
  assert.match(patch, /revoke_issue/);
  assert.match(patch, /clone\.dataset\.v027Installed = 'true'/);
  assert.match(css, /v031-validation-card/);
  assert.match(css, /overflow-wrap:anywhere/);
  assert.match(css, /grid-column:1 \/ -1/);
});

test('0.31 shift picker uses available leave all filters and ranks available candidates by score', () => {
  const patch = read('patch-v031.js');
  assert.match(patch, />זמינים<\/button>/);
  assert.match(patch, />בחופשה<\/button>/);
  assert.match(patch, />כולם<\/button>/);
  assert.match(patch, /normalizeDisplayScore\(b\.score\) - normalizeDisplayScore\(a\.score\)/);
  assert.match(patch, /score >= 62/);
  assert.match(patch, /state\.v031PickerFilter = 'available'/);
  assert.match(patch, /data-manual-override/);
});

test('0.31 Vercel routing is prepared but agent branches stay deployment-disabled', () => {
  const vercel = JSON.parse(read('vercel.json'));
  assert.equal(vercel.git.deploymentEnabled['agent/**'], false);
  assert.ok(vercel.headers.some((item) => item.source === '/patch-v031.js'));
  assert.ok(vercel.headers.some((item) => item.source === '/patch-v031.css'));
  assert.ok(vercel.rewrites.some((item) => item.source === '/patch-v025.js' && item.destination === '/patch-v031.js'));
  assert.ok(vercel.rewrites.some((item) => item.source === '/patch-v025.css' && item.destination === '/patch-v031.css'));
});