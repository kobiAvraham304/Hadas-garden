function timeToMinutes(value) {
  if (!value) return 0;
  const [hours, minutes] = String(value).slice(0, 5).split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value) {
  const minutes = Math.max(0, Number(value) || 0);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(aEnd) > timeToMinutes(bStart);
}

function dateRange(startDate, count = 6) {
  const start = new Date(`${startDate}T12:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + index);
    return d.toISOString().slice(0, 10);
  });
}

/**
 * Builds the safe, public availability strip shown next to the schedule.
 * One-time approved absences take precedence over a recurring day off. A
 * recurring day off is still returned when the employee was exceptionally
 * rostered, but is marked separately so managers can spot the override.
 */
function buildScheduleAvailability({ requests = [], employees = [], weeklyPatterns = [], shifts = [], weekStart, dates = null }) {
  const visibleDates = Array.isArray(dates) && dates.length ? [...new Set(dates)] : dateRange(weekStart, 6);
  const dateSet = new Set(visibleDates);
  const activeEmployees = employees.filter((row) => row?.active !== false && row?.is_schedulable !== false);
  const activeIds = new Set(activeEmployees.map((row) => row.id));
  const scheduledKeys = new Set(shifts.filter((row) => dateSet.has(row.shift_date)).map((row) => `${row.employee_id}:${row.shift_date}`));
  const patternByEmployeeDay = new Map(weeklyPatterns.map((row) => [`${row.employee_id}:${Number(row.weekday)}`, row]));
  const result = new Map();

  for (const request of requests) {
    if (!activeIds.has(request.requester_id)) continue;
    if (!['approved', 'applied'].includes(request.status) || !['leave', 'day_off', 'sick'].includes(request.request_type)) continue;
    const endDate = String(request.request_end_date || request.request_date);
    for (const date of visibleDates) {
      if (date < request.request_date || date > endDate) continue;
      result.set(`${request.requester_id}:${date}`, {
        employee_id: request.requester_id,
        absence_date: date,
        absence_type: request.request_type,
        absence_kind: 'one_time_absence',
      });
    }
  }

  for (const employee of activeEmployees) {
    for (const date of visibleDates) {
      const weekday = weekdayOf(date);
      const pattern = patternByEmployeeDay.get(`${employee.id}:${weekday}`);
      const isDayOff = pattern ? pattern.day_type === 'day_off' : Number(employee.fixed_day_off) === weekday;
      if (!isDayOff) continue;
      const key = `${employee.id}:${date}`;
      if (result.has(key)) continue;
      const worked = scheduledKeys.has(key);
      result.set(key, {
        employee_id: employee.id,
        absence_date: date,
        absence_type: worked ? 'day_off_worked' : 'fixed_day_off',
        absence_kind: worked ? 'worked_day_off' : 'fixed_day_off',
      });
    }
  }

  return [...result.values()].sort((a, b) => `${a.absence_date}-${a.employee_id}`.localeCompare(`${b.absence_date}-${b.employee_id}`));
}

function weekdayOf(dateString) {
  return new Date(`${dateString}T12:00:00Z`).getUTCDay();
}

function closingTimeForDate(settings, dateString) {
  return weekdayOf(dateString) === 5
    ? String(settings.friday_closing_time || '12:00').slice(0, 5)
    : String(settings.closing_time || '15:30').slice(0, 5);
}

function requiredStaffAt(settings, dateString, minute) {
  const closing = timeToMinutes(closingTimeForDate(settings, dateString));
  const opening = timeToMinutes(settings.opening_time || '07:30');
  const morningEnd = timeToMinutes(settings.morning_end_time || '08:15');
  const regular = Number(settings.required_staff || 4);
  const morning = Number(settings.morning_required_staff || regular);
  const closingRequired = Number(settings.closing_required_staff || 3);
  const closingWindow = Math.max(0, Number(settings.closing_window_minutes || 30));
  const point = Number(minute);
  if (point >= opening && point < Math.min(morningEnd, closing)) return morning;
  if (closingWindow > 0 && point >= closing - closingWindow) return closingRequired;
  return regular;
}

function leaderRequiredAt(settings, dateString, minute) {
  if (settings.require_leader === false) return false;
  const opening = timeToMinutes(settings.opening_time || '07:30');
  const from = timeToMinutes(settings.morning_end_time || settings.opening_time || '07:30');
  const closing = timeToMinutes(closingTimeForDate(settings, dateString));
  const point = Number(minute);
  return point >= Math.max(opening, from) && point < closing;
}

function coverageSlots(settings, dateString, rows = []) {
  const opening = timeToMinutes(settings.opening_time || '07:30');
  const closing = timeToMinutes(closingTimeForDate(settings, dateString));
  const interval = Math.max(5, Number(settings.validation_slot_minutes || 30));
  const points = new Set([opening, closing]);
  const morningEnd = timeToMinutes(settings.morning_end_time || settings.opening_time || '07:30');
  const closingStart = closing - Math.max(0, Number(settings.closing_window_minutes || 30));
  if (morningEnd > opening && morningEnd < closing) points.add(morningEnd);
  if (closingStart > opening && closingStart < closing) points.add(closingStart);
  for (let point = opening + interval; point < closing; point += interval) points.add(point);
  for (const row of rows || []) {
    for (const value of [row?.start_time, row?.end_time]) {
      if (!value) continue;
      const point = timeToMinutes(value);
      if (point > opening && point < closing) points.add(point);
    }
  }
  const sorted = [...points].sort((a, b) => a - b);
  return sorted.slice(0, -1).map((start, index) => ({ start, end: sorted[index + 1] })).filter((slot) => slot.end > slot.start);
}

function calculateWeeklyMinutes(shifts, employeeId) {
  return shifts
    .filter((shift) => shift.employee_id === employeeId)
    .reduce((sum, shift) => sum + Math.max(0, timeToMinutes(shift.end_time) - timeToMinutes(shift.start_time)), 0);
}

function validateWeek({ shifts, classes, employees, settings, weekStart, constraints = [], weeklyPatterns = [], requests = [] }) {
  const errors = [];
  const warnings = [];
  const opening = timeToMinutes(settings.opening_time || '07:30');
  const slotMinutes = Number(settings.validation_slot_minutes || 30);
  const requireLeader = settings.require_leader !== false;
  const maxDailyStaffValue = Number(settings.max_daily_staff);
  const maxDailyStaff = Number.isInteger(maxDailyStaffValue) && maxDailyStaffValue > 0 ? maxDailyStaffValue : null;
  const dates = dateRange(weekStart, 6);
  const activeClasses = classes.filter((item) => item.active !== false);
  const activeEmployees = employees.filter((item) => item.active !== false && item.is_schedulable !== false);
  const patternsByEmployee = new Map();
  for (const pattern of weeklyPatterns) {
    if (!patternsByEmployee.has(pattern.employee_id)) patternsByEmployee.set(pattern.employee_id, []);
    patternsByEmployee.get(pattern.employee_id).push(pattern);
  }

  for (const employee of activeEmployees) {
    const employeeShifts = shifts.filter((shift) => shift.employee_id === employee.id);
    for (let i = 0; i < employeeShifts.length; i++) {
      for (let j = i + 1; j < employeeShifts.length; j++) {
        const first = employeeShifts[i];
        const second = employeeShifts[j];
        if (first.shift_date === second.shift_date && overlaps(first.start_time, first.end_time, second.start_time, second.end_time)) {
          errors.push({ code: 'overlap', date: first.shift_date, employee_id: employee.id, message: `${employee.full_name} משובץ בשעות חופפות` });
        }
      }
    }
  }

  for (const shift of shifts) {
    const employee = activeEmployees.find((item) => item.id === shift.employee_id);
    const classItem = activeClasses.find((item) => item.id === shift.class_id);
    const dayClose = closingTimeForDate(settings, shift.shift_date);
    if (timeToMinutes(shift.start_time) < opening || timeToMinutes(shift.end_time) > timeToMinutes(dayClose)) {
      errors.push({ code: 'outside_opening_hours', date: shift.shift_date, employee_id: shift.employee_id, class_id: shift.class_id, message: `${employee?.full_name || 'העובד'} שובץ מחוץ לשעות המעון 07:30–${dayClose}` });
    }
    const manualOverride=Boolean(shift.rule_override);
    if (!manualOverride) {
      const approvedAbsence = requests.find((item) => (item.requester_id || item.employee_id) === shift.employee_id
        && ['approved','applied'].includes(String(item.status || ''))
        && ['leave','day_off','sick'].includes(String(item.request_type || ''))
        && item.request_date <= shift.shift_date && shift.shift_date <= String(item.request_end_date || item.request_date));
      if (approvedAbsence) errors.push({ code:'approved_absence', date:shift.shift_date, employee_id:shift.employee_id, class_id:shift.class_id, message:`${employee?.full_name || 'העובד'} משובץ בזמן חופשה/מחלה/יום חופשי מאושרים` });
      const forbidden = constraints.find((item) => item.employee_id === shift.employee_id && item.class_id === shift.class_id && item.constraint_type === 'forbidden' && (!item.valid_from || item.valid_from <= shift.shift_date) && (!item.valid_to || item.valid_to >= shift.shift_date));
      if (forbidden) errors.push({ code: 'forbidden_class', date: shift.shift_date, employee_id: shift.employee_id, class_id: shift.class_id, message: `לא ניתן לשבץ את ${employee?.full_name || 'העובד'} בכיתת ${classItem?.name || ''}` });
      if (employee?.job_title === 'גננת' && employee.primary_class_id && employee.primary_class_id !== shift.class_id) errors.push({ code:'teacher_fixed_class', date:shift.shift_date, employee_id:shift.employee_id, class_id:shift.class_id, message:`${employee.full_name}: גננת יכולה להשתבץ רק בכיתה הקבועה שלה` });
      const weekday = weekdayOf(shift.shift_date); const pattern = (patternsByEmployee.get(shift.employee_id) || []).find((row) => Number(row.weekday) === weekday);
      if (pattern?.day_type === 'day_off') errors.push({ code: 'fixed_day_off', date: shift.shift_date, employee_id: shift.employee_id, class_id: shift.class_id, message: `${employee?.full_name || 'העובד'} משובץ ביום חופשי קבוע` });
      else if (pattern?.day_type === 'work' && (timeToMinutes(shift.start_time) < timeToMinutes(pattern.start_time) || timeToMinutes(shift.end_time) > timeToMinutes(pattern.end_time))) warnings.push({ code: 'outside_fixed_hours', date: shift.shift_date, employee_id: shift.employee_id, class_id: shift.class_id, message: `${employee?.full_name || 'העובד'} שובץ מחוץ לשעות הקבועות ${String(pattern.start_time).slice(0,5)}–${String(pattern.end_time).slice(0,5)}` });
    } else warnings.push({ code:'manual_rule_override',date:shift.shift_date,employee_id:shift.employee_id,class_id:shift.class_id,message:`${employee?.full_name||'העובד'}: שיבוץ ידני חריג${shift.rule_override_note?` — ${shift.rule_override_note}`:''}` });
  }

  for (const date of dates) {
    const closing = timeToMinutes(closingTimeForDate(settings, date));
    for (const classItem of activeClasses) {
      const classShifts = shifts.filter((shift) => shift.shift_date === date && shift.class_id === classItem.id);
      for (const slot of coverageSlots(settings, date, classShifts)) {
        const people = new Set(classShifts.filter((shift) => timeToMinutes(shift.start_time) <= slot.start && timeToMinutes(shift.end_time) >= slot.end).map((shift) => shift.employee_id));
        const expected = requiredStaffAt(settings, date, slot.start);
        if (people.size < expected) errors.push({ code: 'understaffed', date, class_id: classItem.id, time: minutesToTime(slot.start), count: people.size, expected, end_time: minutesToTime(slot.end), message: `${classItem.name}: ${people.size} אנשי צוות בשעה ${minutesToTime(slot.start)} במקום ${expected}` });
        if (maxDailyStaff != null && people.size > maxDailyStaff) errors.push({ code: 'max_daily_staff', date, class_id: classItem.id, time: minutesToTime(slot.start), count: people.size, expected: maxDailyStaff, end_time: minutesToTime(slot.end), message: `${classItem.name}: ${people.size} אנשי צוות בשעה ${minutesToTime(slot.start)} מעל המקסימום ${maxDailyStaff}` });
        if (leaderRequiredAt(settings, date, slot.start)) {
          const hasLeader = classShifts.some((shift) => ['teacher', 'lead'].includes(shift.shift_role) && timeToMinutes(shift.start_time) <= slot.start && timeToMinutes(shift.end_time) >= slot.end);
          if (!hasLeader) errors.push({ code: 'missing_leader', date, class_id: classItem.id, time: minutesToTime(slot.start), end_time: minutesToTime(slot.end), message: `${classItem.name}: חסר גננת/גנן או מוביל/ה בשעה ${minutesToTime(slot.start)}` });
        }
      }
    }
  }

  for (const employee of activeEmployees) {
    const employeeShifts=shifts.filter((shift)=>shift.employee_id===employee.id);
    const weeklyMinutes = calculateWeeklyMinutes(shifts, employee.id);
    const workDays=new Set(employeeShifts.map((shift)=>shift.shift_date));
    const dayLimit=Number(employee.max_work_days_per_week);
    if(Number.isInteger(dayLimit)&&dayLimit>0&&workDays.size>dayLimit){
      const hasOverride=employeeShifts.some((shift)=>shift.rule_override);
      const item={code:'max_weekly_days',employee_id:employee.id,message:`${employee.full_name}: שובץ ${workDays.size} ימים ועבר את המקסימום השבועי ${dayLimit}`};
      (hasOverride?warnings:errors).push(item);
    }
    const maximumValue = Number(employee.max_weekly_hours);
    const maximum = Number.isFinite(maximumValue) && maximumValue > 0 ? maximumValue * 60 : null;
    if (maximum != null && weeklyMinutes > maximum) {
      const actual = Math.round(weeklyMinutes / 6) / 10;
      const maxHours = Math.round(maximum / 6) / 10;
      const hasOverride=shifts.some((shift)=>shift.employee_id===employee.id&&shift.rule_override); const item={ code: 'max_weekly_hours', employee_id: employee.id, message: `${employee.full_name}: שובץ ${actual} שעות ועבר את המקסימום השבועי ${maxHours}` }; (hasOverride?warnings:errors).push(item);
    }
    const targetValue = Number(employee.weekly_hours);
    const target = Number.isFinite(targetValue) && targetValue > 0 ? targetValue * 60 : null;
    if (target != null && Math.abs(weeklyMinutes - target) >= 120) {
      const delta = Math.round((weeklyMinutes - target) / 60 * 10) / 10;
      warnings.push({ code: 'weekly_hours', employee_id: employee.id, message: `${employee.full_name}: ${delta > 0 ? 'חריגה של' : 'חסרות'} ${Math.abs(delta)} שעות ביחס להיקף השבועי` });
    }
  }

  return { errors: collapseCoverageIssues(errors, activeClasses), warnings: dedupeIssues(warnings) };
}

function collapseCoverageIssues(items, classes) {
  const coverageCodes = ['understaffed', 'missing_leader', 'max_daily_staff'];
  const regular = items.filter((item) => !coverageCodes.includes(item.code));
  const buckets = new Map();
  for (const item of items.filter((row) => coverageCodes.includes(row.code))) {
    const key = `${item.code}|${item.date}|${item.class_id}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  const compact = [];
  for (const rows of buckets.values()) {
    rows.sort((a,b)=>timeToMinutes(a.time)-timeToMinutes(b.time));
    const ranges=[];
    for (const row of rows) {
      const current=ranges[ranges.length-1];
      if (current && current[current.length-1].end_time === row.time) current.push(row);
      else ranges.push([row]);
    }
    for (const range of ranges) {
      const first=range[0], last=range[range.length-1];
      const className=classes.find((row)=>row.id===first.class_id)?.name || 'כיתה';
      if (first.code === 'understaffed') {
        const minCount=Math.min(...range.map((row)=>Number(row.count||0)));
        const maxExpected=Math.max(...range.map((row)=>Number(row.expected||0)));
        compact.push({ code:first.code,date:first.date,class_id:first.class_id,time:first.time,end_time:last.end_time||last.time,message:`${className}: חוסר בכוח אדם ${first.time}–${last.end_time||last.time} (מינימום ${minCount} מתוך ${maxExpected})` });
      } else if (first.code === 'max_daily_staff') {
        const maxCount=Math.max(...range.map((row)=>Number(row.count||0)));
        const limit=Math.min(...range.map((row)=>Number(row.expected||0)));
        compact.push({ code:first.code,date:first.date,class_id:first.class_id,time:first.time,end_time:last.end_time||last.time,message:`${className}: חריגה ממקסימום התקינה ${first.time}–${last.end_time||last.time} (${maxCount} מעל מקסימום ${limit})` });
      } else compact.push({ code:first.code,date:first.date,class_id:first.class_id,time:first.time,end_time:last.end_time||last.time,message:`${className}: חסר גנן/ת או מוביל/ה ${first.time}–${last.end_time||last.time}` });
    }
  }
  return dedupeIssues([...regular, ...compact]);
}

function dedupeIssues(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = [item.code, item.date, item.class_id, item.employee_id, item.time, item.message].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { timeToMinutes, minutesToTime, overlaps, dateRange, weekdayOf, closingTimeForDate, requiredStaffAt, leaderRequiredAt, coverageSlots, calculateWeeklyMinutes, validateWeek, buildScheduleAvailability };
