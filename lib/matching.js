const { overlaps, timeToMinutes, minutesToTime, calculateWeeklyMinutes, closingTimeForDate, requiredStaffAt, leaderRequiredAt, coverageSlots } = require('./schedule');

function short(value) { return value ? String(value).slice(0, 5) : null; }
function dayOf(dateString) { return new Date(`${dateString}T12:00:00Z`).getUTCDay(); }
function normalizeScore(value, min = 1, max = 100) { return Math.max(min, Math.min(max, Math.round(Number(value) || 0))); }
function recommendationLevel(score) { return score >= 86 ? 'high' : score >= 72 ? 'good' : score >= 58 ? 'possible' : 'low'; }
function activeInRange(shift, start, end) { return overlaps(shift.start_time, shift.end_time, start, end); }
function exactRange(shift, start, end) { return short(shift?.start_time) === short(start) && short(shift?.end_time) === short(end); }

function employeeCanLead(employee) {
  return Boolean(employee?.can_lead || /(גננת|גנן|סייעת מובילה)/.test(String(employee?.job_title || '')));
}

function roleForEmployee(employee) {
  const title = String(employee?.job_title || '');
  if (/(גננת|גנן)/.test(title)) return 'teacher';
  if (title === 'סייעת מובילה' || employeeCanLead(employee)) return 'lead';
  return 'staff';
}

function activeConstraint(constraints, employeeId, classId, date) {
  return (constraints || []).find((item) => item.employee_id === employeeId && item.class_id === classId
    && (!item.valid_from || item.valid_from <= date) && (!item.valid_to || item.valid_to >= date));
}

function dayPattern(context, employeeId, date) {
  const weekday = dayOf(date);
  return (context.patterns || []).find((item) => item.employee_id === employeeId && Number(item.weekday) === weekday);
}

function requestUnavailable(context, employeeId, date) {
  return (context.requests || []).some((request) => {
    const requesterId = request.requester_id || request.employee_id;
    if (requesterId !== employeeId) return false;
    if (!['approved', 'applied'].includes(String(request.status || 'approved'))) return false;
    if (!['leave', 'day_off', 'sick'].includes(String(request.request_type || ''))) return false;
    return request.request_date <= date && date <= String(request.request_end_date || request.request_date);
  });
}

function operationAffectedRange(context, operation) {
  const shift = (context.shifts || []).find((row) => row.id === operation.shift_id);
  if (!shift) return { start: short(operation.start_time), end: short(operation.end_time) };
  if (['sick', 'absent'].includes(operation.operation_type)) return { start: short(shift.start_time), end: short(shift.end_time) };
  if (operation.operation_type === 'late') return { start: short(shift.start_time), end: short(operation.start_time || shift.end_time) };
  if (operation.operation_type === 'early_release') return { start: short(operation.end_time || shift.start_time), end: short(shift.end_time) };
  return { start: short(operation.start_time || shift.start_time), end: short(operation.end_time || shift.end_time) };
}

function unavailableReason(context, employeeId, date, start, end, ignoredOperationId = null) {
  if (requestUnavailable(context, employeeId, date)) return 'חופשה, מחלה או יום חופשי שאושרו';
  const attendance = (context.attendance || []).find((row) => row.employee_id === employeeId && row.attendance_date === date);
  if (attendance && ['absent', 'sick'].includes(attendance.status)) return attendance.status === 'sick' ? 'דווח/ה כחולה' : 'דווח/ה כנעדר/ת';

  for (const operation of context.operations || []) {
    if (operation.id === ignoredOperationId || operation.operation_date !== date) continue;
    if (operation.employee_id === employeeId) {
      const range = operationAffectedRange(context, operation);
      if (range.start && range.end && overlaps(range.start, range.end, start, end)) return 'קיים דיווח תפעולי בשעות אלו';
    }
    if (operation.status === 'resolved' && operation.replacement_employee_id === employeeId) {
      const replacementStart = short(operation.replacement_start) || operationAffectedRange(context, operation).start;
      const replacementEnd = short(operation.replacement_end) || operationAffectedRange(context, operation).end;
      if (replacementStart && replacementEnd && overlaps(replacementStart, replacementEnd, start, end)) return 'כבר משובץ/ת ככיסוי תפעולי בשעות אלו';
    }
  }
  return null;
}

