const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = p => fs.readFileSync(p,'utf8');

test('0.39.2 version is aligned in bootstrap and UI', () => {
  assert.equal(JSON.parse(read('package.json')).version,'0.39.2');
  assert.match(read('patch-v025.js'),/const VERSION = '0\.39\.2'/);
  assert.match(read('patch-v0391.js'),/const VERSION = '0\.39\.2'/);
});

test('0.39.2 approved leave requires explicit confirmation, does not delete leave', () => {
  const html=read('index.html'),client=read('app.js'),server=read('handlers/shifts.js');
  assert.match(html,/id="approvedLeaveOverrideCheck"/);
  assert.match(client,/data\.override_approved_leave = Boolean/);
  assert.match(client,/approvedLeaveForShift\(data\.employee_id, data\.shift_date\)/);
  assert.match(server,/\['leave','day_off'\]\.includes\(approvedAbsence\.request_type\)/);
  assert.match(server,/שיבוץ ידני בזמן חופשה מאושרת/);
  assert.doesNotMatch(server,/hadas_requests'\)\.delete\(.*override_approved_leave/);
});

test('0.39.2 auto-scheduling defers approvals to the validation screen', () => {
  const client=read('app.js'),server=read('handlers/shifts.js');
  const apply=client.slice(client.indexOf('async function applyAutomaticSchedule()'),client.indexOf('function openAutoCorrectionShift('));
  assert.match(apply,/allow_incomplete:true/);
  assert.doesNotMatch(apply,/approved_issues:/);
  assert.doesNotMatch(apply,/autoScheduleIssueDecisions\.get/);
  assert.match(client,/אישורים וחריגות מטופלים בבדיקות תקינות/);
  assert.match(server,/unsafeCodes/);
  assert.match(server,/approved_keys: \[\]/);
});

test('0.39.2 uses consistent Hebrew font and 24-hour windows input', () => {
  const css=read('patch-v0392.css'),html=read('index.html'),client=read('app.js');
  assert.match(html,/fonts\.googleapis\.com/);
  assert.match(css,/Heebo/);
  assert.match(client,/Windows NT/);
  assert.match(client,/HH:MM/);
  assert.match(client,/setCustomValidity/);
});
