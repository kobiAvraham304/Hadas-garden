const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { generateAutomaticSchedule, employeeAvailability } = require('../lib/auto-schedule');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function baseData() {
  const classes = ['אודם', 'סיני', 'גלבוע'].map((name, index) => ({ id:`c${index + 1}`, name, active:true, sort_order:index + 1 }));
  const employees = [];
  const patterns = [];
  for (const classItem of classes) {
    const suffix = classItem.id.slice(1);
    employees.push({ id:`t${suffix}`, full_name:`גננת ${suffix}`, job_title:'גננת', active:true, is_schedulable:true, assignment_mode:'fixed', primary_class_id:classItem.id, weekly_hours:44.5, max_weekly_hours:45, default_start:'07:30', default_end:'15:30' });
    for (let index = 1; index <= 3; index += 1) employees.push({ id:`s${suffix}${index}`, full_name:`צוות ${suffix}-${index}`, job_title:'סייעת/ סייע', active:true, is_schedulable:true, assignment_mode:'fixed', primary_class_id:classItem.id, weekly_hours:44.5, max_weekly_hours:45, default_start:'07:30', default_end:'15:30' });
  }
  for (const employee of employees) for (let weekday = 0; weekday <= 5; weekday += 1) patterns.push({ employee_id:employee.id, weekday, day_type:'work', start_time:'07:30', end_time:weekday === 5 ? '12:00' : '15:30' });
  return {
    weekStart:'2026-08-02', employees, classes, patterns, constraints:[], requests:[], existingShifts:[], previousShifts:[],
    settings:{ opening_time:'07:30', closing_time:'15:30', friday_closing_time:'12:00', required_staff:4, closing_required_staff:3, closing_window_minutes:30, validation_slot_minutes:30, require_leader:true },
  };
}

test('automatic scheduler creates a deterministic, fully staffed draft from employee cards', () => {
  const input = baseData();
  const first = generateAutomaticSchedule({ ...input, mode:'rebuild', createdBy:'manager' });
  const second = generateAutomaticSchedule({ ...input, mode:'rebuild', createdBy:'manager' });
  assert.equal(first.signature, second.signature);
  assert.equal(first.generated.length, 72);
  assert.equal(first.validation.errors.length, 0);
  assert.equal(first.metrics.coveragePercent, 100);
  assert.equal(first.metrics.leaderPercent, 100);
  assert.ok(first.generated.every((row) => row.status === 'draft'));
  assert.ok(first.generated.filter((row) => row.shift_date === '2026-08-07').every((row) => row.end_time === '12:00'));
  for (const row of first.generated) {
    const employee = input.employees.find((item) => item.id === row.employee_id);
    assert.equal(row.class_id, employee.primary_class_id);
  }
});

test('approved absences and forbidden classes are excluded from automatic scheduling', () => {
  const input = baseData();
  input.employees.push({ id:'sub', full_name:'משלימה', job_title:'סייעת/ סייע', active:true, is_schedulable:true, assignment_mode:'substitute', primary_class_id:null, weekly_hours:8, max_weekly_hours:16, default_start:'07:30', default_end:'15:30' });
  for (let weekday = 0; weekday <= 5; weekday += 1) input.patterns.push({ employee_id:'sub', weekday, day_type:'as_needed', start_time:null, end_time:null });
  input.requests.push({ requester_id:'s11', request_type:'leave', status:'approved', request_date:'2026-08-03', request_end_date:'2026-08-03' });
  input.constraints.push({ employee_id:'sub', class_id:'c2', constraint_type:'forbidden', valid_from:null, valid_to:null });
  const plan = generateAutomaticSchedule({ ...input, mode:'rebuild' });
  assert.equal(plan.generated.some((row) => row.employee_id === 's11' && row.shift_date === '2026-08-03'), false);
  assert.equal(plan.generated.some((row) => row.employee_id === 'sub' && row.class_id === 'c2'), false);
  assert.equal(plan.generated.some((row) => row.employee_id === 'sub' && row.class_id === 'c1' && row.shift_date === '2026-08-03'), true);
});

