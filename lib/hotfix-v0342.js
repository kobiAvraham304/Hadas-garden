const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const schedule = require('./schedule');
const server = require('./server');

const requestContext = new AsyncLocalStorage();
const originalValidateWeek = schedule.validateWeek;
const originalBuildScheduleAvailability = schedule.buildScheduleAvailability;

function shortTime(value) { return value ? String(value).slice(0, 5) : ''; }
function issueKey(issue = {}) {
  const stable = {
    code: issue.code || '',
    date: issue.date || '',
    class_id: issue.class_id || issue.classId || '',
    employee_id: issue.employee_id || '',
    time: issue.time || issue.start_time || '',
    end_time: issue.end_time || '',
    count: issue.count ?? null,
    expected: issue.expected ?? null,
    message: issue.message || issue.text || '',
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 40);
}
function contextApprovedKeys() { return requestContext.getStore()?.approvedKeys || new Set(); }
function isApproved(issue) { return contextApprovedKeys().has(issueKey(issue)); }
function isSubstitute(employee) { return String(employee?.assignment_mode || '') === 'substitute'; }

// A substitute/fill-in employee is an available reserve, not part of the regular
// vacation/absence strip. Excluding them here keeps the UI and every export that
// consumes scheduleAbsences consistent.
schedule.buildScheduleAvailability = function buildScheduleAvailabilityV0342(args = {}) {
  return originalBuildScheduleAvailability({
    ...args,
    employees: (args.employees || []).filter((employee) => !isSubstitute(employee)),
  });
};

// Exact approvals are final: once approved, the same deterministic issue must not
// reappear in staffing checks or automatic-schedule previews. A shift carrying
// rule_override is itself already an explicit approval, so its informational
// warning is not treated as a live exception either.
schedule.validateWeek = function validateWeekV0342(args = {}) {
  const result = originalValidateWeek(args);
  const overriddenEmployees = new Set((args.shifts || []).filter((row) => row.rule_override).map((row) => row.employee_id));
  const keep = (item) => {
    if (isApproved(item)) return false;
    if (item.code === 'manual_rule_override') return false;
    if (['max_weekly_days', 'max_weekly_hours'].includes(item.code) && overriddenEmployees.has(item.employee_id)) return false;
    return true;
  };
  return {
    ...result,
    errors: (result.errors || []).filter(keep),
    warnings: (result.warnings || []).filter(keep),
  };
};

// Load auto-schedule only after schedule.validateWeek has been wrapped, so every
// consumer destructures the approval-aware validator.
const auto = require('./auto-schedule');
const originalGenerateAutomaticSchedule = auto.generateAutomaticSchedule;

