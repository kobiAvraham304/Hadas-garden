const test = require('node:test');
const assert = require('node:assert/strict');

const schedule = require('../lib/schedule');
const hotfix = require('../lib/hotfix-v0342');

const settings = {
  opening_time: '07:30',
  closing_time: '15:30',
  friday_closing_time: '12:00',
  required_staff: 0,
  morning_required_staff: 0,
  closing_required_staff: 0,
  closing_window_minutes: 30,
  validation_slot_minutes: 30,
  require_leader: false,
};

test('substitute employees are omitted from team-availability absences', () => {
  const employees = [
    { id:'fixed', full_name:'עובדת קבועה', active:true, is_schedulable:true, assignment_mode:'fixed', fixed_day_off:0 },
    { id:'sub', full_name:'משלימה מקום', active:true, is_schedulable:true, assignment_mode:'substitute', fixed_day_off:0 },
  ];
  const rows = schedule.buildScheduleAvailability({
    employees,
    requests:[],
    weeklyPatterns:[
      { employee_id:'fixed', weekday:0, day_type:'day_off' },
      { employee_id:'sub', weekday:0, day_type:'day_off' },
    ],
    shifts:[],
    weekStart:'2026-08-30',
  });
  assert.equal(rows.some((row) => row.employee_id === 'fixed'), true);
  assert.equal(rows.some((row) => row.employee_id === 'sub'), false);
});

function autoInput(maxWeeklyHours = 40) {
  return {
    weekStart:'2026-08-30',
    mode:'fill',
    selectedDates:['2026-09-01'],
    classes:[{ id:'c1', name:'אודם', active:true }],
    employees:[{
      id:'e1', full_name:'עובדת לפי צורך', active:true, is_schedulable:true,
      assignment_mode:'fixed', weekly_hours:null, max_weekly_hours:maxWeeklyHours,
    }],
    settings,
    constraints:[],
    requests:[],
    patterns:[{ employee_id:'e1', weekday:2, day_type:'as_needed', start_time:'07:30', end_time:'15:30' }],
  };
}

function middleThreeHourPlan() {
  const row = {
    shift_date:'2026-09-01', class_id:'c1', employee_id:'e1',
    start_time:'10:00', end_time:'13:00', shift_role:'staff', status:'draft',
  };
  return {
    weekStart:'2026-08-30', selectedDates:['2026-09-01'], mode:'fill',
    keptCount:0, generated:[row], finalRows:[row], validation:{ errors:[], warnings:[] }, metrics:{},
  };
}

test('automatic schedule expands a three-hour middle-of-day segment to a practical edge block when possible', () => {
  const result = hotfix.normalizeAutomaticPlan(middleThreeHourPlan(), autoInput(40));
  assert.equal(result.generated.length, 1);
  const row = result.generated[0];
  const duration = schedule.timeToMinutes(row.end_time) - schedule.timeToMinutes(row.start_time);
  assert.equal(duration >= 240, true);
  assert.equal(row.start_time === '07:30' || row.end_time === '15:30', true);
  assert.equal(result.validation.errors.some((item) => item.code === 'short_nonfixed_shift'), false);
});

test('unavoidable three-hour middle-of-day automatic shift is blocking and requires explicit exception approval', () => {
  const result = hotfix.normalizeAutomaticPlan(middleThreeHourPlan(), autoInput(3));
  const row = result.generated[0];
  assert.equal(row.start_time, '10:00');
  assert.equal(row.end_time, '13:00');
  const issue = result.validation.errors.find((item) => item.code === 'short_nonfixed_shift');
  assert.ok(issue);
  assert.match(issue.message, /דורש אישור חריגה/);
});

test('manual rule override is not returned again as a live validation exception', () => {
  const result = schedule.validateWeek({
    shifts:[{
      id:'s1', shift_date:'2026-09-01', class_id:'c1', employee_id:'e1',
      start_time:'07:30', end_time:'15:30', shift_role:'staff', rule_override:true,
    }],
    classes:[{ id:'c1', name:'אודם', active:true }],
    employees:[{ id:'e1', full_name:'עובדת', active:true, is_schedulable:true, max_weekly_hours:4 }],
    settings,
    constraints:[], weeklyPatterns:[], requests:[], weekStart:'2026-08-30',
  });
  assert.equal(result.warnings.some((item) => item.code === 'manual_rule_override'), false);
  assert.equal(result.warnings.some((item) => item.code === 'max_weekly_hours'), false);
});