test('automatic scheduler never exceeds maximum weekly hours', () => {
  const input = baseData();
  input.employees.find((row) => row.id === 's11').max_weekly_hours = 8;
  const plan = generateAutomaticSchedule({ ...input, mode:'rebuild' });
  const minutes = plan.generated.filter((row) => row.employee_id === 's11').reduce((sum, row) => {
    const [sh, sm] = row.start_time.split(':').map(Number); const [eh, em] = row.end_time.split(':').map(Number);
    return sum + (eh * 60 + em) - (sh * 60 + sm);
  }, 0);
  assert.ok(minutes <= 480);
});

test('fill mode keeps existing shifts and includes them in the preview signature', () => {
  const input = baseData();
  input.existingShifts = [{ id:'existing', shift_date:'2026-08-02', class_id:'c1', employee_id:'t1', start_time:'07:30', end_time:'15:30', shift_role:'teacher', status:'draft' }];
  const plan = generateAutomaticSchedule({ ...input, mode:'fill' });
  assert.equal(plan.keptCount, 1);
  assert.equal(plan.finalRows.some((row) => row.id === 'existing'), true);
  const changed = generateAutomaticSchedule({ ...input, existingShifts:[{ ...input.existingShifts[0], end_time:'14:30' }], mode:'fill' });
  assert.notEqual(plan.signature, changed.signature);
});


test('automatic scheduler reserves fixed-class staff before borrowing between classrooms', () => {
  const input = baseData();
  input.employees = input.employees.filter((row) => row.id !== 's13');
  input.patterns = input.patterns.filter((row) => row.employee_id !== 's13');
  const plan = generateAutomaticSchedule({ ...input, mode:'rebuild' });
  const c2Employees = new Set(input.employees.filter((row) => row.primary_class_id === 'c2').map((row) => row.id));
  assert.equal(plan.generated.some((row) => row.class_id === 'c1' && c2Employees.has(row.employee_id)), false);
  assert.equal(plan.generated.filter((row) => row.shift_date === '2026-08-02' && row.class_id === 'c2').length, 4);
  assert.ok(plan.validation.errors.some((row) => row.class_id === 'c1'));
});

test('employee availability respects Friday close, day off and approved leave', () => {
  const input = baseData();
  const employee = input.employees[0];
  const friday = employeeAvailability({ employee, date:'2026-08-07', patterns:input.patterns, requests:[], settings:input.settings });
  assert.equal(friday.end, '12:00');
  const dayOffPatterns = input.patterns.map((row) => row.employee_id === employee.id && row.weekday === 2 ? { ...row, day_type:'day_off' } : row);
  assert.equal(employeeAvailability({ employee, date:'2026-08-04', patterns:dayOffPatterns, requests:[], settings:input.settings }), null);
  assert.equal(employeeAvailability({ employee, date:'2026-08-05', patterns:input.patterns, requests:[{ requester_id:employee.id, request_type:'sick', status:'approved', request_date:'2026-08-05', request_end_date:'2026-08-05' }], settings:input.settings }), null);
});

test('0.15 interface bundles automatic scheduling, custom worker search and compact mobile controls', () => {
  const html = read('index.html'); const app = read('app.js'); const css = read('styles.css'); const handler = read('handlers/shifts.js');
  for (const id of ['autoScheduleBtn','autoScheduleDialog','autoSchedulePreview','shiftEmployeeSearch','shiftEmployeeOptionsList']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, /calculateAutomaticSchedule/);
  assert.match(app, /applyAutomaticSchedule/);
  assert.match(app, /מידת התאמה/);
  assert.match(css, /\.auto-schedule-btn|\.auto-schedule-setup/);
  assert.match(css, /\.shift-employee-options/);
  assert.match(css, /linear-gradient\(90deg,#e96871 0%,#efb34f 50%,#4fbd82 100%\)/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*\.main-nav/);
  assert.match(handler, /action === 'auto_preview'/);
  assert.match(handler, /action === 'auto_apply'/);
  assert.match(handler, /hadas_apply_automatic_schedule/);
});
