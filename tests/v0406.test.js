const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const server = require('../lib/server');
test('teacher views all class schedules while keeping staff-level write permissions', () => {
  const teacher={user:{role:'employee'},employee:{job_title:'גננת',primary_class_id:'od'}};
  assert.equal(server.scheduleScope(teacher),'full');
  assert.equal(server.isManager(teacher),false);
  assert.equal(server.isTeacher(teacher),true);
  const data=read('handlers/data.js');
  assert.ok(data.includes('if (!isTeacher(caller)) {'));
  assert.ok(data.includes('shifts = restoreLastPublished(shifts, scheduleChanges);'));
  assert.ok(data.includes('else if (!fullScheduleViewer)'));
});
test('other staff keep their existing schedule restrictions', () => {
  assert.equal(server.scheduleScope({user:{role:'employee'},employee:{job_title:'סייעת/ סייע'}}),'personal');
  assert.equal(server.scheduleScope({user:{role:'employee'},employee:{job_title:'סייעת מובילה',primary_class_id:'od'}}),'class');
});
test('leave submission sends management push with direct request link', () => {
  const handler=read('handlers/requests.js');
  assert.ok(handler.includes('actionRequired:true,') && handler.includes('push:true,pushUrl:'));
  assert.ok(handler.includes('pushUrl:`/?push=request&id='));
  const backend=read('lib/server.js');
  assert.ok(backend.includes(".in('role', ['admin','scheduler'])"));
  assert.ok(backend.includes('if(push||automaticPushForNotification'));
});
test('request push opens the exact request without auto-approval', () => {
  const script=read('push-v0372.js');
  assert.ok(script.includes("target==='request'"));
  assert.ok(script.includes("state.requestStatusFilter='all'"));
  assert.ok(script.includes('dataset.requestId===requestId'));
  assert.ok(script.includes('scrollIntoView'));
  assert.ok(!script.includes("action:'decide'"));
});
test('phone absence grid uses the actual class name', () => {
  assert.ok(read('styles.css').includes('.absence-grid{grid-template-columns:minmax(0,1fr)!important}'));
  assert.ok(read('index.html').includes('/styles.css?v=0414'));
});
