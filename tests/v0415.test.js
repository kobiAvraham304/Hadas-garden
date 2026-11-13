const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('manager work request shows three selectable classes with preferred home class',()=>{
  const html=read('index.html'),ui=read('work-ui-v0413.js');
  assert.match(html,/id="workRequestClassField"/);
  assert.match(html,/id="workRequestClasses"/);
  assert.match(ui,/name="requested_class_id"/);
  assert.match(ui,/row\.id===worker\.primary_class_id/);
  assert.match(ui,/field\.disabled=!visible/);
  assert.match(ui,/work&&isOnBehalf\(\)/);
  assert.match(ui,/יש לבחור כיתה עבור העובד/);
  assert.match(ui,/request\.application_snapshot\?\.requested_class_id/);
});

test('manager preapproval creates a shift through existing guarded transactional RPC',()=>{
  const server=read('lib/work-request-v0413.js');
  assert.match(server,/const preapproved=onBehalf&&isManager\(caller\)/);
  assert.match(server,/body\.pre_approved===true/);
  assert.match(server,/if\(onBehalf\)\{\s*if\(!UUID\.test\(requestedClassId\)\)/);
  assert.match(server,/application_snapshot:requestedClassId\?\{requested_class_id:requestedClassId\}:null/);
  assert.match(server,/if\(preapproved\)\{\s*try\{approved=await approveWork\(/);
  assert.match(server,/db\(\)\.rpc\('hadas_approve_work_request'/);
  assert.match(server,/approval_error:approvalError/);
  assert.match(server,/notifyManagers\(/);
  assert.match(server,/shift_id:approved\.shift_id/);
  assert.match(read('migrations/20261113_work_requests.sql'),/FOR UPDATE/);
});

test('new work request submission displays accurate success or pending warning',()=>{
  const app=read('app.js'),ui=read('work-ui-v0413.js');
  assert.match(app,/if\(data\.request_type==='work'&&result\?\.shift_id\)/);
  assert.match(app,/result\?\.approval_error/);
  assert.match(ui,/checkbox\.checked=true/);
  assert.match(ui,/if\(button&&!button\.disabled\)button\.textContent=/);
});

test('release assets refresh and version matches package',()=>{
  const html=read('index.html');
  assert.equal(require('../package.json').version,'0.40.15');
  for(const value of ['/styles.css?v=0415','/app.js?v=0415',
    '/work-ui-v0413.js?v=0415','/patch-v025.js?v=0415'])assert.ok(html.includes(value),value);
});
