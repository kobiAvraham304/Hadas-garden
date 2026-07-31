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

function calculateWeeklyMinutes(shifts, employeeId) {
  return shifts
    .filter((shift) => shift.employee_id === employeeId)
    .reduce((sum, shift) => sum + Math.max(0, timeToMinutes(shift.end_time) - timeToMinutes(shift.start_time)), 0);
}

function validateWeek({ shifts, classes, employees, settings, weekStart, constraints = [] }) {
  const errors = [];
  const warnings = [];
  const opening = timeToMinutes(settings.opening_time || '07:30');
  const closing = timeToMinutes(settings.closing_time || '15:30');
  const required = Number(settings.required_staff || 4);
  const closingRequired = Number(settings.closing_required_staff || 3);
  const closingWindow = Number(settings.closing_window_minutes || 30);
  const slotMinutes = Number(settings.validation_slot_minutes || 30);
  const dates = dateRange(weekStart, 6);
  const activeClasses = classes.filter((item) => item.active !== false);
  const activeEmployees = employees.filter((item) => item.active !== false);

  for (const employee of activeEmployees) {
    const employeeShifts = shifts.filter((shift) => shift.employee_id === employee.id);
    for (let i = 0; i < employeeShifts.length; i++) {
      for (let j = i + 1; j < employeeShifts.length; j++) {
        const first = employeeShifts[i];
        const second = employeeShifts[j];
        if (first.shift_date === second.shift_date && overlaps(first.start_time, first.end_time, second.start_time, second.end_time)) {
          errors.push({
            code: 'overlap',
            date: first.shift_date,
            employee_id: employee.id,
            message: `${employee.full_name} משובצת בשעות חופפות`,
          });
        }
      }
    }
  }

  for (const shift of shifts) {
    const forbidden = constraints.find((item) =>
      item.employee_id === shift.employee_id
      && item.class_id === shift.class_id
      && item.constraint_type === 'forbidden'
      && (!item.valid_from || item.valid_from <= shift.shift_date)
      && (!item.valid_to || item.valid_to >= shift.shift_date)
    );
    if (forbidden) {
      const employee = activeEmployees.find((item) => item.id === shift.employee_id);
      const classItem = activeClasses.find((item) => item.id === shift.class_id);
      errors.push({
        code: 'forbidden_class',
        date: shift.shift_date,
        employee_id: shift.employee_id,
        class_id: shift.class_id,
        message: `${employee?.full_name || 'עובדת'} אינה יכולה להשתבץ בכיתת ${classItem?.name || ''}`,
      });
    }
  }

  for (const date of dates) {
    for (const classItem of activeClasses) {
      const classShifts = shifts.filter((shift) => shift.shift_date === date && shift.class_id === classItem.id);
      for (let slot = opening; slot < closing; slot += slotMinutes) {
        const slotEnd = Math.min(slot + slotMinutes, closing);
        const people = new Set(classShifts.filter((shift) => overlaps(shift.start_time, shift.end_time, minutesToTime(slot), minutesToTime(slotEnd))).map((shift) => shift.employee_id));
        const expected = slot >= closing - closingWindow ? closingRequired : required;
        if (people.size < expected) {
          errors.push({
            code: 'understaffed',
            date,
            class_id: classItem.id,
            time: minutesToTime(slot),
            message: `${classItem.name}: ${people.size} נשות צוות בשעה ${minutesToTime(slot)} במקום ${expected}`,
          });
        }
        const hasLeader = classShifts.some((shift) =>
          ['teacher', 'lead'].includes(shift.shift_role)
          && overlaps(shift.start_time, shift.end_time, minutesToTime(slot), minutesToTime(slotEnd))
        );
        if (!hasLeader) {
          errors.push({
            code: 'missing_leader',
            date,
            class_id: classItem.id,
            time: minutesToTime(slot),
            message: `${classItem.name}: חסרה גננת או מובילה בשעה ${minutesToTime(slot)}`,
          });
        }
      }
    }
  }

  for (const employee of activeEmployees) {
    const weeklyMinutes = calculateWeeklyMinutes(shifts, employee.id);
    const target = employee.weekly_hours == null ? null : Number(employee.weekly_hours) * 60;
    if (target != null && Math.abs(weeklyMinutes - target) >= 120) {
      const delta = Math.round((weeklyMinutes - target) / 60 * 10) / 10;
      warnings.push({
        code: 'weekly_hours',
        employee_id: employee.id,
        message: `${employee.full_name}: ${delta > 0 ? 'חריגה של' : 'חסרות'} ${Math.abs(delta)} שעות ביחס להיקף השבועי`,
      });
    }
  }

  return {
    errors: dedupeIssues(errors),
    warnings: dedupeIssues(warnings),
  };
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

module.exports = {
  timeToMinutes,
  minutesToTime,
  overlaps,
  dateRange,
  calculateWeeklyMinutes,
  validateWeek,
};
