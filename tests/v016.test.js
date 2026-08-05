const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { rankCandidates } = require('../handlers/suggestions');

function employee(id, extra = {}) {
  return {
    id, full_name: `עובד ${id}`, active: true, is_schedulable: true,
    assignment_mode: 'rotation', default_start: '07:30', default_end: '15:30',
    job_title: 'סייעת/סייע', weekly_hours: 40, max_weekly_hours: 45,
    ...extra,
  };
}
function baseContext() {
  const date = '2026-08-02';
  const classA = { id: 'a', name: 'אודם' };
  const classB = { id: 'b', name: 'סיני' };
  const employees = [
    employee('direct', { assignment_mode: 'substitute' }),
    employee('transfer', { assignment_mode: 'rotation', primary_class_id: 'b' }),
    employee('b1', { job_title: 'גננת', can_lead: true, primary_class_id: 'b' }),
    employee('b2', { primary_class_id: 'b' }), employee('b3', { primary_class_id: 'b' }),
    employee('b4', { primary_class_id: 'b' }),
    employee('forbidden'), employee('sick'), employee('target'),
  ];
  const shifts = [
    { id:'source', employee_id:'transfer', class_id:'b', shift_date:date, start_time:'07:30', end_time:'15:30', shift_role:'staff' },
    { id:'b1s', employee_id:'b1', class_id:'b', shift_date:date, start_time:'07:30', end_time:'15:30', shift_role:'teacher' },
    { id:'b2s', employee_id:'b2', class_id:'b', shift_date:date, start_time:'07:30', end_time:'15:30', shift_role:'staff' },
    { id:'b3s', employee_id:'b3', class_id:'b', shift_date:date, start_time:'07:30', end_time:'15:30', shift_role:'staff' },
    { id:'b4s', employee_id:'b4', class_id:'b', shift_date:date, start_time:'07:30', end_time:'15:30', shift_role:'staff' },
  ];
  return {
    employees, shifts, requests:[{ employee_id:'sick', request_type:'sick', status:'approved', request_date:date, request_end_date:date }],
    constraints:[{ employee_id:'forbidden', class_id:'a', constraint_type:'forbidden' }], patterns:[], operations:[], attendance:[],
    settings:{ opening_time:'07:30', closing_time:'15:30', friday_closing_time:'12:00', required_staff:4, closing_required_staff:3, closing_window_minutes:30, validation_slot_minutes:30, require_leader:true },
    classes:[classA,classB], date, classId:'a', start:'07:30', end:'15:30', neededRole:'staff',
  };
}

test('0.16 matching engine returns direct workers and safe cross-class transfers while excluding invalid workers', () => {
  const candidates = rankCandidates(baseContext());
  const ids = candidates.map((item) => item.employee_id);
  assert.ok(ids.includes('direct'));
  assert.ok(ids.includes('transfer'));
  assert.equal(candidates.find((item) => item.employee_id === 'transfer').candidate_type, 'transfer');
  assert.ok(!ids.includes('forbidden'));
  assert.ok(!ids.includes('sick'));
  assert.ok(candidates.every((item) => item.score >= 1 && item.score <= 100));
});

test('0.16 add and replacement contexts use the same score model', () => {
  const context = baseContext();
  const add = rankCandidates(context).find((item) => item.employee_id === 'direct');
  const replace = rankCandidates({ ...context, excludedEmployeeId:'target', excludeShiftId:'target-shift' }).find((item) => item.employee_id === 'direct');
  assert.ok(add && replace);
  assert.equal(add.score, replace.score);
  assert.deepEqual(add.reasons, replace.reasons);
});

test('0.16 blocks a transfer when the source class would fall below staffing or lose its leader', () => {
  const context = baseContext();
  context.shifts = context.shifts.filter((shift) => shift.employee_id !== 'b4');
  const ids = rankCandidates(context).map((item) => item.employee_id);
  assert.ok(!ids.includes('transfer'));
});

test('0.16 interface contains hard mobile containment and sticky modal controls', () => {
  const css = read('styles.css');
  assert.match(css, /Safari mobile containment/);
  assert.match(css, /dialog\.modal\{inset:4px!important/);
  assert.match(css, /\.modal-heading\{position:sticky!important/);
  assert.match(css, /overflow-x:clip!important/);
  assert.match(css, /\.main-nav\{inset-inline:8px!important/);
});

test('0.16 applies direct and transfer suggestions through one validated shift action', () => {
  const shifts = read('handlers/shifts.js');
  const app = read('app.js');
  assert.match(shifts, /body\.action === 'apply_suggestion'/);
  assert.match(shifts, /sourceClassCanRelease/);
  assert.match(app, /action:'apply_suggestion'/);
  assert.match(app, /candidate_type:candidate\.candidate_type/);
});
