const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { validateWeek } = require('../lib/schedule');

test('0.28 metadata, health and request wrapper remain aligned under current release', () => {
  assert.equal(JSON.parse(read('package.json')).version, '0.34.0');
  assert.match(read('VERSION.md'), /גרסה 0.34.0/);
  assert.match(read('handlers/health.js'), /schema_version === '0.34.0'/);
  assert.match(read('health.js'), /update-v0.34.0\.sql/);
  assert.match(read('api/index.js'), /'requests': require\('\.\.\/lib\/requests-v030'\)/);
  assert.match(read('lib/requests-v030.js'), /require\('\.\/requests-v028'\)/);
});

test('0.28 migration adds optional maximum daily staffing non-destructively', () => {
  const sql = read('supabase/update-v0.28.0.sql');
  assert.match(sql, /add column if not exists max_daily_staff integer/i);
  assert.match(sql, /max_daily_staff is null or max_daily_staff between 1 and 20/i);
  assert.match(sql, /schema_version='0\.28\.0'/);
  assert.doesNotMatch(sql, /drop table|truncate table|delete from/i);
});

test('0.28 core validator blocks staffing above configured simultaneous maximum', () => {
  const shifts = ['a','b','c'].map((employee_id) => ({
    employee_id, class_id:'class', shift_date:'2026-08-30', start_time:'08:15', end_time:'10:00', shift_role:'staff',
  }));
  const employees = ['a','b','c'].map((id) => ({ id, full_name:id, active:true, is_schedulable:true }));
  const result = validateWeek({
    shifts,
    classes:[{ id:'class', name:'כיתה', active:true }],
    employees,
    settings:{
      opening_time:'07:30', morning_end_time:'08:15', closing_time:'15:30', friday_closing_time:'12:00',
      morning_required_staff:1, required_staff:1, closing_required_staff:1, closing_window_minutes:30,
      validation_slot_minutes:30, require_leader:false, max_daily_staff:2,
    },
    weekStart:'2026-08-30', constraints:[], weeklyPatterns:[], requests:[],
  });
  assert.ok(result.errors.some((item) => item.code === 'max_daily_staff'));
  assert.match(result.errors.find((item) => item.code === 'max_daily_staff').message, /מקסימום/);
});

test('0.28 end-of-day staffing uses an exact clock input while preserving engine duration compatibility', () => {
  const patch = read('patch-v028.js');
  assert.match(patch, /name=\"closing_start_time\" type=\"time\"/);
  assert.match(patch, /closing_window_minutes = closingWindow/);
  assert.match(patch, /close - closingStart/);
  assert.match(patch, /יום שישי אותו פרק זמן יחושב לפני 12:00/);
  assert.match(read('handlers/settings.js'), /max_daily_staff/);
});

test('0.28 late and early requests infer the relevant shift instead of requiring an empty picker', () => {
  const requests = read('lib/requests-v028.js');
  const patch = read('patch-v028.js');
  assert.match(requests, /inferShiftForTimeRequest/);
  assert.match(requests, /eq\('employee_id', requesterId\)/);
  assert.match(requests, /eq\('shift_date', requestDate\)/);
  assert.match(requests, /\['late_start', 'early_finish'\]/);
  assert.match(requests, /!body\.shift_id/);
  assert.match(patch, /shift-choice-field/);
  assert.match(patch, /form\.elements\.shift_id\.required = false/);
  assert.match(patch, /המערכת מאתרת לבד את השיבוץ/);
});

test('0.28 managers can delete approved but unapplied requests safely', () => {
  const requests = read('lib/requests-v028.js');
  const patch = read('patch-v028.js');
  assert.match(requests, /action === 'delete_approved'/);
  assert.match(requests, /request\.status === 'applied'/);
  assert.match(requests, /request\.status !== 'approved'/);
  assert.match(requests, /from\('hadas_requests'\)\.delete\(\)/);
  assert.match(requests, /emitEvent\('calendar'\)/);
  assert.match(requests, /emitEvent\('shifts'\)/);
  assert.match(patch, /data-v028-delete-approved/);
  assert.match(read('lib/requests-v030.js'), /hadas_delete_request_v030/);
});

test('0.28 schedule employee search highlights existing table rows and calculates weekly shifts and hours', () => {
  const patch = read('patch-v028.js');
  const css = read('patch-v028.css');
  assert.match(patch, /v028ScheduleEmployeeSearch/);
  assert.match(patch, /scheduleEmployeeRows/);
  assert.match(patch, /employeeFocusStats/);
  assert.match(patch, /summary\.shifts/);
  assert.match(patch, /summary\.hours/);
  assert.match(patch, /v028-employee-focus/);
  assert.match(css, /outline:3px solid/);
  assert.match(css, /v028-employee-focus::after/);
});

test('0.28 high-quality A4 implementation remains historical while v0.30 removes weekly PDF button', () => {
  const current = read('patch-v028.js');
  const pdf = read('patch-v027.js');
  assert.match(current, /PDF שבועי A4/);
  assert.match(current, /PDF חופשות A4/);
  assert.match(pdf, /const pageW = 841\.89, pageH = 595\.28/);
  assert.match(pdf, /image\/jpeg', 0\.995/);
  assert.match(read('patch-v030.js'), /removeWeeklyPdf/);
});

test('0.28 stale 0.25 client URLs are forced to the current no-store patch', () => {
  const vercel = JSON.parse(read('vercel.json'));
  assert.ok(!vercel.rewrites.some((item) => item.source === '/patch-v025.js' || item.source === '/patch-v025.css'));
  const headers = new Map(vercel.headers.map((item) => [item.source, item.headers]));
  for (const route of ['/', '/index.html', '/api/config', '/patch-v025.js', '/patch-v031.js']) assert.ok(headers.has(route), route);
  const apiConfig = headers.get('/api/config').map((item) => `${item.key}:${item.value}`).join('|');
  assert.match(apiConfig, /Vercel-CDN-Cache-Control:no-store/);
  assert.match(read('patch-v031.js'), /const VERSION = '0\.31\.0'/);
  assert.match(read('patch-v031.js'), /pinVersion/);
});
