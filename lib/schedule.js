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

function weekdayOf(dateString) {
  return new Date(`${dateString}T12:00:00Z`).getUTCDay();
}

function closingTimeForDate(settings, dateString) {
  return weekdayOf(dateString) === 5
    ? String(settings.friday_closing_time || '12:00').slice(0, 5)
    : String(settings.closing_time || '15:30').slice(0, 5);
}

function calculateWeeklyMinutes(shifts, employeeId) {
  return shifts
    .filter((shift) => shift.employee_id === employeeId)
    .reduce((sum, shift) => sum + Math.max(0, timeToMinutes(shift.end_time) - timeToMinutes(shift.start_time)), 0);
}

function validateWeek({ shifts, classes, employees, settings, weekStart, constraints = [], weeklyPatterns = [] }) {
  const errors = [];
  const warnings = [];
  const opening = timeToMinutes(settings.opening_time || '07:30');
  const required = Number(settings.required_staff || 4);
  const closingRequired = Number(settings.closing_required_staff || 3);
  const closingWindow = Number(settings.closing_window_minutes || 30);
  const slotMinutes = Number(settings.validation_slot_minutes || 30);
  const requireLeader = settings.require_leader !== false;
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
    const forbidden = constraints.find((item) => item.employee_id === shift.employee_id && item.class_id === shift.class_id && item.constraint_type === 'forbidden' && (!item.valid_from || item.valid_from <= shift.shift_date) && (!item.valid_to || item.valid_to >= shift.shift_date));
    if (forbidden) errors.push({ code: 'forbidden_class', date: shift.shift_date, employee_id: shift.employee_id, class_id: shift.class_id, message: `לא ניתן לשבץ את ${employee?.full_name || 'העובד'} בכיתת ${classItem?.name || ''}` });

    const weekday = weekdayOf(shift.shift_date);
    const pattern = (patternsByEmployee.get(shift.employee_id) || []).find((row) => Number(row.weekday) === weekday);
    if (pattern?.day_type === 'day_off') {
      errors.push({ code: 'fixed_day_off', date: shift.shift_date, employee_id: shift.employee_id, class_id: shift.class_id, message: `${employee?.full_name || 'העובד'} משובץ ביום חופשי קבוע` });
    } else if (pattern?.day_type === 'work' && (timeToMinutes(shift.start_time) < timeToMinutes(pattern.start_time) || timeToMinutes(shift.end_time) > timeToMinutes(pattern.end_time))) {
      warnings.push({ code: 'outside_fixed_hours', date: shift.shift_date, employee_id: shift.employee_id, class_id: shift.class_id, message: `${employee?.full_name || 'העובד'} שובץ מחוץ לשעות הקבועות ${String(pattern.start_time).slice(0,5)}–${String(pattern.end_time).slice(0,5)}` });
    }
  }

  for (const date of dates) {
    const closing = timeToMinutes(closingTimeForDate(settings, date));
    for (const classItem of activeClasses) {
      const classShifts = shifts.filter((shift) => shift.shift_date === date && shift.class_id === classItem.id);
      for (let slot = opening; slot < closing; slot += slotMinutes) {
        const slotEnd = Math.min(slot + slotMinutes, closing);
        const people = new Set(classShifts.filter((shift) => overlaps(shift.start_time, shift.end_time, minutesToTime(slot), minutesToTime(slotEnd))).map((shift) => shift.employee_id));
        const expected = slot >= closing - closingWindow ? closingRequired : required;
        if (people.size < expected) errors.push({ code: 'understaffed', date, class_id: classItem.id, time: minutesToTime(slot), count: people.size, expected, end_time: minutesToTime(slotEnd), message: `${classItem.name}: ${people.size} אנשי צוות בשעה ${minutesToTime(slot)} במקום ${expected}` });
        if (requireLeader) {
          const hasLeader = classShifts.some((shift) => ['teacher', 'lead'].includes(shift.shift_role) && overlaps(shift.start_time, shift.end_time, minutesToTime(slot), minutesToTime(slotEnd)));
          if (!hasLeader) errors.push({ code: 'missing_leader', date, class_id: classItem.id, time: minutesToTime(slot), end_time: minutesToTime(slotEnd), message: `${classItem.name}: חסר גננת/גנן או מוביל/ה בשעה ${minutesToTime(slot)}` });
        }
      }
    }
  }

  for (const employee of activeEmployees) {
    const weeklyMinutes = calculateWeeklyMinutes(shifts, employee.id);
    const maximum = employee.max_weekly_hours == null ? null : Number(employee.max_weekly_hours) * 60;
    if (maximum != null && weeklyMinutes > maximum) {
      const actual = Math.round(weeklyMinutes / 6) / 10;
      const maxHours = Math.round(maximum / 6) / 10;
      errors.push({ code: 'max_weekly_hours', employee_id: employee.id, message: `${employee.full_name}: שובץ ${actual} שעות ועבר את המקסימום השבועי ${maxHours}` });
    }
    const target = employee.weekly_hours == null ? null : Number(employee.weekly_hours) * 60;
    if (target != null && Math.abs(weeklyMinutes - target) >= 120) {
      const delta = Math.round((weeklyMinutes - target) / 60 * 10) / 10;
      warnings.push({ code: 'weekly_hours', employee_id: employee.id, message: `${employee.full_name}: ${delta > 0 ? 'חריגה של' : 'חסרות'} ${Math.abs(delta)} שעות ביחס להיקף השבועי` });
    }
  }

  return { errors: collapseCoverageIssues(errors, activeClasses), warnings: dedupeIssues(warnings) };
}

function collapseCoverageIssues(items, classes) {
  const regular = items.filter((item) => !['understaffed', 'missing_leader'].includes(item.code));
  const grouped = new Map();
  for (const item of items.filter((row) => ['understaffed', 'missing_leader'].includes(row.code))) {
    const key = `${item.code}|${item.date}|${item.class_id}`;
    if (!grouped.has(key)) grouped.set(key, { code: item.code, date: item.date, class_id: item.class_id, rows: [] });
    grouped.get(key).rows.push(item);
  }
  const compact = [...grouped.values()].map((group) => {
    const className = classes.find((row) => row.id === group.class_id)?.name || 'כיתה';
    const first = group.rows[0]; const last = group.rows[group.rows.length - 1];
    if (group.code === 'understaffed') {
      const minCount = Math.min(...group.rows.map((row) => Number(row.count || 0)));
      const maxExpected = Math.max(...group.rows.map((row) => Number(row.expected || 0)));
      return { code: group.code, date: group.date, class_id: group.class_id, time: first.time, end_time: last.end_time || last.time, message: `${className}: חוסר בכוח אדם ${first.time}–${last.end_time || last.time} (מינימום ${minCount} מתוך ${maxExpected})` };
    }
    return { code: group.code, date: group.date, class_id: group.class_id, time: first.time, end_time: last.end_time || last.time, message: `${className}: חסר גנן/ת או מוביל/ה ${first.time}–${last.end_time || last.time}` };
  });
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

module.exports = { timeToMinutes, minutesToTime, overlaps, dateRange, weekdayOf, closingTimeForDate, calculateWeeklyMinutes, validateWeek };
