const crypto = require('crypto');
const {
  timeToMinutes, minutesToTime, overlaps, dateRange, weekdayOf,
  closingTimeForDate, requiredStaffAt, calculateWeeklyMinutes, validateWeek,
} = require('./schedule');

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function shortTime(value, fallback = '') { return value ? String(value).slice(0, 5) : fallback; }
function addDays(dateString, days) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function roleForEmployee(employee) {
  const title = String(employee?.job_title || '');
  if (/(גננת|גנן)/.test(title)) return 'teacher';
  if (title === 'סייעת מובילה' || employee?.can_lead) return 'lead';
  return 'staff';
}
function canLead(employee) { return ['teacher', 'lead'].includes(roleForEmployee(employee)); }
function activeConstraint(constraints, employeeId, classId, date) {
  return constraints.find((row) => row.employee_id === employeeId && row.class_id === classId
    && (!row.valid_from || row.valid_from <= date) && (!row.valid_to || row.valid_to >= date));
}
function absentOn(requests, employeeId, date) {
  return requests.some((row) => row.requester_id === employeeId
    && ['approved', 'applied'].includes(row.status)
    && ['leave', 'day_off', 'sick'].includes(row.request_type)
    && row.request_date <= date && date <= String(row.request_end_date || row.request_date));
}
function patternFor(patterns, employeeId, weekday) {
  return patterns.find((row) => row.employee_id === employeeId && Number(row.weekday) === Number(weekday));
}
function employeeAvailability({ employee, date, patterns, requests, settings }) {
  if (!employee?.active || employee.is_schedulable === false || employee.assignment_mode === 'no_schedule') return null;
  if (employee.started_at && employee.started_at > date) return null;
  if (employee.ended_at && employee.ended_at < date) return null;
  if (absentOn(requests, employee.id, date)) return null;
  const weekday = weekdayOf(date);
  const pattern = patternFor(patterns, employee.id, weekday);
  if (!pattern) return null;
  if (pattern?.day_type === 'day_off' || (!pattern && employee.fixed_day_off != null && Number(employee.fixed_day_off) === weekday)) return null;
  const open = shortTime(settings.opening_time, '07:30');
  const close = closingTimeForDate(settings, date);
  let start = shortTime(employee.default_start, open);
  let end = shortTime(employee.default_end, close);
  let source = 'default';
  let asNeeded = false;
  let confidence = 0;
  if (pattern?.day_type === 'work') {
    start = shortTime(pattern.start_time, start);
    end = shortTime(pattern.end_time, end);
    source = 'pattern';
    confidence = 30;
  } else if (pattern?.day_type === 'as_needed' || pattern?.day_type === 'avoid') {
    source = 'as_needed';
    asNeeded = true;
    confidence = -38;
  } else {
    return null;
  }
  const startMin = Math.max(timeToMinutes(start), timeToMinutes(open));
  const endMin = Math.min(timeToMinutes(end), timeToMinutes(close));
  if (endMin <= startMin) return null;
  return { start: minutesToTime(startMin), end: minutesToTime(endMin), source, asNeeded, confidence };
}
function employeeBaseScore({ employee, classItem, date, constraints, availability, previousShifts }) {
  if (employee.job_title === 'גננת' && employee.primary_class_id && employee.primary_class_id !== classItem.id) {
    return { eligible:false, score:-Infinity, reasons:['גננת ניתנת לשיבוץ רק בכיתה הקבועה שלה'] };
  }
  const constraint = activeConstraint(constraints, employee.id, classItem.id, date);
  if (constraint?.constraint_type === 'forbidden') return { eligible: false, score: -Infinity, reasons: ['לא ניתן לשבץ בכיתה זו'] };
  let score = 25 + Number(availability.confidence || 0);
  const reasons = [];
  if (employee.primary_class_id === classItem.id) { score += 48; reasons.push('הכיתה הקבועה'); }
  else if (employee.assignment_mode === 'substitute') { score += 34; reasons.push('משלימ/ת מקום'); }
  else if (employee.assignment_mode === 'rotation') { score += 26; reasons.push('רוטציה בין כיתות'); }
  else if (employee.assignment_mode === 'fixed' && employee.primary_class_id && employee.primary_class_id !== classItem.id) { score -= 24; reasons.push('משויך/ת בדרך כלל לכיתה אחרת'); }
  if (constraint?.constraint_type === 'preferred') { score += 35; reasons.push('העדפה מפורשת לכיתה'); }
  if (constraint?.constraint_type === 'avoid') { score -= 35; reasons.push('עדיף להימנע מהכיתה'); }
  if (availability.source === 'pattern') reasons.push('תואם ליום ולשעות הקבועים');
  if (availability.asNeeded) { score -= 42; reasons.push('לפי צורך בלבד — עדיפות נמוכה'); }
  const previous = previousShifts.find((row) => row.employee_id === employee.id && row.class_id === classItem.id && weekdayOf(row.shift_date) === weekdayOf(date));
  if (previous) { score += 12; reasons.push('המשכיות מהשבוע הקודם'); }
  return { eligible: true, score, reasons };
}
function slotKeys(settings, date) {
  const opening = timeToMinutes(settings.opening_time || '07:30');
  const closing = timeToMinutes(closingTimeForDate(settings, date));
  const interval = Math.max(15, Number(settings.validation_slot_minutes || 30));
  const keys = [];
  for (let minute = opening; minute < closing; minute += interval) keys.push({ start: minute, end: Math.min(closing, minute + interval) });
  return keys;
}
function requiredAt(settings, date, minute) {
  return requiredStaffAt(settings, date, minute);
}