function unavailableInRange(context, employeeId, date, start, end, ignoredOperationId = null) {
  return Boolean(unavailableReason(context, employeeId, date, start, end, ignoredOperationId));
}

function effectiveClassShifts(context, classId, date, start, end, excludingEmployeeId = null) {
  const rows = [];
  const excluded = new Set();

  for (const employee of context.employees || []) {
    if (employee.id === excludingEmployeeId) continue;
    if (unavailableInRange(context, employee.id, date, start, end)) excluded.add(employee.id);
  }

  for (const operation of context.operations || []) {
    if (operation.operation_date !== date || operation.status !== 'resolved') continue;
    const range = {
      start: short(operation.replacement_start) || operationAffectedRange(context, operation).start,
      end: short(operation.replacement_end) || operationAffectedRange(context, operation).end,
    };
    if (!range.start || !range.end || !overlaps(range.start, range.end, start, end)) continue;
    if (operation.replacement_type === 'transfer' && operation.replacement_from_class_id === classId) excluded.add(operation.replacement_employee_id);
  }

  for (const shift of context.shifts || []) {
    if (shift.shift_date !== date || shift.class_id !== classId || shift.employee_id === excludingEmployeeId) continue;
    if (excluded.has(shift.employee_id) || !activeInRange(shift, start, end)) continue;
    rows.push({ ...shift, source: 'schedule' });
  }

  for (const operation of context.operations || []) {
    if (operation.operation_date !== date || operation.status !== 'resolved' || operation.class_id !== classId || !operation.replacement_employee_id) continue;
    const range = {
      start: short(operation.replacement_start) || operationAffectedRange(context, operation).start,
      end: short(operation.replacement_end) || operationAffectedRange(context, operation).end,
    };
    if (!range.start || !range.end || !overlaps(range.start, range.end, start, end)) continue;
    if (rows.some((row) => row.employee_id === operation.replacement_employee_id)) continue;
    const employee = (context.employees || []).find((item) => item.id === operation.replacement_employee_id);
    rows.push({
      employee_id: operation.replacement_employee_id,
      class_id: classId,
      shift_date: date,
      start_time: range.start,
      end_time: range.end,
      shift_role: employeeCanLead(employee) ? 'lead' : 'replacement',
      source: 'operation',
    });
  }
  return rows;
}

function sourceClassCanRelease(context, sourceClassId, employeeId, date, start, end) {
  const opening = timeToMinutes(context.settings?.opening_time || '07:30');
  const closing = timeToMinutes(closingTimeForDate(context.settings || {}, date));
  const rangeStart = Math.max(opening, timeToMinutes(start));
  const rangeEnd = Math.min(closing, timeToMinutes(end));
  if (rangeEnd <= rangeStart) return false;
  const operationBoundaries = (context.operations || []).filter((row)=>row.operation_date===date).map((row)=>({
    start_time: row.replacement_start || row.start_time, end_time: row.replacement_end || row.end_time,
  }));
  const boundaryRows = [...(context.shifts || []).filter((row)=>row.shift_date===date), ...operationBoundaries, { start_time:start, end_time:end }];
  const slots = coverageSlots(context.settings || {}, date, boundaryRows).filter((slot)=>slot.start>=rangeStart && slot.end<=rangeEnd);
  for (const slot of slots) {
    const slotStart = minutesToTime(slot.start); const slotEnd = minutesToTime(slot.end);
    const remaining = effectiveClassShifts(context, sourceClassId, date, slotStart, slotEnd, employeeId);
    const count = new Set(remaining.map((row) => row.employee_id)).size;
    const expected = requiredStaffAt(context.settings || {}, date, slot.start);
    if (count < expected) return false;
    if (leaderRequiredAt(context.settings || {}, date, slot.start) && !remaining.some((row) => ['teacher', 'lead'].includes(row.shift_role))) return false;
  }
  return true;
}

