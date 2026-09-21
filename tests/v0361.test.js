const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { validationIssueKey } = require('../lib/shifts-v030');
const { validationApprovalKey } = require('../lib/schedule-approvals');

test('0.36 validation ignores general holidays and uses stable auto-approval identity', () => {
  const shifts = read('lib/shifts-v030.js');
  assert.match(shifts, /generalDayOffDates/);
  assert.match(shifts, /is_general_day_off/);
  assert.match(shifts, /withoutGeneralDayIssues/);
  assert.match(shifts, /row\.issue_snapshot/);
  const before = { code:'understaffed', date:'2026-09-20', class_id:'c1', time:'08:00', end_time:'10:00', count:0, expected:4, message:'חוסר 0 מתוך 4' };
  const after = { code:'understaffed', date:'2026-09-20', class_id:'c1', time:'08:00', end_time:'15:30', count:2, expected:4, message:'חוסר 2 מתוך 4' };
  assert.equal(validationIssueKey(before), validationIssueKey(after));
  assert.equal(validationApprovalKey(before), validationIssueKey(before));
});

test('0.36 approved validation exceptions are hidden until explicitly requested', () => {
  const v031 = read('patch-v031.js');
  const v032 = read('patch-v032-core.js');
  const v0342 = read('patch-v0342.js');
  assert.match(v031, /v031ShowApproved/);
  assert.match(v032, /v032ShowApproved/);
  assert.match(v032, /data-v032-toggle-approved/);
  assert.match(v032, /הצגת חריגות שאושרו/);
  assert.match(v032, /approvedHtml=state\.v032ShowApproved/);
  assert.match(v0342, /state\.v030Validation\.approved = state\.v030Validation\.approved \|\| \[\]/);
  assert.match(v0342, /v031-validation-card\.approved/);
  assert.match(v0342, /day-class-card\.attention-pulse/);
});

test('0.36 requests auto-apply after approval and no manual apply button remains', () => {
  const handler = read('handlers/requests.js');
  const app = read('app.js');
  const requestsV030 = read('lib/requests-v030.js');
  assert.match(handler, /body\.status === 'approved'[\s\S]*hadas_apply_approved_request/);
  assert.match(handler, /emitEvent\('shifts'\)/);
  assert.doesNotMatch(app, />הזרמה לטיוטת השיבוץ<\/button>/);
  assert.match(app, /setTimeout\(\(\)=>refreshAll\(\)\.catch/);
  assert.match(requestsV030, /if \(!managerSubmitted\)/);
  assert.match(requestsV030, /hadas_apply_approved_request/);
});

test('0.36 publication and errors stay visually unambiguous', () => {
  const app = read('app.js');
  const patch = read('patch-v0342.js');
  assert.match(app, /classList\.toggle\('is-unpublished',!clean\)/);
  assert.match(patch, /publication-toggle\.is-unpublished/);
  assert.match(app, /toast\.showPopover/);
  assert.match(patch, /#toast:popover-open/);
  assert.match(app, /generalDayOffDates\.has\(date\)/);
});

test('0.36 current cache chain loads the validation/request hotfix', () => {
  const index = read('index.html');
  const entry = read('patch-v025.js');
  const v033 = read('patch-v033.js');
  const v032 = read('patch-v032.js');
  assert.match(index, /app\.js\?v=0371/);
  assert.match(index, /patch-v025\.js\?v=0371/);
  assert.match(entry, /patch-v033\.js\?v=0333hf14/);
  assert.match(entry, /patch-v0342\.js\?v=0370/);
  assert.match(v033, /patch-v032\.js\?v=0321hf10/);
  assert.match(v032, /patch-v031\.js\?v=0321hf8/);
  assert.match(v032, /patch-v032-core\.js\?v=0321hf10/);
});
