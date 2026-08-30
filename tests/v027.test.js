const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('0.27 release layers remain wired under current release', () => {
  assert.equal(JSON.parse(read('package.json')).version, '0.32.1');
  assert.match(read('VERSION.md'), /גרסה 0\.32\.1/);
  const api = read('api/index.js');
  assert.match(api, /'calendar': require\('\.\.\/lib\/calendar-v032'\)/);
  assert.match(api, /'shifts': require\('\.\.\/lib\/shifts-v032'\)/);
  assert.match(read('lib/calendar-v030.js'), /require\('\.\/calendar-v027'\)/);
  assert.match(read('lib/shifts-v030.js'), /require\('\.\/shifts-v027'\)/);
  assert.match(read('lib/shifts-v027.js'), /require\('\.\/shifts-v025'\)/);
  assert.match(read('patch-v030.js'), /patch-v029\.js\?v=0300/);
  assert.match(read('patch-v030.css'), /patch-v029\.css\?v=0300/);
});

test('0.27 migration adds only a general-day-off flag and index non-destructively', () => {
  const sql = read('supabase/update-v0.27.0.sql');
  assert.match(sql, /add column if not exists is_general_day_off boolean not null default false/i);
  assert.match(sql, /hadas_calendar_general_day_off_date_idx/);
  assert.match(sql, /where is_general_day_off = true/i);
  assert.match(sql, /values\(1,'0\.27\.0','0\.27\.0'/);
  assert.doesNotMatch(sql, /drop table|truncate table|delete from/i);
});

test('0.27 employee replacement picker defaults to available and can reveal blocked workers', () => {
  const patch = read('patch-v027.js');
  const css = read('patch-v027.css');
  assert.match(patch, /state\.v027PickerFilter = state\.v027PickerFilter \|\| 'available'/);
  assert.match(patch, /זמינים בלבד/);
  assert.match(patch, /מומלצים/);
  assert.match(patch, /כולל חסומים/);
  assert.match(patch, /blocked-employees/);
  assert.match(patch, /matching-rejected-details/);
  assert.match(css, /\.v027-picker-filter/);
  assert.match(css, /\.v027-filter-hidden/);
});

test('0.27 different fixed hours receive a subtle marker on screen and export', () => {
  const patch = read('patch-v027.js');
  const css = read('patch-v027.css');
  assert.match(patch, /function shiftUsesDifferentFixedHours/);
  assert.match(patch, /employeePatternForDate/);
  assert.match(patch, /v027-time-marker/);
  assert.match(patch, /rgba\(244, 207, 97, \.28\)/);
  assert.match(css, /rgba\(246,211,103,\.27\)/);
});

test('0.27 RTL week arrows and validation button are explicit and useful', () => {
  const patch = read('patch-v027.js');
  const css = read('patch-v027.css');
  assert.match(patch, /prev\.textContent = '›'/);
  assert.match(patch, /next\.textContent = '‹'/);
  assert.match(patch, /installValidationButton/);
  assert.match(patch, /stopImmediatePropagation/);
  assert.match(patch, /השיבוץ עבר את בדיקות התקינות/);
  assert.match(patch, /v027-problem-cell/);
  assert.match(css, /\.v027-problem-cell/);
  assert.match(css, /rgba\(221,78,78/);
});

test('0.27 automatic scheduling has quick week choice and preserves rejected decisions', () => {
  const patch = read('patch-v027.js');
  assert.match(patch, /שבוע שעבר/);
  assert.match(patch, /שבוע הבא/);
  assert.match(patch, /בעוד שבועיים/);
  assert.match(patch, /v027-auto-week-quick/);
  assert.match(patch, /prior === 'rejected'/);
  assert.match(patch, /const hard=errors\.filter\(\(item\)=>!autoIssueCanApprove\(item\)\)/);
  assert.match(patch, /allow_incomplete:errors\.length>0/);
  assert.match(patch, /state\.scheduleIssuesOpen=rejected>0/);
});

test('0.27 general nursery day off is manager-controlled, removes only safe schedules and blocks new shifts', () => {
  const calendar = read('lib/calendar-v027.js');
  const shifts = read('lib/shifts-v027.js');
  const patch = read('patch-v027.js');
  assert.match(calendar, /is_general_day_off: true/);
  assert.match(calendar, /if \(!isManager\(caller\)\)/);
  assert.match(calendar, /hadas_attendance/);
  assert.match(calendar, /hadas_daily_operations/);
  assert.match(calendar, /hadas_requests/);
  assert.match(calendar, /general_day_off_clear_schedule/);
  assert.match(calendar, /from\('hadas_shifts'\)\.delete\(\)\.eq\('shift_date', date\)/);
  assert.match(shifts, /eq\('is_general_day_off', true\)/);
  assert.match(shifts, /המעון מוגדר סגור בתאריך זה/);
  assert.match(shifts, /selected_dates: filtered/);
  assert.match(patch, /יום חופשי כללי/);
  assert.match(patch, /general_day_off\s*=\s*true/);
});

test('0.27 weekly PDF implementation remains available historically while v0.30 removes its button', () => {
  const patch = read('patch-v027.js');
  assert.match(patch, /highQualityWeeklyCanvas/);
  assert.match(patch, /2\.15/);
  assert.match(patch, /image\/jpeg', 0\.995/);
  assert.match(patch, /const pageW = 841\.89, pageH = 595\.28/);
  assert.match(patch, /שיבוץ שבועי לתאריכים \$\{weekRangeLabel\(\)\}/);
  assert.match(patch, /type:'application\/pdf'/);
  assert.match(read('patch-v030.js'), /removeWeeklyPdf/);
});

test('0.27 vacation-only weekly PDF is available next to team availability', () => {
  const patch = read('patch-v027.js');
  assert.match(patch, /v027AbsencePdfBtn/);
  assert.match(patch, /PDF חופשות השבוע/);
  assert.match(patch, /\['leave','day_off','sick'\]\.includes\(item\.absence_type\)/);
  assert.match(patch, /חופשות-מעון-הדס-/);
  assert.match(patch, /חופשות והיעדרויות לתאריכים \$\{weekRangeLabel\(\)\}/);
});

test('0.27 assets remain directly available while current wrapper owns cache routing', () => {
  const vercel = JSON.parse(read('vercel.json'));
  assert.ok(vercel.rewrites.some((item) => item.source === '/patch-v025.js' && item.destination === '/patch-v032.js'));
  assert.ok(vercel.rewrites.some((item) => item.source === '/patch-v025.css' && item.destination === '/patch-v032.css'));
  assert.ok(vercel.headers.some((item) => item.source === '/patch-v027.js'));
  assert.ok(vercel.headers.some((item) => item.source === '/patch-v031.js'));
  assert.match(read('handlers/health.js'), /schema_version === '0\.32\.0'/);
  assert.match(read('health.js'), /update-v0\.32\.0\.sql/);
});
