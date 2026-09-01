const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const server = require('../lib/server');

test('0.35 transfer migration is atomic, operationally safe and service-role only', () => {
  const sql = read('supabase/update-v0.35.0.sql');
  assert.match(sql, /begin;/i);
  assert.match(sql, /commit;/i);
  assert.doesNotMatch(sql, /drop table|delete from public\.hadas_attendance|delete from public\.hadas_daily_operations/i);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /for update/);
  assert.match(sql, /HADAS_TRANSFER_OPERATIONAL_DATA/);
  assert.match(sql, /HADAS_TRANSFER_ACTIVE_REQUEST/);
  assert.match(sql, /delete from public\.hadas_shifts where id=p_source_shift_id;[\s\S]*update public\.hadas_shifts[\s\S]*where id=p_target_shift_id/);
  assert.match(sql, /revoke all on function public\.hadas_apply_transfer_suggestion_v035[\s\S]*from public,anon,authenticated/);
  assert.match(sql, /grant execute on function public\.hadas_apply_transfer_suggestion_v035[\s\S]*to service_role/);
});

test('planned transfer no longer uses delete-update-rollback steps in application code', () => {
  const handler = read('handlers/shifts.js');
  assert.match(handler, /hadas_apply_transfer_suggestion_v035/);
  assert.doesNotMatch(handler, /sourceDeleted|autoShiftRestoreRow/);
  const rpcStart = handler.indexOf("const applied = transferRpcData");
  const rpcEnd = handler.indexOf("candidateType:'transfer'", rpcStart);
  const block = handler.slice(rpcStart, rpcEnd);
  assert.ok(rpcStart > 0 && rpcEnd > rpcStart);
  assert.doesNotMatch(block, /from\('hadas_shifts'\)\.delete|from\('hadas_shifts'\)\.update/);
});

test('full refresh carries current daily schedule metadata into the daily cache', () => {
  const data = read('handlers/data.js');
  const app = read('app.js');
  assert.match(data, /dailyScheduleMeta/);
  assert.match(data, /publication_revision: dailyPublication\?\.revision \|\| 0/);
  assert.match(app, /dailyScheduleMeta: data\.dailyScheduleMeta \|\| null/);
  assert.match(app, /scheduleMeta:state\.dailyScheduleMeta/);
});

test('admin and scheduler remain distinct role names with identical manager authorization', () => {
  for (const role of ['admin', 'scheduler']) {
    const caller = { user:{ role }, employee:{ job_title:role === 'admin' ? 'מנהלת מעון' : 'אחראית שיבוצים' } };
    assert.equal(server.isManager(caller), true);
    assert.equal(server.scheduleScope(caller), 'full');
    assert.equal(server.canManageDailyOperations(caller), true);
    assert.equal(server.canCreateContent(caller), true);
  }
  assert.doesNotMatch(read('patch-v0342.js'), /v0342IsManager|V0342ManagerParity|state\.profile\.can_view_full_schedule\s*=/);
});

test('superseded client patch layers are consolidated without losing final behavior', () => {
  const bootstrap = read('patch-v025.js');
  const availability = read('patch-v034.js');
  const announcements = read('patch-v0343.js');
  assert.equal(fs.existsSync(path.join(root, 'patch-v0341.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'patch-v0344.js')), false);
  assert.doesNotMatch(bootstrap, /V0341|V0344/);
  assert.match(availability, /absenceRowsFromRenderedAvailability/);
  assert.match(availability, /hadasAbsenceReport = 'availability-source'/);
  assert.match(announcements, /meta\.textContent = `\$\{israelDateTime\(item\.published_at\)\}/);
});

test('expected 4xx responses are not emitted as production errors', () => {
  const original = console.error;
  const calls = [];
  console.error = (...args) => calls.push(args);
  try {
    const res = { status(){ return this; }, setHeader(){}, end(){} };
    server.handleError(res, server.httpError(409, 'expected conflict'));
    assert.equal(calls.length, 0);
    server.handleError(res, new Error('real failure'));
    assert.equal(calls.length, 1);
  } finally {
    console.error = original;
  }
});

test('approval classification starts from raw validation before filtering exact keys', () => {
  const hotfix = read('lib/hotfix-v0342.js');
  const base = read('handlers/shifts.js');
  const approvals = read('lib/shifts-v030.js');
  assert.match(hotfix, /schedule\.validateWeekUnapproved = originalValidateWeek/);
  assert.match(base, /validation: validateWeekUnapproved\(/);
  assert.match(approvals, /const validation = validateWeekUnapproved\(/);
  assert.match(approvals, /approved = rawErrors\.filter\(\(item\) => approvals\.keys\.has\(item\.approval_key\)\)/);
});
