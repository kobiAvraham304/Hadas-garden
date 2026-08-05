const {
  requireSession, parseBody, db, assertDb, emitEvent, audit, isManager, scheduleScope, canViewFullSchedule, notifyEmployees,
  send, handleError, httpError, israelDateISO,
} = require('../lib/server');
const { validateWeek, timeToMinutes, closingTimeForDate } = require('../lib/schedule');
const { generateAutomaticSchedule } = require('../lib/auto-schedule');
const dailyOperations = require('./daily-operations');
const { employeeCanLead, sourceClassCanRelease, loadContext: loadDailyContext } = dailyOperations;

function addDays(dateString, days) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getSunday(dateString) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

function shiftSnapshot(shift) {
  if (!shift) return null;
  const keys = ['id', 'shift_date', 'class_id', 'employee_id', 'start_time', 'end_time', 'shift_role', 'status', 'public_note', 'created_at', 'updated_at'];
  return Object.fromEntries(keys.map((key) => [key, shift[key] ?? null]));
}

async function recordChange(caller, type, before, after) {
  const date = after?.shift_date || before?.shift_date;
  if (!date) return;
  assertDb(await db().from('hadas_schedule_changes').insert({
    week_start: getSunday(date),
    shift_id: after?.id || before?.id || null,
    change_type: type,
    before_data: shiftSnapshot(before),
    after_data: shiftSnapshot(after),
    created_by: caller.employee.id,
  }), 'לא ניתן לתעד את שינוי השיבוץ');
}

async function validateShift(payload, id, overrideDayOff = false) {
  if (!payload.shift_date || !payload.class_id || !payload.employee_id) throw httpError(400, 'חסרים פרטי שיבוץ');
  if (!payload.start_time || !payload.end_time || timeToMinutes(payload.end_time) <= timeToMinutes(payload.start_time)) throw httpError(400, 'שעות השיבוץ אינן תקינות');
  const [employeeR, classR, settingsR, patternR] = await Promise.all([
    db().from('hadas_employees').select('*').eq('id', payload.employee_id).maybeSingle(),
    db().from('hadas_classes').select('*').eq('id', payload.class_id).maybeSingle(),
    db().from('hadas_app_settings').select('*').eq('id', 1).maybeSingle(),
    db().from('hadas_employee_weekly_patterns').select('*').eq('employee_id', payload.employee_id),
  ]);
  const employee = assertDb(employeeR, 'העובד לא נמצא');
  const classItem = assertDb(classR, 'הכיתה לא נמצאה');
  const settings = assertDb(settingsR, 'הגדרות המערכת לא נמצאו');
  const weeklyPatterns = assertDb(patternR, 'לא ניתן לבדוק את ימי העבודה הקבועים') || [];
  if (!employee?.active) throw httpError(409, 'העובד אינו פעיל');
  if (employee.is_schedulable === false) throw httpError(409, 'העובד אינו מוגדר כחלק ממערך השיבוצים');
  if (['teacher', 'lead'].includes(payload.shift_role) && !employeeCanLead(employee)) throw httpError(409, 'העובד אינו מורשה לשמש גננת/גנן או מוביל/ת כיתה');
  if (!classItem?.active) throw httpError(409, 'הכיתה אינה פעילה');
  const dayClosing = closingTimeForDate(settings, payload.shift_date);
  if (timeToMinutes(payload.start_time) < timeToMinutes(settings.opening_time) || timeToMinutes(payload.end_time) > timeToMinutes(dayClosing)) {
    throw httpError(409, `השיבוץ חייב להיות בין ${String(settings.opening_time).slice(0, 5)} ל-${dayClosing}${new Date(`${payload.shift_date}T12:00:00Z`).getUTCDay() === 5 ? ' ביום שישי' : ''}`);
  }
  const constraintRows = assertDb(await db().from('hadas_employee_class_constraints').select('id,reason,valid_from,valid_to').eq('employee_id', payload.employee_id).eq('class_id', payload.class_id).eq('constraint_type', 'forbidden'), 'בדיקת אילוצים נכשלה') || [];
  const forbidden = constraintRows.find((item) => (!item.valid_from || item.valid_from <= payload.shift_date) && (!item.valid_to || item.valid_to >= payload.shift_date));
  if (forbidden) throw httpError(409, forbidden.reason ? `קיים איסור שיבוץ בכיתה: ${forbidden.reason}` : 'קיים איסור לשבץ את העובד בכיתה זו');
  const day = new Date(`${payload.shift_date}T12:00:00Z`).getUTCDay();
  const pattern = weeklyPatterns.find((row) => Number(row.weekday) === day);
  const fixedDayOff = pattern?.day_type === 'day_off' || (!pattern && employee.fixed_day_off === day);
  if (fixedDayOff && !overrideDayOff) throw httpError(409, 'זהו יום חופשי קבוע של העובד. ניתן לשמור רק לאחר אישור חריגה');
  const existingQuery = db().from('hadas_shifts').select('id').eq('employee_id', payload.employee_id).eq('shift_date', payload.shift_date).lt('start_time', payload.end_time).gt('end_time', payload.start_time);
  if (id) existingQuery.neq('id', id);
  const overlaps = assertDb(await existingQuery, 'בדיקת חפיפה נכשלה') || [];
  if (overlaps.length) throw httpError(409, 'העובד כבר משובץ בשעות חופפות');
  return { employee, classItem };
}



