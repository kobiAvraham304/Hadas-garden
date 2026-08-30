const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('0.25 fast shifts layer remains available under current release', () => {
  const pkg = JSON.parse(read('package.json'));
  const api = read('api/index.js');
  const version = read('VERSION.md');
  assert.equal(pkg.version, '0.30.0');
  assert.match(api, /'shifts': require\('\.\.\/lib\/shifts-v030'\)/);
  assert.match(read('lib/shifts-v030.js'), /require\('\.\/shifts-v027'\)/);
  assert.match(read('lib/shifts-v027.js'), /require\('\.\/shifts-v025'\)/);
  assert.match(version, /גרסה 0\.30\.0/);
});

test('0.25 fast scheduling keeps existing rules while parallelizing validation', () => {
  const source = read('lib/shifts-v025.js');
  assert.match(source, /Promise\.all\(/);
  assert.match(source, /hadas_employee_weekly_patterns/);
  assert.match(source, /hadas_requests/);
  assert.match(source, /hadas_employee_class_constraints/);
  assert.match(source, /max_work_days_per_week/);
  assert.match(source, /גננת ניתנת לשיבוץ רק בכיתה הקבועה שלה/);
  assert.match(source, /יום חופשי קבוע/);
  assert.match(source, /השעות חורגות מהשעות הקבועות/);
  assert.match(source, /העובד כבר משובץ בשעות חופפות/);
  assert.match(source, /action === 'move'/);
  assert.match(source, /action === 'clear_week'/);
  assert.match(source, /hadas_save_shift_v025/);
  assert.match(source, /hadas_clear_schedule_week_v025/);
  assert.match(source, /rawWeekStart/);
});

test('0.25 UI adds double-confirm week reset, drag move and immediate save refresh', () => {
  const source = read('patch-v025.js');
  assert.match(source, /clearWeekBtn/);
  assert.match(source, /firstApproval = confirm/);
  assert.match(source, /secondApproval = confirm/);
  assert.match(source, /card\.draggable = true/);
  assert.match(source, /addEventListener\('drop'/);
  assert.match(source, /action: 'move'/);
  assert.match(source, /complete_payload: true/);
  assert.match(source, /skipNextForcedScheduleRefresh/);
  assert.match(source, /originalRefreshScheduleWeek\(\{ force: true \}\)/);
});

test('0.25 PDF distinguishes fixed days off and calendar shows leave owner', () => {
  const source = read('patch-v025.js');
  assert.match(source, /type === 'fixed_day_off'/);
  assert.match(source, /type === 'day_off'/);
  assert.match(source, /item\.absence_type === 'fixed_day_off' \? name/);
  assert.match(source, /חופשה של \$\{name\}/);
  assert.match(source, /מי בחופשה/);
});

test('0.25 database writes are atomic, locked and service-role only', () => {
  const sql = read('supabase/update-v0.25.0.sql');
  assert.match(sql, /function public\.hadas_save_shift_v025/);
  assert.match(sql, /function public\.hadas_clear_schedule_week_v025/);
  assert.match(sql, /security invoker/gi);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /hadas_attendance/);
  assert.match(sql, /hadas_daily_operations/);
  assert.match(sql, /hadas_requests/);
  assert.match(sql, /revoke all on function public\.hadas_save_shift_v025[^;]+from public,anon,authenticated/i);
  assert.match(sql, /grant execute on function public\.hadas_save_shift_v025[^;]+to service_role/i);
  assert.match(sql, /revoke all on function public\.hadas_clear_schedule_week_v025[^;]+from public,anon,authenticated/i);
  assert.match(sql, /grant execute on function public\.hadas_clear_schedule_week_v025[^;]+to service_role/i);
  assert.match(sql, /values\(1,'0\.25\.0','0\.25\.0'/);
  assert.doesNotMatch(sql, /drop table|truncate table/i);
});

test('0.25 mobile version styles are explicit', () => {
  const css = read('patch-v025.css');
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /#appVersionBadge\.app-version-badge\.v025-mobile-visible/);
  assert.match(css, /display: inline-flex !important/);
});
