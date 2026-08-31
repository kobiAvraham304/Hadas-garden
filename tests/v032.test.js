const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('0.32.1 layers remain available under the 0.33 release bootstrap', () => {
  assert.equal(JSON.parse(read('package.json')).version, '0.33.0');
  assert.match(read('VERSION.md'), /גרסה 0\.33\.0/);
  assert.match(read('handlers/health.js'), /schema_version === '0\.33\.0'/);
  assert.match(read('handlers/health.js'), /databaseVersion:'0\.33\.0'/);
  const api = read('api/index.js');
  assert.match(api, /calendar-v032/);
  assert.match(api, /shifts-v032/);
  const entry = read('patch-v025.js');
  assert.match(entry, /const VERSION = '0\.33\.0'/);
  assert.match(entry, /V033 = '\/patch-v033\.js\?v=0331'/);
  assert.match(entry, /await loadScript\(V033, 'v033'\)/);
  assert.match(entry, /await window\.__hadasV033BootstrapPromise/);
  assert.match(entry, /hadas:bootstrap-ready/);
  assert.match(read('patch-v025.css'), /patch-v033\.css\?v=0331/);
  const app = read('app.js');
  assert.match(app, /window\.addEventListener\('hadas:bootstrap-ready'/);
  assert.match(app, /if \(startupPromise\) return startupPromise/);
  assert.doesNotMatch(app, /\ninit\(\);\s*$/);
  const bootstrap = read('patch-v032.js');
  assert.match(bootstrap, /await waitForFlag\('__hadasV031Installed'\)/);
  assert.match(bootstrap, /__hadasV031VersionObservers/);
  assert.match(bootstrap, /observer\?\.disconnect\(\)/);
  assert.ok(bootstrap.indexOf("await waitForFlag('__hadasV031Installed')") < bootstrap.indexOf('CURRENT_FILES.length'));
});

test('0.32 validation consolidates empty day/class alerts and fast-approves exact issue keys', () => {
  const core = read('patch-v032-core.js');
  const server = read('lib/shifts-v032.js');
  assert.match(core, /no_day_schedule/);
  assert.match(core, /no_class_schedule/);
  assert.match(core, /התראות דומות אוחדו/);
  assert.match(core, /state\.scheduleMode='week'/);
  assert.match(core, /v032-focus-ring/);
  assert.match(core, /action:'approve_issues'/);
  assert.match(core, /action:'revoke_issues'/);
  assert.match(server, /validationIssueKey\(snapshot\) !== key/);
  assert.match(server, /No realtime shifts event/);
  assert.doesNotMatch(server, /rawWeekValidation\(weekStart\)/);
});

test('0.32 exports use consistent absence meanings and share the weekly absence PDF', () => {
  const patch = read('patch-v032-exports.js');
  assert.match(patch, /label:'שיבוץ ביום חופשי'/);
  assert.match(patch, /label:'חופש חד פעמי'/);
  assert.match(patch, /absence_type==='fixed_day_off'/);
  assert.match(patch, /new File\(\[blob\],filename,\{type:'application\/pdf'/);
  assert.match(patch, /navigator\.canShare/);
  assert.match(patch, /WhatsApp/);
  assert.match(patch, /חודש כתמונות/);
  assert.match(patch, /הדפסה A4/);
});

test('0.32 picker and automatic-week UX stay stable and clickable', () => {
  const ux = read('patch-v032-ux.js');
  const css = read('patch-v032.css');
  assert.match(ux, /stopImmediatePropagation\(\)/);
  assert.match(ux, /v026-picker-collapsed/);
  assert.match(ux, /data-v032-auto-week/);
  assert.match(ux, /openAutoScheduleDialog\(\)/);
  assert.match(ux, /select\.value=b\.dataset\.v032AutoWeek/);
  assert.match(css, /v032-sticky-picker-filter/);
  assert.match(css, /position:sticky/);
  assert.match(css, /v032-auto-week-quick/);
});

test('0.32 multi-day general closures are manager-only and atomic in Supabase', () => {
  const calendar = read('lib/calendar-v032.js');
  const migration = read('supabase/update-v0.32.0.sql');
  assert.match(calendar, /bulk_general_day_off/);
  assert.match(calendar, /if \(!isManager\(caller\)\)/);
  assert.match(calendar, /31/);
  assert.match(migration, /create or replace function public\.hadas_bulk_general_day_off_v032/i);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /hadas_attendance/);
  assert.match(migration, /hadas_daily_operations/);
  assert.match(migration, /hadas_requests/);
  assert.match(migration, /delete from public\.hadas_shifts/i);
  assert.match(migration, /revoke all on function public\.hadas_bulk_general_day_off_v032/i);
  assert.match(migration, /grant execute .* service_role/i);
  assert.match(migration, /schema_version = '0\.32\.0'/);
});

test('0.32 week arrows and Vercel cache routing are aligned', () => {
  const core = read('patch-v032-core.js');
  assert.match(core, /p\.textContent='‹'/);
  assert.match(core, /n\.textContent='›'/);
  const vercel = JSON.parse(read('vercel.json'));
  assert.equal(vercel.git.deploymentEnabled['agent/**'], false);
  for (const file of ['/patch-v032.js','/patch-v032-core.js','/patch-v032-exports.js','/patch-v032-ux.js','/patch-v032-stability.js','/patch-v032.css']) {
    assert.ok(vercel.headers.some((item) => item.source === file), file);
  }
  assert.ok(vercel.rewrites.some((item) => item.source === '/patch-v025.js' && item.destination === '/patch-v033.js'));
  assert.ok(vercel.rewrites.some((item) => item.source === '/patch-v025.css' && item.destination === '/patch-v033.css'));
});