function roleFits(employee, neededRole) {
  if (!['teacher', 'lead'].includes(neededRole)) return true;
  if (neededRole === 'teacher') return employeeCanLead(employee);
  return employeeCanLead(employee);
}

function suggestedRole(employee, neededRole, sourceShift = null) {
  if (neededRole === 'teacher') return roleForEmployee(employee) === 'teacher' ? 'teacher' : 'lead';
  if (neededRole === 'lead') return 'lead';
  if (sourceShift?.shift_role && ['teacher', 'lead', 'staff', 'replacement'].includes(sourceShift.shift_role)) return sourceShift.shift_role;
  return roleForEmployee(employee) === 'teacher' ? 'teacher' : roleForEmployee(employee) === 'lead' ? 'lead' : 'staff';
}

function availabilityFor(context, employee, pattern, date) {
  const friday = dayOf(date) === 5;
  if (pattern?.day_type === 'work') return { start: short(pattern.start_time), end: short(pattern.end_time), source: 'pattern' };
  if (pattern?.day_type === 'as_needed' || pattern?.day_type === 'avoid') return {
    start: short(employee.default_start) || '07:30',
    end: short(employee.default_end) || (friday ? '12:00' : '15:30'),
    source: 'as_needed',
  };
  if (!Array.isArray(context.patterns) || context.patterns.length === 0) return {
    start: short(employee.default_start) || '07:30',
    end: short(employee.default_end) || (friday ? '12:00' : '15:30'),
    source: 'legacy_default',
  };
  return { start:null, end:null, source:'not_configured' };
}

function scoreCandidate({ employee, targetClassId, neededRole, pattern, constraint, weeklyMinutes, requestedMinutes, candidateType, sourceShift, availability }) {
  let score = candidateType === 'direct' ? 52 : 47;
  const reasons = [];
  const cautions = [];

  if (candidateType === 'direct') reasons.push('פנוי/ה בכל טווח השעות');
  else reasons.push('אפשר להעביר בלי לפגוע בתקינת כיתת המקור');

  if (employee.primary_class_id === targetClassId) { score += 28; reasons.push('זו הכיתה הקבועה'); }
  else if (employee.assignment_mode === 'substitute') { score += 24; reasons.push('משלימ/ת מקום'); }
  else if (employee.assignment_mode === 'rotation') { score += 19; reasons.push('ברוטציה בין כיתות'); }
  else if (employee.assignment_mode === 'fixed' && employee.primary_class_id && employee.primary_class_id !== targetClassId) {
    score -= 13; cautions.push('הכיתה הקבועה שונה');
  }

  if (pattern?.day_type === 'work') { score += 9; reasons.push('תואם ליום ולשעות הקבועים'); }
  if (pattern?.day_type === 'as_needed' || pattern?.day_type === 'avoid') { score -= 34; reasons.push('זמין/ה לפי צורך בלבד'); cautions.push('עדיפות נמוכה — לבחור רק אם אין חלופה ביום עבודה קבוע'); }

  if (constraint?.constraint_type === 'preferred') {
    const rank=Number(constraint.priority_rank); const bonus=Number.isInteger(rank)&&rank>0?Math.max(-8,28-(rank-1)*8):15;
    score += bonus; reasons.push(Number.isInteger(rank)&&rank>0?`עדיפות כיתה ${rank}`:'עדיפות מפורשת לכיתה');
  }
  if (constraint?.constraint_type === 'avoid') { score -= 28; cautions.push('הוגדר שעדיף להימנע מהכיתה'); }

  const employeeRole = roleForEmployee(employee);
  if (neededRole === 'teacher' && employeeRole === 'teacher') { score += 17; reasons.push('התאמה מלאה לתפקיד גננת/גנן'); }
  else if (neededRole === 'teacher' && employeeCanLead(employee)) { score += 10; reasons.push('מורשה להוביל במקום גננת/גנן'); cautions.push('ישובץ/תשובץ כמוביל/ת כיתה ולא כגננת/גנן'); }
  else if (neededRole === 'lead' && employeeCanLead(employee)) { score += 14; reasons.push('מורשה להוביל את הכיתה'); }
  else if (!['teacher', 'lead'].includes(neededRole) && employeeCanLead(employee)) { score += 3; reasons.push('יכול/ה לסייע גם בהובלה'); }

  const targetMinutes = employee.weekly_hours == null ? null : Number(employee.weekly_hours) * 60;
  if (targetMinutes != null) {
    const gap = targetMinutes - weeklyMinutes;
    if (gap >= requestedMinutes) { score += Math.min(10, Math.max(2, Math.round(gap / 120))); reasons.push(`נותרו כ-${Math.max(1, Math.round(gap / 60))} שעות להיקף השבועי`); }
    else if (gap < -60) { score -= 10; cautions.push('כבר עבר/ה את היקף השעות המתוכנן'); }
  }

  if (candidateType === 'transfer') {
    score -= 4;
    if (sourceShift) cautions.push('הפעולה תעביר שיבוץ מכיתה אחרת');
  }

  const normalized = normalizeScore(score);
  const recommended = normalized >= 62 && constraint?.constraint_type !== 'avoid';
  return { score: normalized, reasons, cautions, recommended, recommendation_level: recommendationLevel(normalized) };
}

