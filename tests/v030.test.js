const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { validationIssueKey } = require('../lib/shifts-v030');
const { truthy } = require('../lib/requests-v030');
const { syntheticLeaveRequestId } = require('../lib/calendar-v030');

test('0.30 release layers remain available under the current release', () => {
  assert.equal(JSON.parse(read('package.json')).version, '0.34.0');
  assert.match(read('VERSION.md'), /גרסה 0.34.0/);
  assert.match(read('handlers/health.js'), /schema_version === '0.34.0'/);
  assert.match(read('health.js'), /update-v0.34.0\.sql/);
  const api = read('api/index.js');
  assert.match(api, /'requests': require\('\.\.\/lib\/requests-v030'\)/);
  assert.match(api, /'calendar': require\('\.\.\/lib\/calendar-v032'\)/);
  assert.match(api, /'shifts': require\('\.\.\/lib\/shifts-v032'\)/);
  assert.match(read('lib/calendar-v032.js'), /require\('\.\/calendar-v030'\)/);
  assert.match(read('lib/shifts-v032.js'), /require\('\.\/shifts-v030'\)/);
  assert.match(read('supabase/update-v0.30.0.sql'), /schema_version='0\.30\.0'/);
});

test('0.30 manager preapproval is explicit and self requests remain server-guarded', () => {
  const requests = read('lib/requests-v030.js');
  const patch = read('patch-v030.js');
  assert.equal(truthy(true), true);
  assert.equal(truthy('on'), true);
  assert.equal(truthy('false'), false);
  assert.match(requests, /managerSubmitted && \(truthy\(body\.pre_approved\) \|\| truthy\(body\.apply_now\)\)/);
  assert.match(requests, /!managerSubmitted && updated\.status !== 'pending'/);
  assert.match(requests, /manager_preapproved/);
  assert.match(requests, /finishManagerPreapprovedSwap/);
  assert.match(requests, /target_approved/);
  assert.match(patch, /אושר מראש/);
  assert.match(patch, /!onBehalf/);
  assert.match(patch, /העובד שנבחר עדיין חייב לאשר/);
});

test('0.30 schedule validation approvals are deterministic, reversible and affect publishing', () => {
  const first = validationIssueKey({ code:'understaffed', date:'2026-08-30', class_id:'x', time:'09:00', count:3, expected:4, message:'בעיה' });
  const second = validationIssueKey({ code:'understaffed', date:'2026-08-30', class_id:'x', time:'09:00', count:3, expected:4, message:'בעיה' });
  const changed = validationIssueKey({ code:'understaffed', date:'2026-08-30', class_id:'x', time:'09:00', count:2, expected:4, message:'בעיה' });
  assert.equal(first, second);
  assert.notEqual(first, changed);
  const shifts = read('lib/shifts-v030.js');
  assert.match(shifts, /hadas_schedule_issue_approvals/);
  assert.match(shifts, /action === 'approve_issue'/);
  assert.match(shifts, /action === 'revoke_issue'/);
  assert.match(shifts, /errors: rawErrors\.filter/);
  assert.match(shifts, /approved_validation_issues/);
  const patch = read('patch-v030.js');
  assert.match(patch, /אישור למרות הבעיה/);
  assert.match(patch, /ביטול אישור/);
  assert.match(patch, /v030-approved-issue/);
});

test('0.30 removes weekly A4 PDF and upgrades week/month image exports', () => {
  const patch = read('patch-v030.js');
  assert.match(patch, /button\.remove\(\)/);
  assert.match(patch, /const EXPORT_SCALE = 2\.4/);
  assert.match(patch, /image\/png/);
  assert.match(patch, /exportWeekImage/);
  assert.match(patch, /exportMonthImages/);
  assert.match(patch, /\['day_off_worked','leave','day_off','sick'\]/);
  assert.doesNotMatch(patch, /\['fixed_day_off','day_off_worked'/);
  assert.match(patch, /worked\?'#e7f7ed':'#fdecec'/);
  assert.match(patch, /const line=worked\?name:/);
});

test('0.30 applied request deletion is atomic and calendar can delete its synthetic approved-leave request', () => {
  const requests = read('lib/requests-v030.js');
  const calendar = read('lib/calendar-v030.js');
  const sql = read('supabase/update-v0.30.0.sql');
  assert.match(requests, /hadas_delete_request_v030/);
  assert.match(requests, /delete_with_rollback/);
  assert.match(requests, /\['delete_request', 'delete_approved'\]/);
  assert.match(calendar, /deleteRequestWithRollback/);
  assert.equal(syntheticLeaveRequestId({ id:'leave:11111111-1111-4111-8111-111111111111:2026-08-30' }), '11111111-1111-4111-8111-111111111111');
  assert.match(sql, /add column if not exists manager_preapproved boolean not null default false/i);
  assert.match(sql, /add column if not exists application_snapshot jsonb/i);
  assert.match(sql, /create table if not exists public\.hadas_schedule_issue_approvals/i);
  assert.match(sql, /create or replace function public\.hadas_delete_request_v030/i);
  assert.match(sql, /application_snapshot=jsonb_build_object/i);
  assert.match(sql, /schema_version='0\.30\.0'/);
});

test('0.30 calendar deletion and request list deletion both refresh schedule and calendar state', () => {
  const patch = read('patch-v030.js');
  assert.match(patch, /data-v030-delete-request/);
  assert.match(patch, /data-v030-calendar-delete-request/);
  assert.match(patch, /state\.calendarCache\.clear\(\); state\.weekCache\.clear\(\)/);
  assert.match(patch, /method:'DELETE'/);
  assert.match(patch, /action:'delete_request'/);
});

test('0.30 runtime stays intact while physical entrypoints advance to v0.34', () => {
  const entry = read('patch-v025.js');
  const cssEntry = read('patch-v025.css');
  assert.match(read('patch-v030.js'), /const VERSION = '0\.30\.0'/);
  assert.match(read('patch-v030.js'), /PREVIOUS_PATCH = '\/patch-v029\.js\?v=0300'/);
  assert.match(read('patch-v030.css'), /patch-v029\.css\?v=0300/);
  assert.match(entry, /const VERSION = '0\.34\.0'/);
  assert.match(entry, /V026 = '\/patch-v026\.js\?v=0321'/);
  assert.match(entry, /V033 = '\/patch-v033\.js\?v=0333'/);
  assert.match(entry, /await loadScript\(V026, 'v026'\)/);
  assert.match(entry, /await loadScript\(V033, 'v033'\)/);
  assert.match(entry, /await loadScript\(V034, 'v034'\)/);
  assert.ok(entry.indexOf("await loadScript(V026, 'v026')") < entry.indexOf("await loadScript(V033, 'v033')"));
  assert.match(cssEntry, /patch-v034\.css\?v=0340/);

  const vercel = JSON.parse(read('vercel.json'));
  const headers = new Map(vercel.headers.map((item) => [item.source, item.headers]));
  for (const route of ['/patch-v025.js','/patch-v025.css','/patch-v030.js','/patch-v030.css','/patch-v031.js','/patch-v031.css','/patch-v032.js','/patch-v032.css','/patch-v033.js','/patch-v033.css','/patch-v034.js','/patch-v034.css']) assert.ok(headers.has(route), route);
});