async function loadAutomaticScheduleData(weekStart) {
  const weekEnd = addDays(weekStart, 5);
  const previousStart = addDays(weekStart, -7);
  const [employeesR, classesR, settingsR, constraintsR, patternsR, requestsR, existingR, previousR] = await Promise.all([
    db().from('hadas_employees').select('*').eq('active', true),
    db().from('hadas_classes').select('*').eq('active', true).order('sort_order'),
    db().from('hadas_app_settings').select('*').eq('id', 1).single(),
    db().from('hadas_employee_class_constraints').select('*'),
    db().from('hadas_employee_weekly_patterns').select('*'),
    db().from('hadas_requests').select('*').in('request_type', ['leave', 'day_off', 'sick']).in('status', ['approved', 'applied']).lte('request_date', weekEnd),
    db().from('hadas_shifts').select('*').gte('shift_date', weekStart).lte('shift_date', weekEnd),
    db().from('hadas_shifts').select('*').gte('shift_date', previousStart).lte('shift_date', addDays(previousStart, 5)),
  ]);
  return {
    employees: assertDb(employeesR, 'לא ניתן לטעון עובדים לשיבוץ האוטומטי') || [],
    classes: assertDb(classesR, 'לא ניתן לטעון כיתות לשיבוץ האוטומטי') || [],
    settings: assertDb(settingsR, 'לא ניתן לטעון הגדרות תקינה') || {},
    constraints: assertDb(constraintsR, 'לא ניתן לטעון העדפות ואילוצים') || [],
    patterns: assertDb(patternsR, 'לא ניתן לטעון ימי עבודה קבועים') || [],
    requests: (assertDb(requestsR, 'לא ניתן לטעון חופשות ומחלות') || []).filter((row) => String(row.request_end_date || row.request_date) >= weekStart),
    existingShifts: assertDb(existingR, 'לא ניתן לטעון את השיבוץ הקיים') || [],
    previousShifts: assertDb(previousR, 'לא ניתן לטעון את השבוע הקודם') || [],
  };
}

function publicAutomaticPreview(plan) {
  return {
    weekStart: plan.weekStart,
    mode: plan.mode,
    keptCount: plan.keptCount,
    generated: plan.generated,
    finalRows: plan.finalRows,
    validation: plan.validation,
    daySummaries: plan.daySummaries,
    employeeHours: plan.employeeHours,
    metrics: plan.metrics,
    signature: plan.signature,
  };
}

async function recordAutomaticChanges(caller, weekStart, deletedRows, insertedRows) {
  const rows = [];
  for (const shift of deletedRows) rows.push({
    week_start: weekStart, shift_id: shift.id || null, change_type: 'delete',
    before_data: shiftSnapshot(shift), after_data: null, created_by: caller.employee.id,
  });
  for (const shift of insertedRows) rows.push({
    week_start: weekStart, shift_id: shift.id || null, change_type: 'create',
    before_data: null, after_data: shiftSnapshot(shift), created_by: caller.employee.id,
  });
  if (rows.length) assertDb(await db().from('hadas_schedule_changes').insert(rows), 'לא ניתן לתעד את השיבוץ האוטומטי');
}


function autoShiftRestoreRow(shift) {
  return {
    id: shift.id,
    shift_date: shift.shift_date,
    class_id: shift.class_id,
    employee_id: shift.employee_id,
    start_time: shift.start_time,
    end_time: shift.end_time,
    shift_role: shift.shift_role,
    status: shift.status || 'draft',
    public_note: shift.public_note ?? null,
    created_by: shift.created_by ?? null,
    created_at: shift.created_at,
    updated_at: shift.updated_at,
  };
}