function rankCandidates(context) {
  const {
    employees = [], shifts = [], requests = [], constraints = [], patterns = [], operations = [], attendance = [], settings = {}, classes = [],
    date, classId, start, end, neededRole = 'staff', excludedEmployeeId = null, excludeShiftId = null,
  } = context;
  const requestedMinutes = Math.max(0, timeToMinutes(end) - timeToMinutes(start));
  const targetClass = classes.find((item) => item.id === classId);
  const candidates = [];
  const rejected = [];
  const mergedContext = { employees, shifts, requests, constraints, patterns, operations, attendance, settings, classes };

  for (const employee of employees) {
    const reject = (reason) => rejected.push({ employee_id: employee.id, full_name: employee.full_name, reason });
    if (employee.active === false || employee.id === excludedEmployeeId || employee.assignment_mode === 'no_schedule' || employee.is_schedulable === false) { reject('העובד אינו פעיל לשיבוץ'); continue; }
    if (employee.started_at && employee.started_at > date) { reject('טרם התחיל/ה לעבוד'); continue; }
    if (employee.ended_at && employee.ended_at < date) { reject('סיים/ה לעבוד'); continue; }
    if (!roleFits(employee, neededRole)) { reject('אינו מתאים לתפקיד הנדרש'); continue; }
    if (employee.job_title === 'גננת' && employee.primary_class_id && employee.primary_class_id !== classId) {
      reject('גננת ניתנת לשיבוץ רק בכיתה הקבועה שלה'); continue;
    }

    const unavailable = unavailableReason(mergedContext, employee.id, date, start, end);
    if (unavailable) { reject(unavailable); continue; }

    const constraint = activeConstraint(constraints, employee.id, classId, date);
    if (constraint?.constraint_type === 'forbidden') { reject('לא ניתן לשבץ בכיתה זו'); continue; }

    const pattern = dayPattern(mergedContext, employee.id, date);
    if (!pattern && patterns.length > 0) { reject('היום אינו מוגדר כיום עבודה או לפי צורך'); continue; }
    if (pattern?.day_type === 'day_off' || (!pattern && employee.fixed_day_off != null && Number(employee.fixed_day_off) === dayOf(date))) { reject('יום חופשי קבוע — אסור לשיבוץ אוטומטי'); continue; }
    const availability = availabilityFor(mergedContext, employee, pattern, date);
    if (!availability.start || !availability.end || timeToMinutes(start) < timeToMinutes(availability.start) || timeToMinutes(end) > timeToMinutes(availability.end)) { reject(`אינו זמין בכל הטווח ${start}–${end}`); continue; }

    const employeeShifts = shifts.filter((shift) => shift.employee_id === employee.id && shift.shift_date === date && shift.id !== excludeShiftId);
    const overlapping = employeeShifts.filter((shift) => overlaps(start, end, shift.start_time, shift.end_time));
    if (overlapping.some((shift) => shift.class_id === classId)) { reject('כבר משובץ/ת בכיתה בשעות אלו'); continue; }
    if (overlapping.length > 1) { reject('קיימים כמה שיבוצים חופפים'); continue; }

    const weeklyMinutes = calculateWeeklyMinutes(shifts.filter((shift) => shift.id !== excludeShiftId), employee.id);
    const maxMinutes = employee.max_weekly_hours == null ? null : Number(employee.max_weekly_hours) * 60;
    let candidateType = 'direct';
    let sourceShift = null;

    if (overlapping.length === 1) {
      sourceShift = overlapping[0];
      if (!exactRange(sourceShift, start, end)) { reject('השיבוץ בכיתה אחרת אינו זהה לטווח המבוקש'); continue; }
      if (!sourceClassCanRelease(mergedContext, sourceShift.class_id, employee.id, date, start, end)) { reject('העברה תפגע בתקינת כיתת המקור'); continue; }
      candidateType = 'transfer';
    } else if (maxMinutes != null && weeklyMinutes + requestedMinutes > maxMinutes) {
      reject('השיבוץ יעבור את מקסימום השעות השבועיות'); continue;
    }

    const scoring = scoreCandidate({ employee, targetClassId: classId, neededRole, pattern, constraint, weeklyMinutes, requestedMinutes, candidateType, sourceShift, availability });
    if (pattern?.day_type === 'avoid') scoring.recommended = false;
    candidates.push({
      employee_id: employee.id,
      full_name: employee.full_name,
      job_title: employee.job_title,
      score: scoring.score,
      recommendation_level: scoring.recommendation_level,
      recommended: scoring.recommended,
      reasons: scoring.reasons,
      cautions: scoring.cautions,
      candidate_type: candidateType,
      suggested_role: suggestedRole(employee, neededRole, sourceShift),
      source_shift_id: sourceShift?.id || null,
      from_class_id: sourceShift?.class_id || null,
      from_class_name: sourceShift ? (classes.find((item) => item.id === sourceShift.class_id)?.name || 'כיתה אחרת') : null,
      target_class_name: targetClass?.name || '',
      weekly_hours: Number((weeklyMinutes / 60).toFixed(1)),
      max_weekly_hours: employee.max_weekly_hours,
      availability: { start_time: availability.start, end_time: availability.end },
      current_day_shifts: employeeShifts.map((shift) => ({ id: shift.id, start_time: shift.start_time, end_time: shift.end_time, class_id: shift.class_id })),
    });
  }

  candidates.sort((a, b) => Number(b.recommended) - Number(a.recommended) || b.score - a.score || a.full_name.localeCompare(b.full_name, 'he'));
  return { candidates: candidates.slice(0, 60), rejected };
}

module.exports = {
  short,
  normalizeScore,
  recommendationLevel,
  employeeCanLead,
  roleForEmployee,
  activeConstraint,
  dayPattern,
  requestUnavailable,
  unavailableReason,
  unavailableInRange,
  sourceClassCanRelease,
  rankCandidates,
  scoreCandidate,
};
