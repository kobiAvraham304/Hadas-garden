const crypto = require('crypto');
const {
  timeToMinutes, minutesToTime, dateRange, weekdayOf,
  closingTimeForDate, requiredStaffAt, leaderRequiredAt, coverageSlots, calculateWeeklyMinutes, validateWeek,
} = require('./schedule');

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function shortTime(value, fallback = '') { return value ? String(value).slice(0, 5) : fallback; }
function roleForEmployee(employee) {
  const title = String(employee?.job_title || '');
  if (/(גננת|גנן)/.test(title)) return 'teacher';
  if (title === 'סייעת מובילה' || employee?.can_lead) return 'lead';
  return 'staff';
}
function canLead(employee) { return ['teacher', 'lead'].includes(roleForEmployee(employee)); }
function roleRank(employee) { return ({ teacher: 0, lead: 1, staff: 2 })[roleForEmployee(employee)] ?? 9; }
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
  if (!pattern || pattern.day_type === 'day_off') return null;
  const open = shortTime(settings.opening_time, '07:30');
  const close = closingTimeForDate(settings, date);
  let start = shortTime(employee.default_start, open);
  let end = shortTime(employee.default_end, close);
  let source = 'as_needed';
  let asNeeded = true;
  let confidence = -45;
  if (pattern.day_type === 'work') {
    start = shortTime(pattern.start_time, start);
    end = shortTime(pattern.end_time, end);
    source = 'pattern';
    asNeeded = false;
    confidence = 30;
  } else if (!['as_needed', 'avoid'].includes(pattern.day_type)) return null;
  const startMin = Math.max(timeToMinutes(start), timeToMinutes(open));
  const endMin = Math.min(timeToMinutes(end), timeToMinutes(close));
  if (endMin <= startMin) return null;
  return { start: minutesToTime(startMin), end: minutesToTime(endMin), source, asNeeded, confidence, dayType: pattern.day_type };
}
function classEligibility({ employee, classItem, date, constraints }) {
  if (!classItem || classItem.active === false) return { eligible: false, reason: 'הכיתה אינה פעילה' };
  if (roleForEmployee(employee) === 'teacher' && employee.primary_class_id && employee.primary_class_id !== classItem.id) {
    return { eligible: false, reason: 'גננת ניתנת לשיבוץ רק בכיתה הקבועה שלה' };
  }
  const constraint = activeConstraint(constraints, employee.id, classItem.id, date);
  if (constraint?.constraint_type === 'forbidden') return { eligible: false, reason: constraint.reason || 'לא ניתן לשבץ בכיתה זו' };
  return { eligible: true, constraint };
}
function employeeBaseScore({ employee, classItem, date, constraints, availability, previousShifts }) {
  const eligibility = classEligibility({ employee, classItem, date, constraints });
  if (!eligibility.eligible) return { eligible: false, score: -Infinity, reasons: [eligibility.reason] };
  const constraint = eligibility.constraint;
  let score = 40 + Number(availability?.confidence || 0);
  const reasons = [];
  if (employee.primary_class_id === classItem.id) { score += 55; reasons.push('הכיתה הקבועה'); }
  else if (employee.assignment_mode === 'substitute') { score += 18; reasons.push('משלימ/ת מקום'); }
  else if (employee.assignment_mode === 'rotation') { score += 24; reasons.push('רוטציה בין כיתות'); }
  else if (employee.assignment_mode === 'fixed' && employee.primary_class_id) { score -= 42; reasons.push('הכיתה הקבועה שונה'); }
  if (constraint?.constraint_type === 'preferred') { score += 38; reasons.push('העדפה מפורשת לכיתה'); }
  if (constraint?.constraint_type === 'avoid') { score -= 38; reasons.push('עדיף להימנע מהכיתה'); }
  if (availability?.source === 'pattern') { score += 20; reasons.push('יום עבודה קבוע'); }
  if (availability?.asNeeded) { score -= 34; reasons.push('לפי צורך בלבד — עדיפות נמוכה'); }
  const previous = previousShifts.find((row) => row.employee_id === employee.id && row.class_id === classItem.id && weekdayOf(row.shift_date) === weekdayOf(date));
  if (previous) { score += 10; reasons.push('המשכיות מהשבוע הקודם'); }
  return { eligible: true, score, reasons };
}
function shiftCovers(shift, slot) { return timeToMinutes(shift.start_time) <= slot.start && timeToMinutes(shift.end_time) >= slot.end; }
function availabilityCovers(availability, slot) { return timeToMinutes(availability.start) <= slot.start && timeToMinutes(availability.end) >= slot.end; }
function assignedMinutes(shifts, employeeId) { return calculateWeeklyMinutes(shifts, employeeId); }
function positiveHoursMinutes(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number * 60 : null; }
function maxMinutes(employee) { return positiveHoursMinutes(employee.max_weekly_hours) ?? Infinity; }
function targetMinutes(employee) { return positiveHoursMinutes(employee.weekly_hours); }
function scoreTo100(raw) { return clamp(Math.round((raw + 25) * 100 / 220), 1, 100); }
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
function coverageForClass({ rows, classItem, date, settings, boundaryRows = [] }) {
  const classRows = rows.filter((row) => row.shift_date === date && row.class_id === classItem.id);
  return coverageSlots(settings, date, [...classRows, ...boundaryRows]).map((slot) => {
    const covering = classRows.filter((row) => shiftCovers(row, slot));
    const count = new Set(covering.map((row) => row.employee_id)).size;
    const required = requiredStaffAt(settings, date, slot.start);
    const leader = covering.some((row) => ['teacher', 'lead'].includes(row.shift_role));
    return { ...slot, count, required, staffMissing: Math.max(0, required - count), leaderMissing: leaderRequiredAt(settings, date, slot.start) && !leader };
  });
}
function coverageBenefit(coverage, availability, leaderCapable) {
  let staffUnits = 0; let leaderUnits = 0; let overstaffSlots = 0;
  for (const slot of coverage) {
    if (!availabilityCovers(availability, slot)) continue;
    if (slot.staffMissing > 0) staffUnits += 1;
    else overstaffSlots += 1;
    if (leaderCapable && slot.leaderMissing) leaderUnits += 1;
  }
  return { staffUnits, leaderUnits, overstaffSlots };
}
function bestNeedSegment(coverage, availability, leaderCapable, remaining, settings, blockedRows = []) {
  const availableSlots = coverage.filter((slot) => availabilityCovers(availability, slot)
    && !blockedRows.some((row) => timeToMinutes(row.start_time) < slot.end && timeToMinutes(row.end_time) > slot.start));
  if (!availableSlots.length || remaining < 15) return null;
  const morningEnd = timeToMinutes(settings.morning_end_time || settings.opening_time || '07:30');
  const closing = coverage[coverage.length - 1]?.end || timeToMinutes(closingTimeForDate(settings, '1970-01-01'));
  const closingStart = closing - Math.max(0, Number(settings.closing_window_minutes || 30));
  const windows = [];
  for (let startIndex = 0; startIndex < availableSlots.length; startIndex += 1) {
    for (let endIndex = startIndex; endIndex < availableSlots.length; endIndex += 1) {
      const slice = availableSlots.slice(startIndex, endIndex + 1);
      if (slice.some((slot, index) => index && slice[index - 1].end !== slot.start)) break;
      const duration = slice[slice.length - 1].end - slice[0].start;
      if (duration > remaining) break;
      const staffUnits = slice.filter((slot) => slot.staffMissing > 0).length;
      const leaderUnits = leaderCapable ? slice.filter((slot) => slot.leaderMissing).length : 0;
      if (!staffUnits && !leaderUnits) continue;
      const idleUnits = slice.filter((slot) => slot.staffMissing <= 0 && !(leaderCapable && slot.leaderMissing)).length;
      const morningUnits = slice.filter((slot) => slot.start < morningEnd && slot.staffMissing > 0).length;
      const closingUnits = slice.filter((slot) => slot.start >= closingStart && slot.staffMissing > 0).length;
      const utility = staffUnits * 30 + leaderUnits * 55 + morningUnits * 5 + closingUnits * 6 - idleUnits * 10 - duration / 180;
      windows.push({ start: slice[0].start, end: slice[slice.length - 1].end, staffUnits, leaderUnits, idleUnits, duration, utility });
    }
  }
  return windows.sort((a, b) => b.utility - a.utility || b.leaderUnits - a.leaderUnits || b.staffUnits - a.staffUnits || a.idleUnits - b.idleUnits || a.duration - b.duration || a.start - b.start)[0] || null;
}
function sourceCanReleaseWholeShift({ rows, shift, settings }) {
  const sourceRows = rows.filter((row) => row.shift_date === shift.shift_date && row.class_id === shift.class_id && row !== shift);
  const slots = coverageSlots(settings, shift.shift_date, rows.filter((row) => row.shift_date === shift.shift_date)).filter((slot) => shiftCovers(shift, slot));
  for (const slot of slots) {
    const covering = sourceRows.filter((row) => shiftCovers(row, slot));
    const count = new Set(covering.map((row) => row.employee_id)).size;
    if (count < requiredStaffAt(settings, shift.shift_date, slot.start)) return false;
    if (leaderRequiredAt(settings, shift.shift_date, slot.start)) {
      const leader = covering.some((row) => ['teacher', 'lead'].includes(row.shift_role));
      if (!leader) return false;
    }
  }
  return true;
}
function mandatoryWorkStatus({ employee, date, patterns, requests, settings }) {
  const pattern = patternFor(patterns, employee.id, weekdayOf(date));
  if (!pattern || pattern.day_type !== 'work') return null;
  if (absentOn(requests, employee.id, date)) return null;
  return employeeAvailability({ employee, date, patterns, requests, settings });
}

