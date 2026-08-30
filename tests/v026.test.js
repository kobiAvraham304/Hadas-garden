const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { normalizeVirtualShifts, previewCandidates } = require('../lib/suggestions-v026');
const { truthy, canPreApprove } = require('../lib/requests-v026');

const employeeId = '11111111-1111-4111-8111-111111111111';
const classId = '22222222-2222-4222-8222-222222222222';

test('0.26 upgraded request and suggestion layers remain available under current release', () => {
  const pkg = JSON.parse(read('package.json'));
  const api = read('api/index.js');
  const version = read('VERSION.md');
  assert.equal(pkg.version, '0.30.0');
  assert.match(version, /גרסה 0\.30\.0/);
  assert.match(api, /'requests': require\('\.\.\/lib\/requests-v030'\)/);
  assert.match(read('lib/requests-v030.js'), /require\('\.\/requests-v028'\)/);
  assert.match(read('lib/requests-v028.js'), /require\('\.\/requests-v026'\)/);
  assert.match(api, /'suggestions': require\('\.\.\/lib\/suggestions-v026'\)/);
  assert.match(api, /'shifts': require\('\.\.\/lib\/shifts-v030'\)/);
});

test('0.26 preview shifts are normalized as the effective future schedule', () => {
  const rows = normalizeVirtualShifts([{
    shift_date: '2026-08-31', class_id: classId, employee_id: employeeId,
    start_time: '07:30:00', end_time: '15:30:00', shift_role: 'staff', public_note: 'בדיקה',
  }], '2026-08-30', '2026-09-04');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].employee_id, employeeId);
  assert.equal(rows[0].start_time, '07:30');
  assert.equal(rows[0].end_time, '15:30');
  assert.match(rows[0].id, /^virtual-/);
  assert.throws(() => normalizeVirtualShifts([{ shift_date:'2026-08-31',class_id:'bad',employee_id:employeeId,start_time:'07:30',end_time:'15:30' }], '2026-08-30','2026-09-04'));
});

test('0.26 add correction hides employees already scheduled in preview instead of offering transfers', () => {
  const ranking = {
    candidates: [
      { employee_id:'free', full_name:'פנוי', candidate_type:'direct', recommended:true },
      { employee_id:'busy', full_name:'משובץ', candidate_type:'transfer', recommended:true },
    ],
    rejected: [],
  };
  const filtered = previewCandidates(ranking, [{ id:'virtual-0' }], 'add');
  assert.deepEqual(filtered.candidates.map((item) => item.employee_id), ['free']);
  assert.ok(filtered.rejected.some((item) => item.employee_id === 'busy' && item.code === 'already_scheduled_in_preview'));
  assert.match(filtered.rejected.find((item) => item.employee_id === 'busy').reason, /כבר משובץ בטיוטה/);
  assert.equal(previewCandidates(ranking, [{ id:'virtual-0' }], 'replace').candidates.length, 2);
});

test('0.26 browser correction sends the auto preview as virtual shifts and excludes edited row', () => {
  const patch = read('patch-v026.js');
  assert.match(patch, /function previewVirtualShifts\(/);
  assert.match(patch, /state\.autoSchedulePreview/);
  assert.match(patch, /state\.autoScheduleManualGenerated/);
  assert.match(patch, /editingIndex === null \|\| index !== editingIndex/);
  assert.match(patch, /virtual_shifts: previewVirtualShifts\(\)/);
  assert.match(patch, /method: 'POST'/);
  assert.match(read('lib/suggestions-v026.js'), /const shifts = virtualShifts \|\| persistedShifts/);
});

test('0.26 shift editing starts compact and exposes an explicit change-employee action', () => {
  const patch = read('patch-v026.js');
  const css = read('patch-v026.css');
  assert.match(patch, /v026SelectedEmployeeBar/);
  assert.match(patch, /החלפת עובד/);
  assert.match(patch, /v026-picker-collapsed/);
  assert.match(patch, /עריכת שיבוץ/);
  assert.match(patch, /תיקון שיבוץ מוצע/);
  assert.match(css, /\.v026-selected-employee/);
  assert.match(css, /\.v026-picker-collapsed/);
});

test('0.26 weekly export still provides a real PDF file implementation historically', () => {
  const patch = read('patch-v026.js');
  assert.match(patch, /type: 'application\/pdf'/);
  assert.match(patch, /new File\(\[blob\], filename/);
  assert.match(patch, /navigator\.share/);
  assert.match(patch, /link\.download = filename/);
  assert.match(patch, /%PDF-1\.4/);
  assert.match(read('patch-v030.js'), /removeWeeklyPdf/);
});

test('0.26 manager on-behalf request has explicit pre-approved semantics without bypassing swap consent', () => {
  const patch = read('patch-v026.js');
  const requests = read('lib/requests-v026.js');
  assert.match(patch, /name=\"pre_approved\"/);
  assert.match(requests, /status: 'pending'/);
  assert.match(requests, /decided_by: null/);
  assert.match(requests, /decided_at: null/);
  assert.match(requests, /swap_target_consent_guard/);
  assert.equal(truthy(true), true);
  assert.equal(truthy('1'), true);
  assert.equal(truthy('false'), false);
  assert.equal(canPreApprove({ request_type:'leave', pre_approved:true }), true);
  assert.equal(canPreApprove({ request_type:'day_off', pre_approved:'1' }), true);
  assert.equal(canPreApprove({ request_type:'swap', pre_approved:true }), false);
  assert.equal(canPreApprove({ request_type:'swap', apply_now:true }), false);
});

test('0.26 Vercel root hardening remains while current patch advances', () => {
  const vercel = JSON.parse(read('vercel.json'));
  assert.equal(Object.hasOwn(vercel, 'installCommand'), false);
  assert.ok(vercel.rewrites.some((item) => item.source === '/' && item.destination === '/index.html'));
  assert.ok(vercel.rewrites.some((item) => item.source === '/patch-v025.js' && item.destination === '/patch-v030.js'));
  assert.ok(vercel.rewrites.some((item) => item.source === '/patch-v025.css' && item.destination === '/patch-v030.css'));
  const headerMap = new Map(vercel.headers.map((item) => [item.source, item.headers]));
  assert.ok(headerMap.has('/'));
  assert.ok(headerMap.has('/patch-v025.js'));
  assert.ok(headerMap.has('/patch-v030.js'));
});
