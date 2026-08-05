const { requireSession, db, assertDb, send, handleError, httpError } = require('../lib/server');
const { overlaps, calculateWeeklyMinutes, timeToMinutes } = require('../lib/schedule');
const { roleForEmployee } = require('../lib/auto-schedule');
const dailyOperations = require('./daily-operations');

const { sourceClassCanRelease, unavailableInRange, employeeCanLead } = dailyOperations;

function sunday(dateString) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
function addDays(dateString, days) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function short(value) { return value ? String(value).slice(0, 5) : null; }
function normalizeScore(value, min = 1, max = 100) { return Math.max(min, Math.min(max, Math.round(Number(value) || 0))); }
function level(score) { return score >= 85 ? 'high' : score >= 70 ? 'good' : score >= 55 ? 'possible' : 'low'; }
function activeConstraint(constraints, employeeId, classId, date) {
  return constraints.find((item) => item.employee_id === employeeId && item.class_id === classId
    && (!item.valid_from || item.valid_from <= date) && (!item.valid_to || item.valid_to >= date));
}
function patternFor(patterns, employeeId, weekday) {
  return patterns.find((item) => item.employee_id === employeeId && Number(item.weekday) === Number(weekday));
}
function exactRange(shift, start, end) {
  return short(shift?.start_time) === start && short(shift?.end_time) === end;
}
function roleFits(employee, neededRole) {
  if (!['teacher', 'lead'].includes(neededRole)) return true;
  return employeeCanLead(employee);
}
function suggestedRole(employee, neededRole, sourceShift = null) {
  if (['teacher', 'lead'].includes(neededRole)) return neededRole;
  if (sourceShift?.shift_role && ['teacher', 'lead', 'staff', 'replacement'].includes(sourceShift.shift_role)) return sourceShift.shift_role;
  return roleForEmployee(employee) === 'teacher' ? 'teacher' : roleForEmployee(employee) === 'lead' ? 'lead' : 'staff';
}
function scoreCandidate({ employee, targetClassId, neededRole, pattern, constraint, weeklyMinutes, requestedMinutes, direct, transfer, homeClassSafe }) {
  let score = direct ? 58 : 50;
  const reasons = [];
  if (direct) reasons.push('פנוי/ה בכל טווח השעות');
  if (transfer) reasons.push('העברה אפשרית בלי לפגוע בתקינת כיתת המקור');

  if (employee.primary_class_id === targetClassId) { score += 27; reasons.push('זו הכיתה הקבועה'); }
  else if (employee.assignment_mode === 'substitute') { score += 22; reasons.push('משלימ/ת מקום'); }
  else if (employee.assignment_mode === 'rotation') { score += 17; reasons.push('ברוטציה בין כיתות'); }
  else if (employee.assignment_mode === 'fixed' && employee.primary_class_id && employee.primary_class_id !== targetClassId) {
    score -= homeClassSafe ? 12 : 35;
    reasons.push(homeClassSafe ? 'משויך/ת לכיתה אחרת, אך ניתן לשחרר' : 'הכיתה הקבועה זקוקה לעובד/ת');
  }

  if (pattern?.day_type === 'work') { score += 8; reasons.push('תואם ליום ולשעות הקבועים'); }
  if (pattern?.day_type === 'as_needed') { score += 13; reasons.push('מוגדר/ת לפי צורך ביום זה'); }
  if (constraint?.constraint_type === 'preferred') { score += 13; reasons.push('עדיפות מפורשת לכיתה'); }
  if (constraint?.constraint_type === 'avoid') { score -= 24; reasons.push('עדיף להימנע מהכיתה'); }

  const employeeRole = roleForEmployee(employee);
  if (neededRole === 'teacher' && employeeRole === 'teacher') { score += 13; reasons.push('התאמה מלאה לתפקיד גננת/גנן'); }
  else if (neededRole === 'lead' && employeeCanLead(employee)) { score += 11; reasons.push('מורשה להוביל את הכיתה'); }
  else if (!['teacher', 'lead'].includes(neededRole) && employeeCanLead(employee)) { score += 3; reasons.push('יכול/ה לסייע גם בהובלה'); }

  const targetMinutes = employee.weekly_hours == null ? null : Number(employee.weekly_hours) * 60;
  if (targetMinutes != null) {
    const gap = targetMinutes - weeklyMinutes;
    if (gap > 0) { score += Math.min(8, Math.max(1, Math.round(gap / 120))); reasons.push(`חסרות כ-${Math.round(gap / 60)} שעות השבוע`); }
    else if (gap < -60) { score -= 9; reasons.push('כבר עבר/ה את היקף השעות המתוכנן'); }
  }
  if (!direct && requestedMinutes > 0) score += 2;

  const normalized = normalizeScore(score);
  return {
    score: normalized,
    reasons,
    recommended: normalized >= 65 && constraint?.constraint_type !== 'avoid' && homeClassSafe !== false,
    recommendation_level: level(normalized),
  };
}

