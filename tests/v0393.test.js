const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(path,'utf8');

test('0.39.4 shows the explicit leave checkbox before the scrollable employee list', () => {
  const html = read('index.html');
  const field = html.indexOf('id="approvedLeaveOverrideField"');
  const list = html.indexOf('id="shiftEmployeeOptionsList"');
  const hint = html.indexOf('id="shiftEmployeeHint"');
  assert.ok(field > 0 && list > field && hint > list, 'confirmation must be above employee list and its hint');
  assert.match(html,/type="checkbox" name="override_approved_leave" id="approvedLeaveOverrideCheck"/);
  assert.match(read('patch-v0392.css'),/#shiftForm #approvedLeaveOverrideField:not\(\.hidden\)\{display:flex!important/);
  assert.match(read('patch-v0392.css'),/#shiftForm #approvedLeaveOverrideCheck\{appearance:auto!important/);
});

test('0.39.4 synchronizes native hidden property and checkbox disabled state', () => {
  const client = read('app.js');
  const start = client.indexOf('function syncApprovedLeaveOverride()');
  const end = client.indexOf('function renderShiftEmployeePicker()', start);
  assert.ok(start >= 0 && end > start);
  const form = {elements:{employee_id:{value:'staff-id'}}};
  const classes = new Set(['hidden']);
  const field = {hidden:true,attributes:{},classList:{toggle(name,yes){if(yes)classes.add(name);else classes.delete(name)}},setAttribute(name,value){this.attributes[name]=value;}};
  const checkbox={disabled:true,checked:false};
  const $ = selector => ({'#shiftForm':form,'#approvedLeaveOverrideField':field,'#approvedLeaveOverrideCheck':checkbox}[selector]);
  let approved = false;
  const sync = new Function('$','approvedLeaveForShift',client.slice(start,end)+'; return syncApprovedLeaveOverride;')($, () => approved ? {request_type:'leave'} : null);
  sync();
  assert.equal(field.hidden,true);
  assert.equal(checkbox.disabled,true);
  assert.equal(classes.has('hidden'),true);
  approved = true;
  sync();
  assert.equal(field.hidden,false);
  assert.equal(checkbox.disabled,false);
  assert.equal(classes.has('hidden'),false);
  checkbox.checked=true;
  approved = false;
  sync();
  assert.equal(checkbox.checked,false,'stale leave approval must never remain selected');
});

test('0.39.4 reflects live employee/date changes and preserves mandatory server leave authorization', () => {
  const client = read('app.js'),server=read('handlers/shifts.js');
  assert.match(client,/function updateShiftEmployeeHint\(\) \{\s*syncApprovedLeaveOverride\(\);/);
  assert.match(client,/\[name="shift_date"\]'\)\.addEventListener\('change', \(\) => \{ syncApprovedLeaveOverride\(\);/);
  assert.match(server,/overrideApprovedLeave && \['leave','day_off'\]\.includes\(approvedAbsence\.request_type\)/);
  assert.equal(JSON.parse(read('package.json')).version, '0.39.4');
  assert.match(read('patch-v025.js'),/patch-v0392\.css\?v=0393/);
});