function ownFixedClassNeedsEmployee({ employee, availability, date, allRows, settings, classes }) {
  if (employee.assignment_mode !== 'fixed' || !employee.primary_class_id) return false;
  const ownClass = classes.find((item)=>item.id===employee.primary_class_id && item.active !== false);
  if (!ownClass) return false;
  const ownRows = allRows.filter((row)=>row.shift_date===date && row.class_id===ownClass.id);
  for (const slot of slotKeys(settings,date)) {
    if (!covers(availability,slot)) continue;
    const count = new Set(ownRows.filter((row)=>shiftCovers(row,slot)).map((row)=>row.employee_id)).size;
    if (count < requiredAt(settings,date,slot.start)) return true;
    if (settings.require_leader !== false && canLead(employee)) {
      const hasLeader = ownRows.some((row)=>['teacher','lead'].includes(row.shift_role) && shiftCovers(row,slot));
      if (!hasLeader) return true;
    }
  }
  return false;
}
function covers(availability, slot) {
  return timeToMinutes(availability.start) <= slot.start && timeToMinutes(availability.end) >= slot.end;
}
function shiftCovers(shift, slot) { return timeToMinutes(shift.start_time) <= slot.start && timeToMinutes(shift.end_time) >= slot.end; }
function assignedMinutes(shifts, employeeId) { return calculateWeeklyMinutes(shifts, employeeId); }
function maxMinutes(employee) { return employee.max_weekly_hours == null ? Infinity : Number(employee.max_weekly_hours) * 60; }
function targetMinutes(employee) { return employee.weekly_hours == null ? null : Number(employee.weekly_hours) * 60; }
function scoreTo100(raw) { return clamp(Math.round((raw + 10) * 100 / 175), 1, 100); }
function stableSortCandidates(items) {
  return [...items].sort((a, b) => b.utility - a.utility || b.baseScore - a.baseScore || String(a.employee.full_name).localeCompare(String(b.employee.full_name), 'he'));
}
function shiftSignature(rows) {
  const stable = [...rows].map((row) => ({
    shift_date: row.shift_date, class_id: row.class_id, employee_id: row.employee_id,
    start_time: shortTime(row.start_time), end_time: shortTime(row.end_time), shift_role: row.shift_role,
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 24);
}

function generateAutomaticSchedule(input) {
  const {
    weekStart, employees = [], classes = [], patterns = [], constraints = [], requests = [],
    settings = {}, existingShifts = [], previousShifts = [], mode = 'rebuild', createdBy = null,
  } = input;
  const dates = dateRange(weekStart, 6);
  const activeClasses = classes.filter((row) => row.active !== false);
  const activeEmployees = employees.filter((row) => row.active !== false && row.is_schedulable !== false && row.assignment_mode !== 'no_schedule');
  const kept = mode === 'fill' ? existingShifts.map((row) => ({ ...row })) : [];
  const generated = [];
  const allRows = [...kept];
  const assignmentByEmployeeDay = new Map();
  const weeklyMinutes = new Map(activeEmployees.map((employee) => [employee.id, assignedMinutes(kept, employee.id)]));
  const daySummaries = [];
  const excluded = [];

  for (const row of kept) assignmentByEmployeeDay.set(`${row.employee_id}|${row.shift_date}`, true);

  for (const date of dates) {
    const slots = slotKeys(settings, date);
    const dayInfo = { date, classes: [], unavailable: 0 };
    const availabilityRows = [];
    for (const employee of activeEmployees) {
      const availability = employeeAvailability({ employee, date, patterns, requests, settings });
      if (!availability) { dayInfo.unavailable += 1; continue; }
      availabilityRows.push({ employee, availability });
    }

    // Reserve the core fixed-class team before borrowing workers between classrooms.
    // This prevents an early classroom in the loop from taking a worker whose own classroom still needs them.
    const reservedClassByEmployee = new Map();
    for (const reserveClass of activeClasses) {
      const reserveSlots = slotKeys(settings, date);
      const existingClassRows = allRows.filter((row) => row.shift_date === date && row.class_id === reserveClass.id);
      const peakMissing = Math.max(0, ...reserveSlots.map((slot) => {
        const existingCount = new Set(existingClassRows.filter((row) => shiftCovers(row, slot)).map((row) => row.employee_id)).size;
        return requiredAt(settings, date, slot.start) - existingCount;
      }));
      if (!peakMissing) continue;
      const ownCandidates = availabilityRows.filter(({ employee, availability }) => {
        if (employee.assignment_mode !== 'fixed' || employee.primary_class_id !== reserveClass.id) return false;
        if (assignmentByEmployeeDay.has(`${employee.id}|${date}`)) return false;
        const duration = timeToMinutes(availability.end) - timeToMinutes(availability.start);
        return (weeklyMinutes.get(employee.id) || 0) + duration <= maxMinutes(employee);
      }).map(({ employee, availability }) => {
        const base = employeeBaseScore({ employee, classItem: reserveClass, date, constraints, availability, previousShifts });
        return { employee, availability, base, leader: canLead(employee), duration: timeToMinutes(availability.end) - timeToMinutes(availability.start) };
      }).filter((item) => item.base.eligible)
        .sort((a, b) => Number(b.leader) - Number(a.leader) || b.base.score - a.base.score || b.duration - a.duration || String(a.employee.full_name).localeCompare(String(b.employee.full_name), 'he'));
      for (const item of ownCandidates.slice(0, peakMissing)) reservedClassByEmployee.set(item.employee.id, reserveClass.id);
    }

    for (const classItem of activeClasses) {
      const classRows = allRows.filter((row) => row.shift_date === date && row.class_id === classItem.id);
      const coverage = slots.map((slot) => ({
        ...slot,
        required: requiredAt(settings, date, slot.start),
        count: new Set(classRows.filter((row) => shiftCovers(row, slot)).map((row) => row.employee_id)).size,
        leader: classRows.some((row) => ['teacher', 'lead'].includes(row.shift_role) && shiftCovers(row, slot)),
      }));
      const classSummary = { class_id: classItem.id, class_name: classItem.name, added: 0, unresolved: 0, leader_missing: 0 };

      // First, ensure leader coverage. A candidate must cover at least one missing leader slot and be legally eligible.
      while (settings.require_leader !== false && coverage.some((slot) => !slot.leader)) {
        const missing = coverage.filter((slot) => !slot.leader);
        const options = availabilityRows.filter(({ employee, availability }) => {
          if (!canLead(employee)) return false;
          if (assignmentByEmployeeDay.has(`${employee.id}|${date}`)) return false;
          const reservedClass = reservedClassByEmployee.get(employee.id);
          if (reservedClass && reservedClass !== classItem.id) return false;
          if (employee.assignment_mode === 'fixed' && employee.primary_class_id && employee.primary_class_id !== classItem.id
              && ownFixedClassNeedsEmployee({ employee, availability, date, allRows, settings, classes:activeClasses })) return false;
          if (!missing.some((slot) => covers(availability, slot))) return false;
          const duration = timeToMinutes(availability.end) - timeToMinutes(availability.start);
          return (weeklyMinutes.get(employee.id) || 0) + duration <= maxMinutes(employee);
        }).map(({ employee, availability }) => {
          const base = employeeBaseScore({ employee, classItem, date, constraints, availability, previousShifts });
          if (!base.eligible) return null;
          if (employee.assignment_mode === 'fixed' && employee.primary_class_id && employee.primary_class_id !== classItem.id) {
            const ownName = activeClasses.find((row)=>row.id===employee.primary_class_id)?.name || 'הכיתה הקבועה';
            base.reasons.push(`הכיתה ${ownName} כבר מכוסה; נדרש חיזוק ב${classItem.name}`);
          }
          const coveredMissing = missing.filter((slot) => covers(availability, slot)).length;
          const duration = timeToMinutes(availability.end) - timeToMinutes(availability.start);
          const target = targetMinutes(employee);
          const fairness = target == null ? 0 : clamp(Math.round((target - (weeklyMinutes.get(employee.id) || 0)) / 60), -12, 18);
          return { employee, availability, baseScore: base.score, reasons: base.reasons, utility: base.score + coveredMissing * 18 + fairness - duration / 240 };
        }).filter(Boolean);
        const chosen = stableSortCandidates(options)[0];
        if (!chosen) break;
        const shift = {
          shift_date: date, class_id: classItem.id, employee_id: chosen.employee.id,
          start_time: chosen.availability.start, end_time: chosen.availability.end,
          shift_role: roleForEmployee(chosen.employee), status: 'draft', public_note: null, created_by: createdBy,
          _score: scoreTo100(chosen.baseScore), _reasons: chosen.reasons,
          _note: chosen.employee.assignment_mode === 'fixed' && chosen.employee.primary_class_id && chosen.employee.primary_class_id !== classItem.id
            ? `שובץ/ה מחוץ לכיתה הקבועה כי הכיתה הקבועה כבר מכוסה וב${classItem.name} נשאר חוסר.`
            : null,
        };
        generated.push(shift); allRows.push(shift); classRows.push(shift);
        assignmentByEmployeeDay.set(`${chosen.employee.id}|${date}`, true);
        weeklyMinutes.set(chosen.employee.id, (weeklyMinutes.get(chosen.employee.id) || 0) + timeToMinutes(shift.end_time) - timeToMinutes(shift.start_time));
        for (const slot of coverage) if (shiftCovers(shift, slot)) { slot.count += 1; slot.leader = true; }
        classSummary.added += 1;
      }

      // Then fill staffing deficits. Pick the employee that resolves the most weighted missing slots.
      while (coverage.some((slot) => slot.count < slot.required)) {
        const missing = coverage.filter((slot) => slot.count < slot.required);
        const options = availabilityRows.filter(({ employee, availability }) => {
          if (assignmentByEmployeeDay.has(`${employee.id}|${date}`)) return false;
          const reservedClass = reservedClassByEmployee.get(employee.id);
          if (reservedClass && reservedClass !== classItem.id) return false;
          if (employee.assignment_mode === 'fixed' && employee.primary_class_id && employee.primary_class_id !== classItem.id
              && ownFixedClassNeedsEmployee({ employee, availability, date, allRows, settings, classes:activeClasses })) return false;
          if (!missing.some((slot) => covers(availability, slot))) return false;
          const duration = timeToMinutes(availability.end) - timeToMinutes(availability.start);
          return (weeklyMinutes.get(employee.id) || 0) + duration <= maxMinutes(employee);
        }).map(({ employee, availability }) => {
          const base = employeeBaseScore({ employee, classItem, date, constraints, availability, previousShifts });
          if (!base.eligible) return null;
          if (employee.assignment_mode === 'fixed' && employee.primary_class_id && employee.primary_class_id !== classItem.id) {
            const ownName = activeClasses.find((row)=>row.id===employee.primary_class_id)?.name || 'הכיתה הקבועה';
            base.reasons.push(`הכיתה ${ownName} כבר מכוסה; נדרש חיזוק ב${classItem.name}`);
          }
          const resolvedUnits = missing.reduce((sum, slot) => sum + (covers(availability, slot) ? Math.max(1, slot.required - slot.count) : 0), 0);
          const closing = timeToMinutes(closingTimeForDate(settings, date));
          const closingStart = closing - Number(settings.closing_window_minutes || 30);
          const closingUnits = missing.filter((slot) => slot.start >= closingStart && covers(availability, slot)).length;
          const duration = timeToMinutes(availability.end) - timeToMinutes(availability.start);
          const target = targetMinutes(employee);
          const fairness = target == null ? 0 : clamp(Math.round((target - (weeklyMinutes.get(employee.id) || 0)) / 60), -12, 18);
          const leaderBonus = settings.require_leader !== false && missing.some((slot) => !slot.leader && covers(availability, slot)) && canLead(employee) ? 30 : 0;
          return { employee, availability, baseScore: base.score, reasons: base.reasons, utility: base.score + resolvedUnits * 14 + closingUnits * 8 + fairness + leaderBonus - duration / 300 };
        }).filter(Boolean);
        const chosen = stableSortCandidates(options)[0];
        if (!chosen) break;
        const shift = {
          shift_date: date, class_id: classItem.id, employee_id: chosen.employee.id,
          start_time: chosen.availability.start, end_time: chosen.availability.end,
          shift_role: roleForEmployee(chosen.employee), status: 'draft', public_note: null, created_by: createdBy,
          _score: scoreTo100(chosen.baseScore), _reasons: chosen.reasons,
          _note: chosen.employee.assignment_mode === 'fixed' && chosen.employee.primary_class_id && chosen.employee.primary_class_id !== classItem.id
            ? `שובץ/ה מחוץ לכיתה הקבועה כי הכיתה הקבועה כבר מכוסה וב${classItem.name} נשאר חוסר.`
            : null,
        };
        generated.push(shift); allRows.push(shift); classRows.push(shift);
        assignmentByEmployeeDay.set(`${chosen.employee.id}|${date}`, true);
        weeklyMinutes.set(chosen.employee.id, (weeklyMinutes.get(chosen.employee.id) || 0) + timeToMinutes(shift.end_time) - timeToMinutes(shift.start_time));
        for (const slot of coverage) if (shiftCovers(shift, slot)) { slot.count += 1; if (['teacher', 'lead'].includes(shift.shift_role)) slot.leader = true; }
        classSummary.added += 1;
      }

      classSummary.unresolved = coverage.filter((slot) => slot.count < slot.required).length;
      classSummary.leader_missing = coverage.filter((slot) => settings.require_leader !== false && !slot.leader).length;
      dayInfo.classes.push(classSummary);
    }
    daySummaries.push(dayInfo);
  }

  const assignmentNotes = generated.filter((row)=>row._note).map((row)=>({
    shift_date:row.shift_date,class_id:row.class_id,employee_id:row.employee_id,note:row._note,
  }));
  const cleanGenerated = generated.map(({ _score, _reasons, _note, ...row }) => row);
  const finalRows = [...kept, ...cleanGenerated];
  const validation = validateWeek({ shifts: finalRows, classes, employees, settings, constraints, weeklyPatterns: patterns, weekStart });
  const allSlots = dates.flatMap((date) => activeClasses.flatMap((classItem) => slotKeys(settings, date).map((slot) => ({ date, classItem, slot }))));
  const requiredUnits = allSlots.reduce((sum, item) => sum + requiredAt(settings, item.date, item.slot.start), 0);
  const coveredUnits = allSlots.reduce((sum, item) => {
    const count = new Set(finalRows.filter((row) => row.shift_date === item.date && row.class_id === item.classItem.id && shiftCovers(row, item.slot)).map((row) => row.employee_id)).size;
    return sum + Math.min(requiredAt(settings, item.date, item.slot.start), count);
  }, 0);
  const leaderSlots = allSlots.length;
  const coveredLeaderSlots = allSlots.filter((item) => finalRows.some((row) => row.shift_date === item.date && row.class_id === item.classItem.id && ['teacher', 'lead'].includes(row.shift_role) && shiftCovers(row, item.slot))).length;
  const scores = generated.map((row) => row._score || 50);
  const preferenceScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 100;
  const coveragePercent = requiredUnits ? Math.round(coveredUnits * 100 / requiredUnits) : 100;
  const leaderPercent = leaderSlots ? Math.round(coveredLeaderSlots * 100 / leaderSlots) : 100;
  const quality = clamp(Math.round(coveragePercent * .6 + leaderPercent * .22 + preferenceScore * .18 - validation.errors.length * 2), 1, 100);
  const employeeHours = activeEmployees.map((employee) => ({
    employee_id: employee.id, full_name: employee.full_name,
    hours: Math.round((weeklyMinutes.get(employee.id) || 0) / 6) / 10,
    target: employee.weekly_hours == null ? null : Number(employee.weekly_hours),
    maximum: employee.max_weekly_hours == null ? null : Number(employee.max_weekly_hours),
  })).filter((row) => row.hours > 0).sort((a, b) => b.hours - a.hours || a.full_name.localeCompare(b.full_name, 'he'));

  return {
    weekStart, mode, keptCount: kept.length, generated: cleanGenerated, finalRows,
    validation, daySummaries, employeeHours, excluded, assignmentNotes,
    metrics: { quality, coveragePercent, leaderPercent, preferenceScore: Math.round(preferenceScore), generatedCount: cleanGenerated.length, unresolvedErrors: validation.errors.length, warnings: validation.warnings.length },
    signature: shiftSignature(finalRows),
  };
}

module.exports = {
  generateAutomaticSchedule, employeeAvailability, employeeBaseScore, roleForEmployee,
  scoreTo100, shiftSignature, activeConstraint, absentOn,
};