function rankCandidates(context) {
  const {
    employees = [], shifts = [], requests = [], constraints = [], patterns = [], operations = [], attendance = [], settings = {}, classes = [],
    date, classId, start, end, neededRole = 'staff', excludedEmployeeId = null, excludeShiftId = null,
  } = context;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const requestedMinutes = Math.max(0, timeToMinutes(end) - timeToMinutes(start));
  const targetClass = classes.find((item) => item.id === classId);
  const candidateContext = { employees, shifts, requests, constraints, patterns, operations, attendance, settings };
  const candidates = [];

  for (const employee of employees) {
    if (!employee.active || employee.id === excludedEmployeeId || employee.assignment_mode === 'no_schedule' || employee.is_schedulable === false) continue;
    if (employee.started_at && employee.started_at > date) continue;
    if (employee.ended_at && employee.ended_at < date) continue;
    if (!roleFits(employee, neededRole)) continue;
    if (unavailableInRange(candidateContext, employee.id, date, start, end)) continue;

    const constraint = activeConstraint(constraints, employee.id, classId, date);
    if (constraint?.constraint_type === 'forbidden') continue;
    const pattern = patternFor(patterns, employee.id, weekday);
    if (pattern?.day_type === 'day_off' || (!pattern && employee.fixed_day_off != null && Number(employee.fixed_day_off) === weekday)) continue;

    const availableStart = pattern?.day_type === 'work' ? short(pattern.start_time) : short(employee.default_start) || '07:30';
    const availableEnd = pattern?.day_type === 'work' ? short(pattern.end_time) : short(employee.default_end) || (weekday === 5 ? '12:00' : '15:30');
    if (timeToMinutes(start) < timeToMinutes(availableStart) || timeToMinutes(end) > timeToMinutes(availableEnd)) continue;

    const employeeShifts = shifts.filter((shift) => shift.employee_id === employee.id && shift.shift_date === date && shift.id !== excludeShiftId);
    const overlapping = employeeShifts.filter((shift) => overlaps(start, end, shift.start_time, shift.end_time));
    if (overlapping.some((shift) => shift.class_id === classId)) continue;
    if (overlapping.length > 1) continue;

    const weeklyMinutes = calculateWeeklyMinutes(shifts.filter((shift) => shift.id !== excludeShiftId), employee.id);
    const maxMinutes = employee.max_weekly_hours == null ? null : Number(employee.max_weekly_hours) * 60;

    let candidateType = 'direct';
    let sourceShift = null;
    let homeClassSafe = true;
    if (overlapping.length === 1) {
      sourceShift = overlapping[0];
      if (!exactRange(sourceShift, start, end)) continue;
      if (!sourceClassCanRelease(candidateContext, sourceShift.class_id, employee.id, date, start, end)) continue;
      candidateType = 'transfer';
    } else {
      if (maxMinutes != null && weeklyMinutes + requestedMinutes > maxMinutes) continue;
      if (employee.assignment_mode === 'fixed' && employee.primary_class_id && employee.primary_class_id !== classId) {
        homeClassSafe = sourceClassCanRelease(candidateContext, employee.primary_class_id, employee.id, date, start, end);
        if (!homeClassSafe) continue;
      }
    }

    const scoring = scoreCandidate({ employee, targetClassId: classId, neededRole, pattern, constraint, weeklyMinutes, requestedMinutes, direct: candidateType === 'direct', transfer: candidateType === 'transfer', homeClassSafe });
    candidates.push({
      employee_id: employee.id,
      full_name: employee.full_name,
      job_title: employee.job_title,
      score: scoring.score,
      recommendation_level: scoring.recommendation_level,
      recommended: scoring.recommended,
      reasons: scoring.reasons,
      candidate_type: candidateType,
      suggested_role: suggestedRole(employee, neededRole, sourceShift),
      source_shift_id: sourceShift?.id || null,
      from_class_id: sourceShift?.class_id || null,
      from_class_name: sourceShift ? (classes.find((item) => item.id === sourceShift.class_id)?.name || 'כיתה אחרת') : null,
      target_class_name: targetClass?.name || '',
      weekly_hours: Number((weeklyMinutes / 60).toFixed(1)),
      max_weekly_hours: employee.max_weekly_hours,
      availability: { start_time: availableStart, end_time: availableEnd },
      current_day_shifts: employeeShifts.map((shift) => ({ id: shift.id, start_time: shift.start_time, end_time: shift.end_time, class_id: shift.class_id })),
    });
  }

  return candidates
    .sort((a, b) => Number(b.recommended) - Number(a.recommended) || b.score - a.score || a.full_name.localeCompare(b.full_name, 'he'))
    .slice(0, 40);
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'Method not allowed' });
    await requireSession(req, { manager: true, csrf: false });

    let date = String(req.query?.date || '');
    let classId = String(req.query?.class_id || '');
    let start = String(req.query?.start_time || '07:30').slice(0, 5);
    let end = String(req.query?.end_time || '15:30').slice(0, 5);
    let neededRole = String(req.query?.shift_role || 'staff');
    const excludeShiftId = String(req.query?.exclude_shift_id || '');
    const mode = excludeShiftId ? 'replace' : String(req.query?.mode || 'add');

    let targetShift = null;
    if (excludeShiftId) {
      targetShift = assertDb(await db().from('hadas_shifts').select('*').eq('id', excludeShiftId).maybeSingle(), 'לא ניתן לטעון את השיבוץ להחלפה');
      if (!targetShift) throw httpError(404, 'השיבוץ להחלפה לא נמצא');
      date = targetShift.shift_date;
      classId = targetShift.class_id;
      start = short(targetShift.start_time);
      end = short(targetShift.end_time);
      neededRole = targetShift.shift_role || neededRole;
    }

    if (!date || !classId) throw httpError(400, 'חסרים תאריך או כיתה');
    if (timeToMinutes(end) <= timeToMinutes(start)) throw httpError(400, 'טווח השעות אינו תקין');

    const weekStart = sunday(date);
    const weekEnd = addDays(weekStart, 5);
    const [employeesR, shiftsR, requestsR, constraintsR, patternsR, operationsR, attendanceR, settingsR, classesR] = await Promise.all([
      db().from('hadas_employees').select('*').eq('active', true),
      db().from('hadas_shifts').select('*').gte('shift_date', weekStart).lte('shift_date', weekEnd),
      db().from('hadas_requests').select('*').in('request_type', ['leave', 'day_off', 'sick']).in('status', ['approved', 'applied']).lte('request_date', date),
      db().from('hadas_employee_class_constraints').select('*'),
      db().from('hadas_employee_weekly_patterns').select('*'),
      db().from('hadas_daily_operations').select('*').eq('operation_date', date),
      db().from('hadas_attendance').select('*').eq('attendance_date', date),
      db().from('hadas_app_settings').select('*').eq('id', 1).single(),
      db().from('hadas_classes').select('*').eq('active', true).order('sort_order'),
    ]);

    const shifts = assertDb(shiftsR, 'לא ניתן לטעון שיבוצים') || [];
    const candidates = rankCandidates({
      employees: assertDb(employeesR, 'לא ניתן לטעון עובדים') || [],
      shifts,
      requests: (assertDb(requestsR, 'לא ניתן לטעון בקשות') || []).filter((row) => date <= String(row.request_end_date || row.request_date)),
      constraints: assertDb(constraintsR, 'לא ניתן לטעון אילוצים') || [],
      patterns: assertDb(patternsR, 'לא ניתן לטעון ימי עבודה קבועים') || [],
      operations: assertDb(operationsR, 'לא ניתן לטעון תפעול יומי') || [],
      attendance: assertDb(attendanceR, 'לא ניתן לטעון נוכחות') || [],
      settings: assertDb(settingsR, 'לא ניתן לטעון הגדרות תקינה') || {},
      classes: assertDb(classesR, 'לא ניתן לטעון כיתות') || [],
      date, classId, start, end, neededRole,
      excludedEmployeeId: targetShift?.employee_id || null,
      excludeShiftId: targetShift?.id || null,
    });

    return send(res, 200, {
      ok: true,
      mode,
      context: { date, class_id: classId, start_time: start, end_time: end, shift_role: neededRole, target_shift_id: targetShift?.id || null },
      candidates,
      summary: {
        total: candidates.length,
        recommended: candidates.filter((item) => item.recommended).length,
        direct: candidates.filter((item) => item.candidate_type === 'direct').length,
        transfers: candidates.filter((item) => item.candidate_type === 'transfer').length,
      },
    });
  } catch (error) { handleError(res, error); }
};

module.exports.rankCandidates = rankCandidates;
module.exports.scoreCandidate = scoreCandidate;
module.exports.normalizeScore = normalizeScore;