function patternFor(input, employeeId, date) {
  const weekday = schedule.weekdayOf(date);
  return (input.patterns || []).find((row) => row.employee_id === employeeId && Number(row.weekday) === weekday);
}
function absentOn(input, employeeId, date) {
  return (input.requests || []).some((row) => row.requester_id === employeeId
    && ['approved', 'applied'].includes(String(row.status || ''))
    && ['leave', 'day_off', 'sick'].includes(String(row.request_type || ''))
    && row.request_date <= date && date <= String(row.request_end_date || row.request_date));
}
function employeeById(input, id) { return (input.employees || []).find((row) => row.id === id); }
function minutes(row) { return Math.max(0, schedule.timeToMinutes(row.end_time) - schedule.timeToMinutes(row.start_time)); }
function overlaps(a, b) {
  return a.shift_date === b.shift_date && a.employee_id === b.employee_id
    && schedule.timeToMinutes(a.start_time) < schedule.timeToMinutes(b.end_time)
    && schedule.timeToMinutes(a.end_time) > schedule.timeToMinutes(b.start_time);
}
function maxWeeklyMinutes(employee) {
  const value = Number(employee?.max_weekly_hours);
  return Number.isFinite(value) && value > 0 ? value * 60 : Infinity;
}
function chosenExpansion(row, availability, allRows, employee, currentWeeklyMinutes) {
  const start = schedule.timeToMinutes(row.start_time);
  const end = schedule.timeToMinutes(row.end_time);
  const availableStart = schedule.timeToMinutes(availability.start);
  const availableEnd = schedule.timeToMinutes(availability.end);
  const availableDuration = availableEnd - availableStart;
  const minimum = Math.min(240, availableDuration); // Prefer a practical 4-hour block.
  const otherRows = allRows.filter((other) => other !== row && other.employee_id === row.employee_id && other.shift_date === row.shift_date);
  const candidates = [];

  const addCandidate = (candidateStart, candidateEnd, anchor) => {
    const next = { ...row, start_time: schedule.minutesToTime(candidateStart), end_time: schedule.minutesToTime(candidateEnd) };
    if (candidateStart > start || candidateEnd < end) return; // never lose coverage already planned
    if (candidateEnd - candidateStart < minimum) return;
    if (otherRows.some((other) => overlaps(next, other))) return;
    const extra = (candidateEnd - candidateStart) - (end - start);
    if (currentWeeklyMinutes + extra > maxWeeklyMinutes(employee)) return;
    candidates.push({ start: candidateStart, end: candidateEnd, extra, anchor });
  };

  // Anchor to opening or closing while containing the original need window.
  addCandidate(availableStart, Math.max(end, availableStart + minimum), 'start');
  addCandidate(Math.min(start, availableEnd - minimum), availableEnd, 'end');
  // Full availability is the safest final normalization when it still respects limits.
  addCandidate(availableStart, availableEnd, 'full');

  return candidates.sort((a, b) => a.extra - b.extra || (a.anchor === 'full' ? 1 : -1))[0] || null;
}
function autoPartialIssue(row, employee, availability) {
  if (!availability) return null;
  const start = schedule.timeToMinutes(row.start_time);
  const end = schedule.timeToMinutes(row.end_time);
  const aStart = schedule.timeToMinutes(availability.start);
  const aEnd = schedule.timeToMinutes(availability.end);
  if (start === aStart && end === aEnd) return null;
  const duration = end - start;
  const minimum = Math.min(240, aEnd - aStart);
  const anchored = start === aStart || end === aEnd;
  if (!anchored || duration < minimum) {
    return {
      severity: 'error',
      code: 'short_nonfixed_shift',
      date: row.shift_date,
      class_id: row.class_id,
      employee_id: row.employee_id,
      start_time: shortTime(row.start_time),
      end_time: shortTime(row.end_time),
      message: !anchored
        ? `${employee.full_name}: השיבוץ האוטומטי יצר משמרת חלקית באמצע היום (${shortTime(row.start_time)}–${shortTime(row.end_time)}). זהו מוצא אחרון ודורש אישור חריגה.`
        : `${employee.full_name}: משמרת לפי צורך קצרה מהטווח המעשי המועדף (${shortTime(row.start_time)}–${shortTime(row.end_time)}). נדרש אישור חריגה.`,
    };
  }
  return {
    severity: 'warning',
    code: 'partial_as_needed_shift',
    date: row.shift_date,
    class_id: row.class_id,
    employee_id: row.employee_id,
    start_time: shortTime(row.start_time),
    end_time: shortTime(row.end_time),
    message: `${employee.full_name}: שובץ/ה לפי צורך בחלק רציף של היום ${shortTime(row.start_time)}–${shortTime(row.end_time)}.`,
  };
}
function dedupe(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = issueKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function normalizeAutomaticPlan(plan, input) {
  if (!plan || !Array.isArray(plan.generated) || !plan.generated.length) return plan;
  const generated = plan.generated.map((row) => ({ ...row }));
  const kept = (plan.finalRows || []).slice(0, Math.max(0, Number(plan.keptCount || 0))).map((row) => ({ ...row }));
  const finalRows = [...kept, ...generated];
  const weeklyMinutes = new Map();
  for (const row of finalRows) weeklyMinutes.set(row.employee_id, (weeklyMinutes.get(row.employee_id) || 0) + minutes(row));

  for (const row of generated) {
    const employee = employeeById(input, row.employee_id);
    const pattern = patternFor(input, row.employee_id, row.shift_date);
    if (!employee || !['as_needed', 'avoid'].includes(String(pattern?.day_type || ''))) continue;
    const availability = auto.employeeAvailability({ employee, date: row.shift_date, patterns: input.patterns || [], requests: input.requests || [], settings: input.settings || {} });
    if (!availability) continue;
    const currentStart = schedule.timeToMinutes(row.start_time);
    const currentEnd = schedule.timeToMinutes(row.end_time);
    const aStart = schedule.timeToMinutes(availability.start);
    const aEnd = schedule.timeToMinutes(availability.end);
    const partial = currentStart !== aStart || currentEnd !== aEnd;
    const midDay = currentStart !== aStart && currentEnd !== aEnd;
    const tooShort = currentEnd - currentStart < Math.min(240, aEnd - aStart);
    if (!partial || (!midDay && !tooShort)) continue;

    const expansion = chosenExpansion(row, availability, finalRows, employee, weeklyMinutes.get(employee.id) || 0);
    if (!expansion) continue;
    const before = minutes(row);
    row.start_time = schedule.minutesToTime(expansion.start);
    row.end_time = schedule.minutesToTime(expansion.end);
    const after = minutes(row);
    weeklyMinutes.set(employee.id, (weeklyMinutes.get(employee.id) || 0) + after - before);
  }

  const selectedDates = Array.isArray(plan.selectedDates) && plan.selectedDates.length ? plan.selectedDates : schedule.dateRange(input.weekStart, 6);
  const selectedSet = new Set(selectedDates);
  const validation = schedule.validateWeek({
    shifts: finalRows,
    classes: input.classes || [],
    employees: input.employees || [],
    settings: input.settings || {},
    constraints: input.constraints || [],
    weeklyPatterns: input.patterns || [],
    requests: input.requests || [],
    weekStart: input.weekStart,
  });
  validation.errors = (validation.errors || []).filter((item) => !item.date || selectedSet.has(item.date));
  validation.warnings = (validation.warnings || []).filter((item) => !item.date || selectedSet.has(item.date));

  for (const date of selectedDates) {
    for (const employee of (input.employees || []).filter((row) => row.active !== false && row.is_schedulable !== false && row.assignment_mode !== 'no_schedule')) {
      const pattern = patternFor(input, employee.id, date);
      if (pattern?.day_type !== 'work' || absentOn(input, employee.id, date)) continue;
      if (!finalRows.some((row) => row.employee_id === employee.id && row.shift_date === date)) {
        validation.errors.push({ code: 'work_day_unscheduled', date, employee_id: employee.id, message: `${employee.full_name}: יום עבודה קבוע לא שובץ — יש לתקן לפני החלה` });
      }
    }
  }
  for (const row of generated) {
    const employee = employeeById(input, row.employee_id);
    const pattern = patternFor(input, row.employee_id, row.shift_date);
    if (!employee || !['as_needed', 'avoid'].includes(String(pattern?.day_type || ''))) continue;
    const availability = auto.employeeAvailability({ employee, date: row.shift_date, patterns: input.patterns || [], requests: input.requests || [], settings: input.settings || {} });
    const issue = autoPartialIssue(row, employee, availability);
    if (!issue || isApproved(issue)) continue;
    const { severity, ...publicIssue } = issue;
    (severity === 'error' ? validation.errors : validation.warnings).push(publicIssue);
  }
  validation.errors = dedupe(validation.errors).filter((item) => !isApproved(item));
  validation.warnings = dedupe(validation.warnings).filter((item) => !isApproved(item));

  const employeeHours = (input.employees || []).map((employee) => ({
    employee_id: employee.id,
    full_name: employee.full_name,
    hours: Math.round(((weeklyMinutes.get(employee.id) || 0) / 60) * 10) / 10,
    target: Number(employee.weekly_hours) > 0 ? Number(employee.weekly_hours) : null,
    maximum: Number(employee.max_weekly_hours) > 0 ? Number(employee.max_weekly_hours) : null,
  })).filter((row) => row.hours > 0).sort((a, b) => b.hours - a.hours || String(a.full_name).localeCompare(String(b.full_name), 'he'));

  const coverageGaps = validation.errors.filter((item) => ['understaffed', 'missing_leader'].includes(item.code)).map((item) => ({
    date: item.date,
    class_id: item.class_id,
    start_time: shortTime(item.time || item.start_time),
    end_time: shortTime(item.end_time || item.time || item.start_time),
    code: item.code,
    reason: 'requires_review',
    explanation: item.message,
    candidate_count: 0,
    candidate_employee_ids: [],
  }));
  const signature = crypto.createHash('sha256').update(`${auto.automaticInputSignature(input, selectedDates, input.mode || plan.mode)}|${auto.shiftSignature(finalRows)}`).digest('hex').slice(0, 24);

  return {
    ...plan,
    generated,
    finalRows,
    employeeHours,
    validation,
    coverageGaps,
    signature,
    metrics: {
      ...(plan.metrics || {}),
      generatedCount: generated.length,
      unresolvedErrors: validation.errors.length,
      warnings: validation.warnings.length,
    },
  };
}

auto.generateAutomaticSchedule = function generateAutomaticScheduleV0342(input) {
  return normalizeAutomaticPlan(originalGenerateAutomaticSchedule(input), input);
};

function sunday(dateString) {
  const d = new Date(`${dateString}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
function parseBody(req) {
  if (!req?.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}
async function approvedKeysForRequest(req, route) {
  if (route !== 'shifts') return new Set();
  const body = parseBody(req);
  const requested = body.week_start || req?.query?.week_start || server.israelDateISO();
  const weekStart = sunday(String(requested));
  if (!weekStart) return new Set();
  try {
    const rows = server.assertDb(await server.db().from('hadas_schedule_issue_approvals').select('issue_key').eq('week_start', weekStart), 'לא ניתן לטעון אישורי חריגה') || [];
    return new Set(rows.map((row) => row.issue_key));
  } catch (error) {
    console.warn('v0.34.2 approval context unavailable', error?.message || error);
    return new Set();
  }
}

async function runWithRequestContext(req, route, handler) {
  const approvedKeys = await approvedKeysForRequest(req, route);
  return requestContext.run({ approvedKeys }, handler);
}

module.exports = { runWithRequestContext, issueKey, normalizeAutomaticPlan };
