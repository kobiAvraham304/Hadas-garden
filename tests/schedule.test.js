const test = require('node:test');
const assert = require('node:assert/strict');
const { overlaps, calculateWeeklyMinutes, validateWeek } = require('../lib/schedule');

const settings = {
  opening_time: '07:30', closing_time: '15:30', required_staff: 4,
  closing_required_staff: 3, closing_window_minutes: 30, validation_slot_minutes: 30,
};
const classItem = { id: 'class-1', name: 'אודם', active: true };
const employees = Array.from({ length: 5 }, (_, index) => ({
  id: `e${index + 1}`, full_name: `עובדת ${index + 1}`, active: true,
  weekly_hours: null,
}));

function fullWeekShifts() {
  const dates = ['2026-08-02','2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07'];
  return dates.flatMap((date) => [
    { id:`${date}-1`, shift_date:date, class_id:'class-1', employee_id:'e1', start_time:'07:30', end_time:'15:30', shift_role:'teacher' },
    { id:`${date}-2`, shift_date:date, class_id:'class-1', employee_id:'e2', start_time:'07:30', end_time:'15:30', shift_role:'staff' },
    { id:`${date}-3`, shift_date:date, class_id:'class-1', employee_id:'e3', start_time:'07:30', end_time:'15:30', shift_role:'staff' },
    { id:`${date}-4`, shift_date:date, class_id:'class-1', employee_id:'e4', start_time:'07:30', end_time:'15:00', shift_role:'staff' },
  ]);
}

test('time overlap and weekly-minute helpers work for partial shifts', () => {
  assert.equal(overlaps('07:30','10:00','09:30','11:00'), true);
  assert.equal(overlaps('07:30','10:00','10:00','11:00'), false);
  const shifts = [
    { employee_id:'e1', start_time:'07:30', end_time:'10:00' },
    { employee_id:'e1', start_time:'11:30', end_time:'15:30' },
  ];
  assert.equal(calculateWeeklyMinutes(shifts,'e1'), 390);
});

test('four staff during the day and three in closing window passes', () => {
  const result = validateWeek({ shifts:fullWeekShifts(), classes:[classItem], employees, settings, weekStart:'2026-08-02' });
  assert.equal(result.errors.length, 0);
});

test('detects understaffing, missing leader, overlap and forbidden class', () => {
  const shifts = fullWeekShifts();
  shifts.splice(shifts.findIndex((s) => s.id === '2026-08-02-3'), 1);
  shifts.find((s) => s.id === '2026-08-03-1').shift_role = 'staff';
  shifts.push({ id:'overlap', shift_date:'2026-08-04', class_id:'class-1', employee_id:'e1', start_time:'08:00', end_time:'09:00', shift_role:'staff' });
  const result = validateWeek({
    shifts, classes:[classItem], employees, settings, weekStart:'2026-08-02',
    constraints:[{ employee_id:'e2', class_id:'class-1', constraint_type:'forbidden', valid_from:'2026-08-05', valid_to:'2026-08-05' }],
  });
  const codes = new Set(result.errors.map((item) => item.code));
  assert.equal(codes.has('understaffed'), true);
  assert.equal(codes.has('missing_leader'), true);
  assert.equal(codes.has('overlap'), true);
  assert.equal(codes.has('forbidden_class'), true);
});

test('coverage validation is compact and never floods one error per time slot', () => {
  const classes = [
    { id:'c1', name:'סיני', active:true },
    { id:'c2', name:'אודם', active:true },
    { id:'c3', name:'גלבוע', active:true },
  ];
  const result = validateWeek({ shifts:[], classes, employees:[], settings, weekStart:'2026-08-02' });
  assert.equal(result.errors.length, 36); // 6 days × 3 classes × 2 grouped issue types
  assert.equal(result.errors.filter((item) => item.code === 'understaffed').length, 18);
  assert.equal(result.errors.filter((item) => item.code === 'missing_leader').length, 18);
  assert.ok(result.errors.every((item) => /07:30–15:30/.test(item.message)));
});
