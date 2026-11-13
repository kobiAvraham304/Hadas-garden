const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function between(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a !== -1 && b > a, 'request dialog functions must remain discoverable');
  return app.slice(a, b);
}

test('both new request paths open the same dialog without throwing', () => {
  const nodes = new Map();
  const element = () => ({classList: {hidden:false, toggle(name,value) {this[name]=value;}, contains(name) {return Boolean(this[name]);}}});
  let showCount=0,requestType='leave';
  const form = {reset() {}, elements: {
    requester_id:{value:'',required:false,innerHTML:''},manager_apply_now:{value:''},
    request_date:{value:''},request_end_date:{value:''},
    shift_id:{required:false},target_employee_id:{required:false},
    requested_start:{required:false},requested_end:{required:false}
  }};
  for(const key of ['#swapCandidateSearch','#requestDialogTitle','#requestTypeHelp',
    '#requestRequesterField','#leaveDayOffField','#requestDuration','#leaveManualReminder',
    '.request-date-start span']) nodes.set(key,element());
  nodes.set('#requestForm',form);
  nodes.set('#requestDialog',{showModal(){showCount++;}});
  nodes.set('input[name="request_type"][value="leave"]',{checked:false});
  const fields=new Map();
  for(const selector of ['.request-start','.request-end','.request-range-end',
    '.shift-choice-field','.swap-field','.sick-attachment']) fields.set(selector,[element()]);
  const ctx=vm.createContext({
    $:selector=>nodes.get(selector)||null,$$:selector=>fields.get(selector)||[],
    state:{employees:[{id:'e1',active:true,full_name:'Test Employee',job_title:'staff'}]},
    isManager:()=>true,escapeHtml:value=>String(value),dateISO:()=> '2026-11-13',
    initializeRequestDateInput:(input,value)=>{input.value=value;},
    renderFixedDayOffOptions(){},updateRequestShiftOptions(){},
    updateRequestDuration(){},syncFixedDayOffChoice(){},
    selectedRequestType:()=>requestType,REQUEST_HELP:{leave:'leave',work:'work'},
    window:{HadasWork:{onFieldsChange(){}}}
  });
  vm.runInContext(between('function openRequestDialog(options={}) {','function openLeaveFromShift()')+
    between('function updateRequestFields() {','function updateRequestShiftOptions()'),ctx);
  vm.runInContext('openRequestDialog()',ctx);
  assert.equal(showCount,1);
  assert.equal(nodes.get('#requestRequesterField').classList.hidden,true);
  assert.equal(fields.get('.request-start')[0].classList.hidden,true);
  assert.equal(fields.get('.request-end')[0].classList.hidden,true);
  vm.runInContext('openRequestDialog({onBehalf:true})',ctx);
  assert.equal(showCount,2);
  assert.equal(nodes.get('#requestRequesterField').classList.hidden,false);
  assert.equal(form.elements.requester_id.required,true);
  assert.match(form.elements.requester_id.innerHTML,/Test Employee/);
  requestType='work';
  vm.runInContext('updateRequestFields()',ctx);
  assert.equal(fields.get('.request-start')[0].classList.hidden,false);
  assert.equal(fields.get('.request-end')[0].classList.hidden,false);
  assert.equal(form.elements.requested_start.required,true);
  assert.equal(form.elements.requested_end.required,true);
});

test('both new request buttons are wired to their dialog openers', () => {
  assert.match(app, /#newRequestBtn'\)\.addEventListener\('click', \(\) => openRequestDialog\(\)\)/);
  assert.match(app, /#newEmployeeRequestBtn'\)\?\.addEventListener\('click', \(\) => openRequestDialog\(\{onBehalf:true\}\)\)/);
  assert.doesNotMatch(app, /(?<!\$)\$\('\.request-(?:start|end)'\)\.forEach/);
});