async function restoreAutomaticSchedule(deletedRows, insertedRows) {
  const insertedIds = (insertedRows || []).map((row) => row.id).filter(Boolean);
  if (insertedIds.length) {
    const removeResult = await db().from('hadas_shifts').delete().in('id', insertedIds);
    if (removeResult.error) return { ok:false, message:`מחיקת הטיוטה החדשה נכשלה: ${removeResult.error.message}` };
  }
  if (deletedRows?.length) {
    const restoreRows = deletedRows.map(autoShiftRestoreRow);
    const restoreResult = await db().from('hadas_shifts').insert(restoreRows);
    if (restoreResult.error) return { ok:false, message:`שחזור השיבוץ הקודם נכשל: ${restoreResult.error.message}` };
  }
  return { ok:true };
}

async function getWeekValidation(weekStart) {
  const weekEnd = addDays(weekStart, 5);
  const [shiftsR, classesR, employeesR, settingsR, constraintsR, patternsR] = await Promise.all([
    db().from('hadas_shifts').select('*').gte('shift_date', weekStart).lte('shift_date', weekEnd),
    db().from('hadas_classes').select('*').eq('active', true),
    db().from('hadas_employees').select('*').eq('active', true),
    db().from('hadas_app_settings').select('*').eq('id', 1).single(),
    db().from('hadas_employee_class_constraints').select('*'),
    db().from('hadas_employee_weekly_patterns').select('*'),
  ]);
  const shifts = assertDb(shiftsR, 'לא ניתן לטעון שיבוצים') || [];
  return {
    shifts,
    validation: validateWeek({
      shifts,
      classes: assertDb(classesR, 'לא ניתן לטעון כיתות') || [],
      employees: assertDb(employeesR, 'לא ניתן לטעון עובדים') || [],
      settings: assertDb(settingsR, 'לא ניתן לטעון הגדרות') || {},
      constraints: assertDb(constraintsR, 'לא ניתן לטעון אילוצים') || [],
      weeklyPatterns: assertDb(patternsR, 'לא ניתן לטעון ימי עבודה קבועים') || [],
      weekStart,
    }),
  };
}

async function unpublishedChanges(weekStart) {
  return assertDb(await db().from('hadas_schedule_changes').select('*').eq('week_start', weekStart).is('published_revision', 'null').order('created_at'), 'לא ניתן לטעון שינויים') || [];
}

function rowsOverlap(a, b) {
  return a.employee_id === b.employee_id && a.shift_date === b.shift_date && timeToMinutes(a.start_time) < timeToMinutes(b.end_time) && timeToMinutes(a.end_time) > timeToMinutes(b.start_time);
}

function restoreLastPublished(currentRows, pendingChanges) {
  const result = new Map(currentRows.filter((row) => row.status === 'published').map((row) => [row.id, row]));
  for (const change of pendingChanges) {
    const before = change.before_data;
    if (before?.id && before.status === 'published' && !result.has(before.id)) result.set(before.id, before);
  }
  return [...result.values()].sort((a, b) => `${a.shift_date}-${a.start_time}`.localeCompare(`${b.shift_date}-${b.start_time}`));
}

function buildScheduleAbsences(requests, employees, weeklyPatterns, weekStart) {
  const dates = Array.from({ length: 6 }, (_, index) => addDays(weekStart, index));
  const validDates = new Set(dates);
  const absenceMap = new Map();
  for (const request of requests) {
    if (!['approved', 'applied'].includes(request.status)) continue;
    if (!['leave', 'day_off', 'sick'].includes(request.request_type)) continue;
    const endDate = request.request_end_date || request.request_date;
    for (const cursor of dates) {
      if (cursor < request.request_date || cursor > endDate) continue;
      absenceMap.set(`${request.requester_id}:${cursor}`, {
        employee_id: request.requester_id,
        absence_date: cursor,
        absence_type: request.request_type,
      });
    }
  }
  const employeesWithPatterns = new Set(weeklyPatterns.map((row) => row.employee_id));
  for (const pattern of weeklyPatterns.filter((row) => row.day_type === 'day_off')) {
    for (const date of dates) {
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (weekday !== Number(pattern.weekday)) continue;
      const key = `${pattern.employee_id}:${date}`;
      if (!absenceMap.has(key)) absenceMap.set(key, { employee_id: pattern.employee_id, absence_date: date, absence_type: 'day_off' });
    }
  }
  for (const employee of employees.filter((row) => row.active && row.fixed_day_off !== null && row.fixed_day_off !== undefined && !employeesWithPatterns.has(row.id))) {
    for (const date of dates) {
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (weekday !== Number(employee.fixed_day_off)) continue;
      const key = `${employee.id}:${date}`;
      if (!absenceMap.has(key)) absenceMap.set(key, { employee_id: employee.id, absence_date: date, absence_type: 'day_off' });
    }
  }
  return [...absenceMap.values()].sort((a, b) => `${a.absence_date}-${a.employee_id}`.localeCompare(`${b.absence_date}-${b.employee_id}`));
}

