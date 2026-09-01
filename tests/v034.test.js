const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { canManageDailyOperations } = require('../lib/server');
const { operationPayload } = require('../handlers/attendance');

test('0.35 release bootstrap and schema markers are current', () => {
  assert.equal(JSON.parse(read('package.json')).version, '0.35.0');
  assert.match(read('VERSION.md'), /גרסה 0\.35\.0/);
  assert.match(read('patch-v025.js'), /V034 = '\/patch-v034\.js\?v=0350'/);
  assert.match(read('patch-v025.js'), /await loadScript\(V034, 'v034'\)/);
  assert.match(read('patch-v025.css'), /patch-v034\.css\?v=0350/);
  assert.match(read('patch-v034.js'), /const VERSION = '0\.35\.0'/);
  assert.match(read('supabase/update-v0.35.0.sql'), /values\(1,'0\.35\.0','0\.35\.0'/);
  assert.match(read('handlers/health.js'), /databaseVersion:'0\.35\.0'/);
});

test('daily operations are limited to scheduling managers, teachers and daycare managers', () => {
  assert.equal(canManageDailyOperations({ user:{ role:'scheduler' }, employee:{ job_title:'אחראית שיבוצים' } }), true);
  assert.equal(canManageDailyOperations({ user:{ role:'employee' }, employee:{ job_title:'גננת/אחראית כיתה' } }), true);
  assert.equal(canManageDailyOperations({ user:{ role:'employee' }, employee:{ job_title:'מנהלת מעון' } }), true);
  assert.equal(canManageDailyOperations({ user:{ role:'employee' }, employee:{ job_title:'סייעת' } }), false);
  assert.match(read('handlers/daily-operations.js'), /canManageDailyOperations\(caller\)/);
  assert.match(read('index.html'), /daily-operations-only/);
});

test('attendance endpoint is self-service and blocks future dates and cross-employee reports', () => {
  const handler = read('handlers/attendance.js');
  assert.match(handler, /req\.method === 'GET'/);
  assert.match(handler, /eq\('employee_id',caller\.employee\.id\)/);
  assert.match(handler, /date > israelDateISO\(\)/);
  assert.match(handler, /shift\.employee_id !== caller\.employee\.id/);
  assert.match(handler, /בהיעדרות יש להזין סיבה/);
  assert.match(handler, /status === 'late'\) actualEnd = shortTime\(shift\.end_time\)/);
  assert.match(handler, /status === 'left_early'\) actualStart = shortTime\(shift\.start_time\)/);
});

test('attendance exceptions create daily-operation payloads from the same source of truth', () => {
  const shift = { id:'s1', employee_id:'e1', class_id:'c1', shift_date:'2026-09-01', start_time:'07:30:00', end_time:'15:30:00' };
  assert.equal(operationPayload('present', shift, '07:30', '15:30', '', 'e1'), null);
  assert.deepEqual(operationPayload('late', shift, '08:10', '15:30', 'פקק', 'e1'), {
    operation_date:'2026-09-01', shift_id:'s1', employee_id:'e1', class_id:'c1', operation_type:'late',
    start_time:'08:10', end_time:'15:30', note:'פקק', source:'attendance', created_by:'e1',
  });
  const sick = operationPayload('sick', shift, null, null, '', 'manager');
  assert.equal(sick.operation_type, 'sick');
  assert.equal(sick.source, 'attendance');
});

test('dashboard and daily operations render the effective attendance without duplicate reporting action', () => {
  const app = read('app.js');
  assert.match(app, /function effectiveTodayShift/);
  assert.match(app, /todayAttendanceForShift/);
  assert.match(app, /dashboard-effective-time/);
  assert.match(app, /daily-self-reported/);
  assert.match(app, /loadSelfAttendance/);
  assert.match(app, /attendance-self-card/);
  assert.doesNotMatch(app, /data-daily-action="report"/);
  assert.doesNotMatch(app, />דיווח על העובד</);
  assert.match(read('patch-v034.css'), /\.dashboard-effective-time \.is-exception/);
});

test('daily operations stay an overlay and never mutate the static schedule', () => {
  const attendance = read('handlers/attendance.js');
  const daily = read('handlers/daily-operations.js');
  for (const source of [attendance, daily]) {
    assert.doesNotMatch(source, /from\('hadas_shifts'\)\.(?:insert|update|upsert|delete)\(/);
  }
  assert.match(attendance, /from\('hadas_attendance'\)\.upsert/);
  assert.match(attendance, /syncDailyOperation/);
  assert.match(daily, /from\('hadas_daily_operations'\)\.update/);
  assert.match(read('app.js'), /function dashboardCoverageForClass/);
  assert.match(read('app.js'), /todayOperationalReplacementRows/);
  assert.match(read('handlers/data.js'), /dashboardOperationsViewer/);
});

test('schedule modes, mobile week and A4 print follow the upgraded presentation', () => {
  const app = read('app.js');
  const hotfix = read('patch-v0331-hotfix.js');
  const css = read('patch-v034.css');
  assert.match(app, /v034-mine-week/);
  assert.match(app, /השבוע שלי מוצג לרוחב/);
  assert.match(hotfix, /state\?\.scheduleMode === 'day'/);
  assert.match(hotfix, /window\.open\('', '_blank'\)/);
  assert.match(hotfix, /@page \{ size:A4 landscape; margin:5mm; \}/);
  assert.match(css, /\.mobile-week-day > summary/);
  assert.match(css, /font-size:1rem !important/);
});

test('Linor can only view and manage feedback from other employees', () => {
  const handler = read('handlers/feedback.js');
  const app = read('app.js');
  assert.match(handler, /query\.neq\('employee_id', caller\.employee\.id\)/);
  assert.match(handler, /לינור יכולה לצפות ולנהל משובים של עובדים אחרים בלבד/);
  assert.match(app, /feedbackForm'\)\?\.classList\.toggle\('hidden',manager\)/);
  assert.match(app, /משובים מהצוות/);
  assert.match(app, /await loadFeedback\(\); \$\('#feedbackDialog'\)\.showModal\(\)/);
});

test('request closed filter does not mix applied requests into closed items', () => {
  const app = read('app.js');
  assert.match(app, /requestStatusFilter==='closed'&&\['rejected','cancelled'\]\.includes\(request\.status\)/);
  assert.doesNotMatch(app, /requestStatusFilter==='closed'&&\['rejected','applied','cancelled'\]/);
});