function generateAutomaticSchedule(input) {
  const {
    weekStart, employees = [], classes = [], patterns = [], constraints = [], requests = [],
    settings = {}, existingShifts = [], previousShifts = [], mode = 'rebuild', createdBy = null,
  } = input;
  const dates = dateRange(weekStart, 6);
  const activeClasses = classes.filter((row) => row.active !== false).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name).localeCompare(String(b.name), 'he'));
  const activeEmployees = employees.filter((row) => row.active !== false && row.is_schedulable !== false && row.assignment_mode !== 'no_schedule');
  const kept = mode === 'fill' ? existingShifts.map((row) => ({ ...row })) : [];
  const generated = [];
  const allRows = [...kept];
  const assignedDay = new Set(kept.map((row) => `${row.employee_id}|${row.shift_date}`));
  const weeklyMinutes = new Map(activeEmployees.map((employee) => [employee.id, assignedMinutes(kept, employee.id)]));
  const daySummaries = [];
  const excluded = [];
  const assignmentNotes = [];
  let asNeededCount = 0;
  let borrowedCount = 0;

  function remainingFor(employee) { return Math.max(0, maxMinutes(employee) - (weeklyMinutes.get(employee.id) || 0)); }
  function employeeDayRows(employeeId, date) { return allRows.filter((row) => row.employee_id === employeeId && row.shift_date === date); }
  function slotFreeForEmployee(employeeId, date, slot) {
    return !employeeDayRows(employeeId, date).some((row) => timeToMinutes(row.start_time) < slot.end && timeToMinutes(row.end_time) > slot.start);
  }
  function addGeneratedShift({ employee, classItem, date, start, end, reasons = [], baseScore = 70, note = null, kind = 'regular' }) {
    const duration = timeToMinutes(end) - timeToMinutes(start);
    if (duration <= 0 || duration > remainingFor(employee)) return null;
    const shift = {
      shift_date: date, class_id: classItem.id, employee_id: employee.id,
      start_time: shortTime(start), end_time: shortTime(end), shift_role: roleForEmployee(employee),
      status: 'draft', public_note: null, created_by: createdBy,
      _score: scoreTo100(baseScore), _reasons: Array.isArray(reasons) ? reasons : [], _kind: kind, _note: note,
    };
    generated.push(shift); allRows.push(shift); assignedDay.add(`${employee.id}|${date}`);
    weeklyMinutes.set(employee.id, (weeklyMinutes.get(employee.id) || 0) + duration);
    if (kind === 'as_needed') asNeededCount += 1;
    if (note) assignmentNotes.push({ shift_date: date, class_id: classItem.id, employee_id: employee.id, note });
    return shift;
  }

  for (const date of dates) {
    const availabilityByEmployee = new Map();
    for (const employee of activeEmployees) availabilityByEmployee.set(employee.id, employeeAvailability({ employee, date, patterns, requests, settings }));
    const dayBoundaryRows = [...availabilityByEmployee.values()].filter(Boolean).map((availability) => ({
      start_time: availability.start, end_time: availability.end,
    }));

    // Phase 1: every fixed-class employee with an explicit work day is rostered in the fixed class.
    // A work day is a commitment, not merely a candidate for minimum staffing.
    const fixedWork = activeEmployees
      .filter((employee) => employee.assignment_mode === 'fixed' && employee.primary_class_id)
      .map((employee) => ({ employee, availability: mandatoryWorkStatus({ employee, date, patterns, requests, settings }) }))
      .filter((item) => item.availability)
      .sort((a, b) => roleRank(a.employee) - roleRank(b.employee) || timeToMinutes(a.availability.start) - timeToMinutes(b.availability.start) || String(a.employee.full_name).localeCompare(String(b.employee.full_name), 'he'));
    for (const { employee, availability } of fixedWork) {
      if (assignedDay.has(`${employee.id}|${date}`)) continue;
      const classItem = activeClasses.find((row) => row.id === employee.primary_class_id);
      const eligibility = classEligibility({ employee, classItem, date, constraints });
      const duration = timeToMinutes(availability.end) - timeToMinutes(availability.start);
      if (!eligibility.eligible) { excluded.push({ date, employee_id: employee.id, reason: eligibility.reason, mandatory: true }); continue; }
      if (duration > remainingFor(employee)) { excluded.push({ date, employee_id: employee.id, reason: 'יום העבודה הקבוע חורג ממקסימום השעות השבועי', mandatory: true }); continue; }
      const base = employeeBaseScore({ employee, classItem, date, constraints, availability, previousShifts });
      const reasons = [...base.reasons];
      addGeneratedShift({ employee, classItem, date, start: availability.start, end: availability.end, reasons, baseScore: base.score, kind: 'fixed_work' });
    }

    // Phase 2: non-fixed employees with an explicit work day must also receive a class.
    // Choose globally by real deficit, preferences and continuity; do not depend on class loop order.
    const floatingWork = activeEmployees
      .filter((employee) => !(employee.assignment_mode === 'fixed' && employee.primary_class_id))
      .map((employee) => ({ employee, availability: mandatoryWorkStatus({ employee, date, patterns, requests, settings }) }))
      .filter((item) => item.availability && !assignedDay.has(`${item.employee.id}|${date}`))
      .sort((a, b) => roleRank(a.employee) - roleRank(b.employee) || String(a.employee.full_name).localeCompare(String(b.employee.full_name), 'he'));
    for (const { employee, availability } of floatingWork) {
      const duration = timeToMinutes(availability.end) - timeToMinutes(availability.start);
      if (duration > remainingFor(employee)) { excluded.push({ date, employee_id: employee.id, reason: 'יום העבודה הקבוע חורג ממקסימום השעות השבועי', mandatory: true }); continue; }
      const options = activeClasses.map((classItem) => {
        const base = employeeBaseScore({ employee, classItem, date, constraints, availability, previousShifts });
        if (!base.eligible) return null;
        const coverage = coverageForClass({ rows: allRows, classItem, date, settings, boundaryRows: dayBoundaryRows });
        const benefit = coverageBenefit(coverage, availability, canLead(employee));
        const utility = base.score + benefit.staffUnits * 30 + benefit.leaderUnits * 48 - benefit.overstaffSlots * 4;
        return { employee, classItem, availability, baseScore: base.score, reasons: base.reasons, utility };
      }).filter(Boolean);
      const chosen = stableSortCandidates(options)[0];
      if (!chosen) { excluded.push({ date, employee_id: employee.id, reason: 'אין כיתה חוקית ליום העבודה הקבוע', mandatory: true }); continue; }
      const reasons = [...chosen.reasons];
      addGeneratedShift({ employee, classItem: chosen.classItem, date, start: availability.start, end: availability.end, reasons, baseScore: chosen.baseScore, kind: 'floating_work' });
    }

    // Phase 3: fill only real deficits with "as needed" workers. Allocation is global and
    // scarcity-aware: a worker who is the only person able to cover a bottleneck is reserved for it,
    // instead of being consumed by an easier deficit that other substitutes can cover.
    while (true) {
      const coverageByClass = new Map(activeClasses.map((classItem) => [classItem.id, coverageForClass({ rows: allRows, classItem, date, settings, boundaryRows: dayBoundaryRows })]));
      const scarcity = new Map();
      const availableNeedWorkers = activeEmployees.filter((employee) => {
        const availability = availabilityByEmployee.get(employee.id);
        return availability?.asNeeded && remainingFor(employee) >= 15;
      });
      for (const classItem of activeClasses) {
        const coverage = coverageByClass.get(classItem.id) || [];
        for (const slot of coverage) {
          if (!slot.staffMissing && !slot.leaderMissing) continue;
          const eligible = availableNeedWorkers.filter((employee) => {
            const availability = availabilityByEmployee.get(employee.id);
            if (!availabilityCovers(availability, slot) || !slotFreeForEmployee(employee.id, date, slot)) return false;
            if (!classEligibility({ employee, classItem, date, constraints }).eligible) return false;
            return remainingFor(employee) >= slot.end - slot.start;
          });
          if (slot.staffMissing) scarcity.set(`${classItem.id}|${slot.start}|staff`, eligible.length);
          if (slot.leaderMissing) scarcity.set(`${classItem.id}|${slot.start}|leader`, eligible.filter(canLead).length);
        }
      }

      const options = [];
      for (const employee of availableNeedWorkers) {
        const availability = availabilityByEmployee.get(employee.id);
        const uniqueNeeds = [];
        for (const classItem of activeClasses) {
          if (!classEligibility({ employee, classItem, date, constraints }).eligible) continue;
          for (const slot of coverageByClass.get(classItem.id) || []) {
            if (!availabilityCovers(availability, slot) || !slotFreeForEmployee(employee.id, date, slot)) continue;
            if (slot.staffMissing && scarcity.get(`${classItem.id}|${slot.start}|staff`) === 1) uniqueNeeds.push(`${classItem.id}|${slot.start}|staff`);
            if (slot.leaderMissing && canLead(employee) && scarcity.get(`${classItem.id}|${slot.start}|leader`) === 1) uniqueNeeds.push(`${classItem.id}|${slot.start}|leader`);
          }
        }
        for (const classItem of activeClasses) {
          const base = employeeBaseScore({ employee, classItem, date, constraints, availability, previousShifts });
          if (!base.eligible) continue;
          const coverage = coverageByClass.get(classItem.id) || [];
          const existingSegments = employeeDayRows(employee.id, date);
          const segment = bestNeedSegment(coverage, availability, canLead(employee), remainingFor(employee), settings, existingSegments);
          if (!segment) continue;
          let scarcityBonus = 0;
          const coveredKeys = new Set();
          for (const slot of coverage) {
            if (slot.start < segment.start || slot.end > segment.end) continue;
            if (slot.staffMissing) {
              const key = `${classItem.id}|${slot.start}|staff`; const count = scarcity.get(key) || 0;
              scarcityBonus += count ? 42 / count : 0; coveredKeys.add(key);
            }
            if (slot.leaderMissing && canLead(employee)) {
              const key = `${classItem.id}|${slot.start}|leader`; const count = scarcity.get(key) || 0;
              scarcityBonus += count ? 70 / count : 0; coveredKeys.add(key);
            }
          }
          const strandedUnique = uniqueNeeds.filter((key) => !coveredKeys.has(key)).length;
          const targetGap = targetMinutes(employee) == null ? 0 : Math.max(-8, Math.min(10, Math.round((targetMinutes(employee) - (weeklyMinutes.get(employee.id) || 0)) / 60)));
          const splitPenalty = existingSegments.length * 18;
          const sameClassBonus = existingSegments.some((row) => row.class_id === classItem.id) ? 8 : 0;
          const utility = base.score + segment.utility + scarcityBonus + targetGap + sameClassBonus - splitPenalty - strandedUnique * 190;
          options.push({ employee, classItem, availability, segment, baseScore: base.score, reasons: base.reasons, utility, strandedUnique });
        }
      }
      const chosen = stableSortCandidates(options)[0];
      if (!chosen) break;
      const reasons = [...chosen.reasons, `נדרש בפועל ${minutesToTime(chosen.segment.start)}–${minutesToTime(chosen.segment.end)}`];
      if (!chosen.strandedUnique) reasons.push('נבחר בלי לחסום צורך שאין לו חלופה');
      addGeneratedShift({
        employee: chosen.employee, classItem: chosen.classItem, date,
        start: minutesToTime(chosen.segment.start), end: minutesToTime(chosen.segment.end),
        reasons, baseScore: chosen.baseScore, kind: 'as_needed',
      });
    }

    // Phase 4: only after direct workers are exhausted may a fixed worker be borrowed.
    // Borrowing moves the whole generated work shift and is allowed only when the source class stays fully valid.
    while (true) {
      const borrowOptions = [];
      for (const shift of generated.filter((row) => row.shift_date === date && row._kind === 'fixed_work')) {
        const employee = activeEmployees.find((row) => row.id === shift.employee_id);
        if (!employee || roleForEmployee(employee) === 'teacher' || !employee.primary_class_id || shift.class_id !== employee.primary_class_id) continue;
        if (!sourceCanReleaseWholeShift({ rows: allRows, shift, settings })) continue;
        const availability = { start: shift.start_time, end: shift.end_time, source: 'pattern', asNeeded: false, confidence: 30 };
        for (const classItem of activeClasses) {
          if (classItem.id === shift.class_id) continue;
          const base = employeeBaseScore({ employee, classItem, date, constraints, availability, previousShifts });
          if (!base.eligible) continue;
          const coverage = coverageForClass({ rows: allRows, classItem, date, settings, boundaryRows: dayBoundaryRows });
          const benefit = coverageBenefit(coverage, availability, canLead(employee));
          if (!benefit.staffUnits && !benefit.leaderUnits) continue;
          const utility = base.score + benefit.staffUnits * 22 + benefit.leaderUnits * 44 - 85;
          borrowOptions.push({ shift, employee, classItem, baseScore: base.score, reasons: base.reasons, utility });
        }
      }
      const chosen = stableSortCandidates(borrowOptions)[0];
      if (!chosen) break;
      const fromClass = activeClasses.find((row) => row.id === chosen.shift.class_id);
      const beforeClass = chosen.shift.class_id;
      chosen.shift.class_id = chosen.classItem.id;
      chosen.shift._kind = 'borrowed';
      chosen.shift._score = scoreTo100(chosen.baseScore);
      chosen.shift._note = `הועבר/ה מכיתת ${fromClass?.name || 'הכיתה הקבועה'} רק לאחר שנבדק שהכיתה נשארת בתקינה.`;
      chosen.shift._reasons = [...chosen.reasons, 'העברה בין כיתות כמוצא אחרון'];
      borrowedCount += 1;
      assignmentNotes.push({ shift_date: date, class_id: chosen.classItem.id, employee_id: chosen.employee.id, note: chosen.shift._note });
      // Guard against pathological cycles: a borrowed shift is never considered for borrowing again.
      if (beforeClass === chosen.shift.class_id) break;
    }

    const classSummaries = activeClasses.map((classItem) => {
      const coverage = coverageForClass({ rows: allRows, classItem, date, settings, boundaryRows: dayBoundaryRows });
      return {
        class_id: classItem.id, class_name: classItem.name,
        added: generated.filter((row) => row.shift_date === date && row.class_id === classItem.id).length,
        unresolved: coverage.filter((slot) => slot.staffMissing > 0).length,
        leader_missing: coverage.filter((slot) => slot.leaderMissing).length,
      };
    });
    daySummaries.push({ date, classes: classSummaries, unavailable: activeEmployees.filter((employee) => !availabilityByEmployee.get(employee.id)).length });
  }

  const cleanGenerated = generated.map(({ _score, _reasons, _note, _kind, ...row }) => row);
  const finalRows = [...kept, ...cleanGenerated];
  const validation = validateWeek({ shifts: finalRows, classes, employees, settings, constraints, weeklyPatterns: patterns, requests, weekStart });

  // A fixed work day that was not rostered is an auto-scheduling failure, not something to hide behind coverage.
  const mandatoryMissing = [];
  for (const date of dates) {
    for (const employee of activeEmployees) {
      const availability = mandatoryWorkStatus({ employee, date, patterns, requests, settings });
      if (!availability) continue;
      if (!finalRows.some((row) => row.employee_id === employee.id && row.shift_date === date)) {
        const reason = excluded.find((row) => row.date === date && row.employee_id === employee.id)?.reason || 'לא נמצא שיבוץ חוקי';
        mandatoryMissing.push({ code: 'work_day_unscheduled', date, employee_id: employee.id, message: `${employee.full_name}: יום עבודה קבוע לא שובץ — ${reason}` });
      }
    }
  }
  validation.errors.push(...mandatoryMissing);

  const allSlots = dates.flatMap((date) => activeClasses.flatMap((classItem) => coverageSlots(settings, date, finalRows.filter((row) => row.shift_date === date)).map((slot) => ({ date, classItem, slot }))));
  const requiredUnits = allSlots.reduce((sum, item) => sum + requiredStaffAt(settings, item.date, item.slot.start), 0);
  const coveredUnits = allSlots.reduce((sum, item) => {
    const count = new Set(finalRows.filter((row) => row.shift_date === item.date && row.class_id === item.classItem.id && shiftCovers(row, item.slot)).map((row) => row.employee_id)).size;
    return sum + Math.min(requiredStaffAt(settings, item.date, item.slot.start), count);
  }, 0);
  const leaderRequiredSlots = allSlots.filter((item) => leaderRequiredAt(settings, item.date, item.slot.start));
  const leaderSlots = leaderRequiredSlots.length;
  const coveredLeaderSlots = leaderRequiredSlots.filter((item) => finalRows.some((row) => row.shift_date === item.date && row.class_id === item.classItem.id && ['teacher', 'lead'].includes(row.shift_role) && shiftCovers(row, item.slot))).length;
  const scores = generated.map((row) => row._score || 50);
  const preferenceScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 100;
  const coveragePercent = requiredUnits ? Math.floor(coveredUnits * 1000 / requiredUnits) / 10 : 100;
  const leaderPercent = leaderSlots ? Math.floor(coveredLeaderSlots * 1000 / leaderSlots) / 10 : 100;
  const unresolvedStaffMinutes = allSlots.reduce((sum, item) => {
    const count = new Set(finalRows.filter((row) => row.shift_date === item.date && row.class_id === item.classItem.id && shiftCovers(row, item.slot)).map((row) => row.employee_id)).size;
    return sum + Math.max(0, requiredStaffAt(settings, item.date, item.slot.start) - count) * (item.slot.end - item.slot.start);
  }, 0);
  const quality = clamp(Math.round(coveragePercent * .58 + leaderPercent * .22 + preferenceScore * .20 - validation.errors.length * 2.5 - borrowedCount * .5), 1, 100);
  const employeeHours = activeEmployees.map((employee) => ({
    employee_id: employee.id, full_name: employee.full_name,
    hours: Math.round((weeklyMinutes.get(employee.id) || 0) / 6) / 10,
    target: positiveHoursMinutes(employee.weekly_hours) == null ? null : Number(employee.weekly_hours),
    maximum: positiveHoursMinutes(employee.max_weekly_hours) == null ? null : Number(employee.max_weekly_hours),
  })).filter((row) => row.hours > 0).sort((a, b) => b.hours - a.hours || a.full_name.localeCompare(b.full_name, 'he'));

  return {
    weekStart, mode, keptCount: kept.length, generated: cleanGenerated, finalRows,
    validation, daySummaries, employeeHours, excluded, assignmentNotes,
    metrics: {
      quality, coveragePercent, leaderPercent, preferenceScore: Math.round(preferenceScore), generatedCount: cleanGenerated.length,
      unresolvedErrors: validation.errors.length, warnings: validation.warnings.length,
      asNeededCount, asNeededPeople: new Set(generated.filter((row) => row._kind === 'as_needed').map((row) => row.employee_id)).size,
      borrowedCount, mandatoryWorkMissed: mandatoryMissing.length, unresolvedStaffMinutes,
    },
    signature: shiftSignature(finalRows),
  };
}

module.exports = {
  generateAutomaticSchedule, employeeAvailability, employeeBaseScore, roleForEmployee,
  scoreTo100, shiftSignature, activeConstraint, absentOn,
};