module.exports = async function handler(req, res) {
  try {
    const parsed = parseBody(req);
    const requiresManager = req.method === 'GET' ? false : (req.method !== 'POST' || parsed.action !== 'ack');
    const caller = await requireSession(req, { manager: requiresManager, csrf: req.method !== 'GET' });
    const body = parsed;

    if (req.method === 'GET') {
      const weekStart = getSunday(String(req.query?.week_start || israelDateISO()));
      const weekEnd = addDays(weekStart, 5);
      const [shiftsR, publicationR, changesR, ackR, requestsR, employeesR, patternsR, settingsR] = await Promise.all([
        db().from('hadas_shifts').select('*').gte('shift_date', weekStart).lte('shift_date', weekEnd).order('shift_date').order('start_time'),
        db().from('hadas_schedule_publications').select('*').eq('week_start', weekStart).maybeSingle(),
        db().from('hadas_schedule_changes').select('*').eq('week_start', weekStart).is('published_revision', 'null').order('created_at'),
        db().from('hadas_schedule_acknowledgements').select('*').eq('week_start', weekStart),
        db().from('hadas_requests').select('requester_id,request_date,request_end_date,request_type,status').lte('request_date', weekEnd),
        db().from('hadas_employees').select('id,active,fixed_day_off,is_schedulable'),
        db().from('hadas_employee_weekly_patterns').select('*'),
        db().from('hadas_app_settings').select('*').eq('id', 1).maybeSingle(),
      ]);
      let shifts = assertDb(shiftsR, 'לא ניתן לטעון שיבוצים') || [];
      const publication = assertDb(publicationR, 'לא ניתן לטעון מצב פרסום') || null;
      const scheduleChanges = assertDb(changesR, 'לא ניתן לטעון שינויים') || [];
      let acknowledgements = assertDb(ackR, 'לא ניתן לטעון אישורי קריאה') || [];
      const requests = assertDb(requestsR, 'לא ניתן לטעון היעדרויות') || [];
      const employees = assertDb(employeesR, 'לא ניתן לטעון ימי חופש') || [];
      const weeklyPatterns = assertDb(patternsR, 'לא ניתן לטעון ימי עבודה קבועים') || [];
      const settings = assertDb(settingsR, 'לא ניתן לטעון הגדרות תקינה') || {};
      const scope = scheduleScope(caller);
      const fullScheduleViewer = scope === 'full';
      if (!isManager(caller)) {
        shifts = restoreLastPublished(shifts, scheduleChanges);
        if (scope === 'class') shifts = shifts.filter((row) => row.class_id === caller.employee.primary_class_id);
        else if (!fullScheduleViewer) shifts = shifts.filter((row) => row.employee_id === caller.employee.id);
        acknowledgements = acknowledgements.filter((row) => row.employee_id === caller.employee.id);
      }
      let scheduleAbsences = buildScheduleAbsences(requests, employees, weeklyPatterns, weekStart);
      if (scope === 'class') {
        const classEmployeeIds = new Set(employees.filter((row) => row.primary_class_id === caller.employee.primary_class_id).map((row) => row.id));
        scheduleAbsences = scheduleAbsences.filter((row) => classEmployeeIds.has(row.employee_id));
      } else if (!fullScheduleViewer) scheduleAbsences = scheduleAbsences.filter((row) => row.employee_id === caller.employee.id);
      return send(res, 200, {
        ok: true,
        weekStart,
        shifts,
        publication,
        scheduleChanges: isManager(caller) ? scheduleChanges : [],
        scheduleAbsences,
        acknowledgements,
        settings,
      });
    }

    if (req.method === 'POST' && body.action === 'ack') {
      const weekStart = getSunday(String(body.week_start || israelDateISO()));
      assertDb(await db().from('hadas_schedule_acknowledgements').upsert({ employee_id: caller.employee.id, week_start: weekStart, acknowledged_at: new Date().toISOString() }, { onConflict: 'employee_id,week_start' }), 'לא ניתן לשמור אישור קריאה');
      await emitEvent('schedule_ack');
      return send(res, 200, { ok: true });
    }


    if (req.method === 'POST' && body.action === 'auto_preview') {
      const weekStart = getSunday(String(body.week_start || israelDateISO()));
      const mode = body.mode === 'fill' ? 'fill' : 'rebuild';
      const data = await loadAutomaticScheduleData(weekStart);
      const plan = generateAutomaticSchedule({ ...data, weekStart, mode, createdBy: caller.employee.id });
      return send(res, 200, { ok: true, preview: publicAutomaticPreview(plan) });
    }

    if (req.method === 'POST' && body.action === 'auto_apply') {
      const weekStart = getSunday(String(body.week_start || israelDateISO()));
      const mode = body.mode === 'fill' ? 'fill' : 'rebuild';
      const data = await loadAutomaticScheduleData(weekStart);
      const plan = generateAutomaticSchedule({ ...data, weekStart, mode, createdBy: caller.employee.id });
      if (body.signature && body.signature !== plan.signature) throw httpError(409, 'נתוני העובדים או השבוע השתנו מאז התצוגה המקדימה. יש לחשב מחדש את השיבוץ.');
      if (plan.validation.errors.length && !body.allow_incomplete) throw httpError(409, 'נשארו חוסרים בשיבוץ האוטומטי. ניתן לחזור לתצוגה המקדימה או לאשר יצירת טיוטה חלקית.', plan.validation);
      if (!plan.generated.length) throw httpError(409, mode === 'fill' ? 'לא נמצאו חוסרים שניתן למלא אוטומטית' : 'לא ניתן היה ליצור שיבוצים מהנתונים הקיימים');
      const weekEnd = addDays(weekStart, 5);
      const deletedRows = mode === 'rebuild' ? data.existingShifts : [];
      const rows = plan.generated.map((row) => ({ ...row, status: 'draft', created_by: caller.employee.id }));
      let inserted = [];
      try {
        if (deletedRows.length) assertDb(await db().from('hadas_shifts').delete().gte('shift_date', weekStart).lte('shift_date', weekEnd), 'לא ניתן לנקות את השבוע לפני השיבוץ האוטומטי');
        inserted = assertDb(await db().from('hadas_shifts').insert(rows).select('*'), 'לא ניתן לשמור את השיבוץ האוטומטי') || [];
        await recordAutomaticChanges(caller, weekStart, deletedRows, inserted);
      } catch (error) {
        const restored = await restoreAutomaticSchedule(deletedRows, inserted);
        if (!restored.ok) throw httpError(500, `${error.message}. בנוסף, ${restored.message}. אין לבצע ניסיון נוסף לפני בדיקת השבוע.`);
        throw error;
      }
      await audit(caller.employee.id, 'automatic_schedule', 'schedule', weekStart, {
        mode, generated: inserted.length, quality: plan.metrics.quality,
        errors: plan.validation.errors.length, warnings: plan.validation.warnings.length,
      });
      await emitEvent('shifts');
      return send(res, 201, { ok: true, count: inserted.length, mode, metrics: plan.metrics, validation: plan.validation });
    }


    if (req.method === 'POST' && body.action === 'apply_suggestion') {
      const candidateId = String(body.candidate_id || '');
      const candidateType = body.candidate_type === 'transfer' ? 'transfer' : 'direct';
      const targetShiftId = String(body.target_shift_id || '');
      const sourceShiftId = String(body.source_shift_id || '');
      if (!candidateId) throw httpError(400, 'לא נבחר עובד');

      const targetShift = targetShiftId
        ? assertDb(await db().from('hadas_shifts').select('*').eq('id', targetShiftId).maybeSingle(), 'השיבוץ להחלפה לא נמצא')
        : null;
      if (targetShiftId && !targetShift) throw httpError(404, 'השיבוץ להחלפה לא נמצא');

      const payload = {
        shift_date: targetShift?.shift_date || String(body.shift_date || ''),
        class_id: targetShift?.class_id || String(body.class_id || ''),
        employee_id: candidateId,
        start_time: targetShift?.start_time || String(body.start_time || ''),
        end_time: targetShift?.end_time || String(body.end_time || ''),
        shift_role: ['teacher', 'lead', 'staff', 'replacement'].includes(body.shift_role)
          ? body.shift_role
          : (targetShift?.shift_role || 'staff'),
        status: 'draft',
        public_note: String(body.public_note || targetShift?.public_note || '').trim() || null,
        created_by: caller.employee.id,
      };

      if (candidateType === 'direct') {
        await validateShift(payload, targetShift?.id || null, false);
        if (targetShift) {
          const updated = assertDb(await db().from('hadas_shifts').update(payload).eq('id', targetShift.id).select('*').single(), 'לא ניתן להחליף את העובד');
          await recordChange(caller, 'update', targetShift, updated);
          await audit(caller.employee.id, 'apply_direct_suggestion', 'shift', targetShift.id, { candidate_id:candidateId });
          await emitEvent('shifts');
          return send(res, 200, { ok:true, shift:updated, candidateType:'direct' });
        }
        const inserted = assertDb(await db().from('hadas_shifts').insert(payload).select('*').single(), 'לא ניתן לשמור את השיבוץ');
        await recordChange(caller, 'create', null, inserted);
        await audit(caller.employee.id, 'apply_direct_suggestion', 'shift', inserted.id, { candidate_id:candidateId });
        await emitEvent('shifts');
        return send(res, 201, { ok:true, shift:inserted, candidateType:'direct' });
      }

      if (!sourceShiftId) throw httpError(400, 'חסר שיבוץ המקור להעברה');
      const sourceShift = assertDb(await db().from('hadas_shifts').select('*').eq('id', sourceShiftId).maybeSingle(), 'שיבוץ המקור לא נמצא');
      if (!sourceShift || sourceShift.employee_id !== candidateId) throw httpError(409, 'אפשרות ההעברה כבר אינה זמינה');
      if (sourceShift.shift_date !== payload.shift_date || String(sourceShift.start_time).slice(0,5) !== String(payload.start_time).slice(0,5) || String(sourceShift.end_time).slice(0,5) !== String(payload.end_time).slice(0,5)) {
        throw httpError(409, 'ניתן לבצע העברה אוטומטית רק כאשר טווח השעות זהה. יש לערוך ידנית במקרה של שעות שונות.');
      }
      if (sourceShift.class_id === payload.class_id) throw httpError(409, 'העובד כבר משובץ בכיתה זו');
      const dailyContext = await loadDailyContext(payload.shift_date);
      if (!sourceClassCanRelease(dailyContext, sourceShift.class_id, candidateId, payload.shift_date, payload.start_time, payload.end_time)) {
        throw httpError(409, 'לא ניתן להעביר את העובד: ההעברה תפגע בתקינת כיתת המקור');
      }

      if (!targetShift) {
        await validateShift(payload, sourceShift.id, false);
        const updatedSource = assertDb(await db().from('hadas_shifts').update({
          class_id: payload.class_id,
          shift_role: payload.shift_role,
          status: 'draft',
          public_note: payload.public_note || `הועבר/ה מכיתה אחרת`,
        }).eq('id', sourceShift.id).select('*').single(), 'לא ניתן להעביר את העובד לכיתה');
        await recordChange(caller, 'update', sourceShift, updatedSource);
        await audit(caller.employee.id, 'apply_transfer_suggestion', 'shift', sourceShift.id, { from_class_id:sourceShift.class_id, to_class_id:payload.class_id });
        await emitEvent('shifts');
        return send(res, 200, { ok:true, shift:updatedSource, candidateType:'transfer' });
      }

      let updatedTarget = null;
      let sourceDeleted = false;
      try {
        assertDb(await db().from('hadas_shifts').delete().eq('id', sourceShift.id), 'לא ניתן לפנות את שיבוץ המקור');
        sourceDeleted = true;
        await validateShift(payload, targetShift.id, false);
        updatedTarget = assertDb(await db().from('hadas_shifts').update(payload).eq('id', targetShift.id).select('*').single(), 'לא ניתן להחיל את ההחלפה');
        await recordChange(caller, 'delete', sourceShift, null);
        await recordChange(caller, 'update', targetShift, updatedTarget);
      } catch (error) {
        if (updatedTarget) await db().from('hadas_shifts').update({ shift_date:targetShift.shift_date, class_id:targetShift.class_id, employee_id:targetShift.employee_id, start_time:targetShift.start_time, end_time:targetShift.end_time, shift_role:targetShift.shift_role, status:targetShift.status, public_note:targetShift.public_note }).eq('id', targetShift.id);
        if (sourceDeleted) await db().from('hadas_shifts').insert(autoShiftRestoreRow(sourceShift));
        throw error;
      }
      await audit(caller.employee.id, 'apply_transfer_suggestion', 'shift', targetShift.id, { source_shift_id:sourceShift.id, from_class_id:sourceShift.class_id, to_class_id:payload.class_id });
      await emitEvent('shifts');
      return send(res, 200, { ok:true, shift:updatedTarget, candidateType:'transfer' });
    }

    if (req.method === 'POST' && ['validate', 'publish_preview'].includes(body.action)) {
      const weekStart = getSunday(String(body.week_start || israelDateISO()));
      const result = await getWeekValidation(weekStart);
      const changes = await unpublishedChanges(weekStart);
      return send(res, 200, {
        ok: true,
        ...result.validation,
        shiftCount: result.shifts.length,
        draftCount: result.shifts.filter((shift) => shift.status === 'draft').length,
        changes: changes.map((change) => ({
          id: change.id,
          change_type: change.change_type,
          before_data: change.before_data,
          after_data: change.after_data,
          created_at: change.created_at,
        })),
      });
    }

    if (req.method === 'POST' && body.action === 'publish') {
      const weekStart = getSunday(String(body.week_start || israelDateISO()));
      const { shifts, validation } = await getWeekValidation(weekStart);
      if (!shifts.length) throw httpError(409, 'אין שיבוצים בשבוע זה');
      if (validation.errors.length) throw httpError(409, 'לא ניתן לפרסם לפני טיפול בשגיאות התקינה', validation);
      const currentPublication = assertDb(await db().from('hadas_schedule_publications').select('*').eq('week_start', weekStart).maybeSingle(), 'לא ניתן לבדוק פרסום קודם');
      const revision = Number(currentPublication?.revision || 0) + 1;
      const now = new Date().toISOString();
      const weekEnd = addDays(weekStart, 5);
      assertDb(await db().from('hadas_shifts').update({ status: 'published' }).gte('shift_date', weekStart).lte('shift_date', weekEnd), 'לא ניתן לפרסם את השבוע');
      assertDb(await db().from('hadas_schedule_publications').upsert({ week_start: weekStart, revision, published_at: now, published_by: caller.employee.id, updated_at: now }, { onConflict: 'week_start' }), 'לא ניתן לשמור את הפרסום');
      assertDb(await db().from('hadas_schedule_changes').update({ published_revision: revision }).eq('week_start', weekStart).is('published_revision', 'null'), 'לא ניתן לסיים את רישום השינויים');
      assertDb(await db().from('hadas_schedule_acknowledgements').delete().eq('week_start', weekStart), 'לא ניתן לאפס אישורי קריאה');
      await audit(caller.employee.id, 'publish', 'schedule', weekStart, { revision, errors: 0, warnings: validation.warnings.length });
      const activeUsers = assertDb(await db().from('hadas_users').select('employee_id').eq('active', true), 'לא ניתן לטעון משתמשים לעדכון') || [];
      await notifyEmployees(activeUsers.map((row) => row.employee_id), {
        type:'schedule', title:'פורסם שיבוץ שבועי חדש',
        message:`השיבוץ לשבוע שמתחיל בתאריך ${weekStart} פורסם וזמין לצפייה.`,
        entityType:'schedule', entityId:weekStart,
      });
      await emitEvent('shifts');
      return send(res, 200, { ok: true, revision, publishedAt: now, validation });
    }

    if (req.method === 'POST' && body.action === 'copy_preview') {
      const weekStart = getSunday(String(body.week_start));
      const previousStart = addDays(weekStart, -7);
      const [previousR, existingR] = await Promise.all([
        db().from('hadas_shifts').select('*').gte('shift_date', previousStart).lte('shift_date', addDays(previousStart, 5)),
        db().from('hadas_shifts').select('*').gte('shift_date', weekStart).lte('shift_date', addDays(weekStart, 5)),
      ]);
      const previous = assertDb(previousR, 'לא ניתן לטעון שבוע קודם') || [];
      const existing = assertDb(existingR, 'לא ניתן לטעון את השבוע הנוכחי') || [];
      return send(res, 200, { ok: true, previousCount: previous.length, existingCount: existing.length, previousStart });
    }

    if (req.method === 'POST' && body.action === 'copy_previous') {
      const weekStart = getSunday(String(body.week_start));
      const mode = body.mode === 'merge' ? 'merge' : 'replace';
      const previousStart = addDays(weekStart, -7);
      const previous = assertDb(await db().from('hadas_shifts').select('*').gte('shift_date', previousStart).lte('shift_date', addDays(previousStart, 5)), 'לא ניתן לטעון שבוע קודם') || [];
      if (!previous.length) throw httpError(409, 'לא נמצאו שיבוצים בשבוע הקודם');
      let existing = assertDb(await db().from('hadas_shifts').select('*').gte('shift_date', weekStart).lte('shift_date', addDays(weekStart, 5)), 'לא ניתן לבדוק את השבוע') || [];
      if (mode === 'replace' && existing.length) {
        for (const shift of existing) await recordChange(caller, 'delete', shift, null);
        assertDb(await db().from('hadas_shifts').delete().gte('shift_date', weekStart).lte('shift_date', addDays(weekStart, 5)), 'לא ניתן לנקות את השבוע');
        existing = [];
      }
      const activeEmployees = assertDb(await db().from('hadas_employees').select('id').eq('active', true), 'לא ניתן לבדוק עובדים פעילים') || [];
      const activeIds = new Set(activeEmployees.map((row) => row.id));
      const rows = [];
      let skipped = 0;
      for (const shift of previous) {
        const row = {
          shift_date: addDays(shift.shift_date, 7),
          class_id: shift.class_id,
          employee_id: shift.employee_id,
          start_time: shift.start_time,
          end_time: shift.end_time,
          shift_role: shift.shift_role,
          status: 'draft',
          public_note: shift.public_note,
          created_by: caller.employee.id,
        };
        if (!activeIds.has(row.employee_id) || [...existing, ...rows].some((current) => rowsOverlap(current, row))) { skipped += 1; continue; }
        rows.push(row);
      }
      if (!rows.length) throw httpError(409, 'לא נמצאו שיבוצים שניתן להעתיק ללא התנגשות');
      const inserted = assertDb(await db().from('hadas_shifts').insert(rows).select('*'), 'לא ניתן להעתיק את השבוע') || [];
      for (const shift of inserted) await recordChange(caller, 'copy', null, shift);
      await audit(caller.employee.id, 'copy_previous', 'schedule', weekStart, { mode, count: inserted.length, skipped });
      await emitEvent('shifts');
      return send(res, 201, { ok: true, count: inserted.length, skipped });
    }

    if (req.method === 'POST') {
      const payload = {
        shift_date: String(body.shift_date || ''),
        class_id: body.class_id,
        employee_id: body.employee_id,
        start_time: body.start_time,
        end_time: body.end_time,
        shift_role: ['teacher', 'lead', 'staff', 'replacement'].includes(body.shift_role) ? body.shift_role : 'staff',
        status: 'draft',
        public_note: String(body.public_note || '').trim() || null,
        created_by: caller.employee.id,
      };
      await validateShift(payload, null, Boolean(body.override_day_off));
      const shift = assertDb(await db().from('hadas_shifts').insert(payload).select('*').single(), 'לא ניתן לשמור שיבוץ');
      await recordChange(caller, 'create', null, shift);
      await audit(caller.employee.id, 'create', 'shift', shift.id, payload);
      await emitEvent('shifts');
      return send(res, 201, { ok: true, shift });
    }

    if (req.method === 'PATCH') {
      const id = String(body.id || '');
      if (!id) throw httpError(400, 'חסר מזהה שיבוץ');
      const current = assertDb(await db().from('hadas_shifts').select('*').eq('id', id).maybeSingle(), 'השיבוץ לא נמצא');
      if (!current) throw httpError(404, 'השיבוץ לא נמצא');
      const payload = {
        shift_date: body.shift_date || current.shift_date,
        class_id: body.class_id || current.class_id,
        employee_id: body.employee_id || current.employee_id,
        start_time: body.start_time || current.start_time,
        end_time: body.end_time || current.end_time,
        shift_role: body.shift_role || current.shift_role,
        status: 'draft',
        public_note: body.public_note === undefined ? current.public_note : (String(body.public_note || '').trim() || null),
      };
      await validateShift(payload, id, Boolean(body.override_day_off));
      const updated = assertDb(await db().from('hadas_shifts').update(payload).eq('id', id).select('*').single(), 'לא ניתן לעדכן שיבוץ');
      await recordChange(caller, 'update', current, updated);
      await audit(caller.employee.id, 'update', 'shift', id, payload);
      await emitEvent('shifts');
      return send(res, 200, { ok: true, shift: updated });
    }

    if (req.method === 'DELETE') {
      const id = String(body.id || req.query?.id || '');
      if (!id) throw httpError(400, 'חסר מזהה שיבוץ');
      const current = assertDb(await db().from('hadas_shifts').select('*').eq('id', id).maybeSingle(), 'השיבוץ לא נמצא');
      if (!current) throw httpError(404, 'השיבוץ לא נמצא');
      await recordChange(caller, 'delete', current, null);
      assertDb(await db().from('hadas_shifts').delete().eq('id', id), 'לא ניתן למחוק שיבוץ');
      await audit(caller.employee.id, 'delete', 'shift', id, current);
      await emitEvent('shifts');
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) { handleError(res, error); }
};
