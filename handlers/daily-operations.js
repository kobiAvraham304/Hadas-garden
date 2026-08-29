const {
  requireSession, parseBody, db, assertDb, emitEvent, audit, notifyEmployees,
  send, handleError, httpError, israelDateISO,
} = require('../lib/server');
const { timeToMinutes } = require('../lib/schedule');
const {
  rankCandidates,
  sourceClassCanRelease,
  unavailableInRange,
  employeeCanLead,
} = require('../lib/matching');

const TYPES = new Set(['sick', 'absent', 'late', 'early_release', 'other']);
const REPLACEMENT_TYPES = new Set(['replacement', 'transfer']);

function minutes(value) { return timeToMinutes(String(value || '').slice(0, 5)); }
function sunday(dateString) { const d = new Date(`${dateString}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); }
function addDays(dateString, days) { const d = new Date(`${dateString}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function shortTime(value) { return value ? String(value).slice(0, 5) : null; }
function activeInRange(shift, start, end) { return minutes(shift.start_time) < minutes(end) && minutes(shift.end_time) > minutes(start); }

function affectedRange(operation, shift) {
  if (['sick', 'absent'].includes(operation.operation_type)) return { start: shortTime(shift.start_time), end: shortTime(shift.end_time) };
  if (operation.operation_type === 'late') return { start: shortTime(shift.start_time), end: shortTime(operation.start_time || shift.end_time) };
  if (operation.operation_type === 'early_release') return { start: shortTime(operation.end_time || shift.start_time), end: shortTime(shift.end_time) };
  return { start: shortTime(operation.start_time || shift.start_time), end: shortTime(operation.end_time || shift.end_time) };
}

async function loadContext(date) {
  const weekStart = sunday(date); const weekEnd = addDays(weekStart, 5);
  const [employeesR, shiftsR, requestsR, constraintsR, patternsR, settingsR, operationsR, attendanceR, classesR] = await Promise.all([
    db().from('hadas_employees').select('*').eq('active', true),
    db().from('hadas_shifts').select('*').gte('shift_date', weekStart).lte('shift_date', weekEnd),
    db().from('hadas_requests').select('*').in('request_type', ['leave', 'day_off', 'sick']).in('status', ['approved', 'applied']).lte('request_date', date),
    db().from('hadas_employee_class_constraints').select('*'),
    db().from('hadas_employee_weekly_patterns').select('*'),
    db().from('hadas_app_settings').select('*').eq('id', 1).single(),
    db().from('hadas_daily_operations').select('*').eq('operation_date', date),
    db().from('hadas_attendance').select('*').eq('attendance_date', date),
    db().from('hadas_classes').select('*').eq('active', true).order('sort_order'),
  ]);
  return {
    employees: assertDb(employeesR, 'לא ניתן לטעון עובדים') || [],
    shifts: assertDb(shiftsR, 'לא ניתן לטעון שיבוצים') || [],
    requests: (assertDb(requestsR, 'לא ניתן לטעון היעדרויות') || []).filter((row) => date <= String(row.request_end_date || row.request_date)),
    constraints: assertDb(constraintsR, 'לא ניתן לטעון העדפות') || [],
    patterns: assertDb(patternsR, 'לא ניתן לטעון ימים קבועים') || [],
    settings: assertDb(settingsR, 'לא ניתן לטעון תקינה') || {},
    operations: assertDb(operationsR, 'לא ניתן לטעון תפעול יומי') || [],
    attendance: assertDb(attendanceR, 'לא ניתן לטעון נוכחות') || [],
    classes: assertDb(classesR, 'לא ניתן לטעון כיתות') || [],
  };
}

function targetNeedsLeader(context, operation, shift, range) {
  if (context.settings?.require_leader === false || !['teacher', 'lead'].includes(shift.shift_role)) return false;
  const otherLeaders = (context.shifts || []).filter((row) => row.shift_date === operation.operation_date
    && row.class_id === operation.class_id && row.employee_id !== operation.employee_id
    && ['teacher', 'lead'].includes(row.shift_role) && activeInRange(row, range.start, range.end));
  return !otherLeaders.some((row) => !unavailableInRange(context, row.employee_id, operation.operation_date, range.start, range.end, operation.id));
}

function buildSuggestions(context, operation, shift) {
  const range = affectedRange(operation, shift);
  if (!range.start || !range.end || minutes(range.end) <= minutes(range.start)) return [];
  const needsLeader = targetNeedsLeader(context, operation, shift, range);
  const ranked = rankCandidates({
    ...context,
    date: operation.operation_date,
    classId: operation.class_id,
    start: range.start,
    end: range.end,
    neededRole: needsLeader ? (shift.shift_role || 'lead') : 'staff',
    excludedEmployeeId: operation.employee_id,
    excludeShiftId: shift.id,
  }).candidates;

  return ranked.slice(0, 24).map((candidate) => ({
    employee_id: candidate.employee_id,
    full_name: candidate.full_name,
    job_title: candidate.job_title,
    replacement_type: candidate.candidate_type === 'transfer' ? 'transfer' : 'replacement',
    from_class_id: candidate.from_class_id,
    from_class_name: candidate.from_class_name,
    start_time: range.start,
    end_time: range.end,
    score: candidate.score,
    reasons: candidate.reasons,
    cautions: candidate.cautions || [],
    recommended: candidate.recommended,
    recommendation_level: candidate.recommendation_level,
  }));
}

function validateReport(type, body, shift) {
  if (!TYPES.has(type)) throw httpError(400, 'סיבת ההיעדרות אינה תקינה');
  let start = body.start_time || null; let end = body.end_time || null;
  if (type === 'late') {
    if (!start || minutes(start) <= minutes(shift.start_time) || minutes(start) >= minutes(shift.end_time)) throw httpError(400, 'יש להזין שעת הגעה מאוחרת תקינה');
    end = shift.end_time;
  }
  if (type === 'early_release') {
    if (!end || minutes(end) <= minutes(shift.start_time) || minutes(end) >= minutes(shift.end_time)) throw httpError(400, 'יש להזין שעת שחרור מוקדם תקינה');
    start = shift.start_time;
  }
  if (['sick', 'absent'].includes(type)) { start = shift.start_time; end = shift.end_time; }
  if (type === 'other' && (!start || !end || minutes(end) <= minutes(start))) throw httpError(400, 'יש להזין טווח שעות תקין');
  return { start, end };
}

module.exports = async function handler(req, res) {
  try {
    const caller = await requireSession(req, { manager: true });
    const body = parseBody(req);
    if (req.method === 'GET') {
      const date = String(req.query?.date || israelDateISO());
      const weekStart=sunday(date);
      const [rowsR, shiftsR, attendanceR,publicationR] = await Promise.all([
        db().from('hadas_daily_operations').select('*').eq('operation_date', date).order('created_at', { ascending: false }),
        db().from('hadas_shifts').select('*').eq('shift_date', date).order('start_time'),
        db().from('hadas_attendance').select('*').eq('attendance_date', date),
        db().from('hadas_schedule_publications').select('week_start,revision,published_at,updated_at').eq('week_start',weekStart).maybeSingle(),
      ]);
      const shifts=assertDb(shiftsR, 'לא ניתן לטעון את שיבוץ היום') || [];
      const publication=assertDb(publicationR,'לא ניתן לטעון את מצב פרסום השיבוץ')||null;
      const scheduleMeta={week_start:weekStart,shift_count:shifts.length,draft_count:shifts.filter((row)=>row.status==='draft').length,published_count:shifts.filter((row)=>row.status==='published').length,latest_shift_update:shifts.reduce((latest,row)=>row.updated_at&&(!latest||String(row.updated_at)>latest)?String(row.updated_at):latest,null),publication_revision:publication?.revision||0,published_at:publication?.published_at||null};
      return send(res, 200, { ok: true, operations: assertDb(rowsR, 'לא ניתן לטעון תפעול יומי') || [], shifts, attendance: assertDb(attendanceR, 'לא ניתן לטעון נוכחות') || [], scheduleMeta, date });
    }
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
    const action = String(body.action || 'report');
    if (action === 'report') {
      const shift = assertDb(await db().from('hadas_shifts').select('*').eq('id', body.shift_id).maybeSingle(), 'השיבוץ לא נמצא');
      if (!shift) throw httpError(404, 'השיבוץ לא נמצא');
      const type = String(body.operation_type || ''); const { start, end } = validateReport(type, body, shift);
      const existing = assertDb(await db().from('hadas_daily_operations').select('*').eq('shift_id', shift.id).eq('operation_date', shift.shift_date).maybeSingle(), 'לא ניתן לבדוק דיווח קיים');
      if (existing) throw httpError(409, 'כבר קיים דיווח לשיבוץ הזה. אפשר לעדכן אותו דרך כרטיס האירוע בתפעול היומי.');
      const row = { operation_date: shift.shift_date, shift_id: shift.id, employee_id: shift.employee_id, class_id: shift.class_id, operation_type: type, start_time: start, end_time: end, note: String(body.note || '').trim() || null, status: 'open', source: 'manual', created_by: caller.employee.id };
      const operation = assertDb(await db().from('hadas_daily_operations').insert(row).select('*').single(), 'לא ניתן לשמור דיווח תפעולי');
      await audit(caller.employee.id, 'create', 'daily_operation', operation.id, row); await emitEvent('daily_operations');
      return send(res, 201, { ok: true, operation });
    }

    const operation = assertDb(await db().from('hadas_daily_operations').select('*').eq('id', body.id).maybeSingle(), 'הדיווח לא נמצא');
    if (!operation) throw httpError(404, 'הדיווח לא נמצא');
    const shift = assertDb(await db().from('hadas_shifts').select('*').eq('id', operation.shift_id).maybeSingle(), 'השיבוץ לא נמצא');
    if (!shift) throw httpError(404, 'השיבוץ לא נמצא');

    if (action === 'update_report') {
      const type = String(body.operation_type || operation.operation_type); const { start, end } = validateReport(type, body, shift);
      const update = { operation_type: type, start_time: start, end_time: end, note: String(body.note || '').trim() || null, source: 'manual', status: 'open', replacement_employee_id: null, replacement_from_class_id: null, replacement_type: null, replacement_start: null, replacement_end: null, resolved_by: null, resolved_at: null };
      const updated = assertDb(await db().from('hadas_daily_operations').update(update).eq('id', operation.id).select('*').single(), 'לא ניתן לעדכן את הדיווח');
      await audit(caller.employee.id, 'update', 'daily_operation', operation.id, update); await emitEvent('daily_operations'); return send(res, 200, { ok: true, operation: updated });
    }
    if (action === 'delete') {
      assertDb(await db().from('hadas_daily_operations').delete().eq('id', operation.id), 'לא ניתן למחוק את הדיווח');
      await audit(caller.employee.id, 'delete', 'daily_operation', operation.id, operation); await emitEvent('daily_operations'); return send(res, 200, { ok: true });
    }
    if (action === 'resolve_without_replacement') {
      const update = { status: 'resolved', replacement_employee_id: null, replacement_from_class_id: null, replacement_type: null, replacement_start: null, replacement_end: null, resolved_by: caller.employee.id, resolved_at: new Date().toISOString(), note: String(body.note || operation.note || '').trim() || null };
      assertDb(await db().from('hadas_daily_operations').update(update).eq('id', operation.id), 'לא ניתן לסגור את האירוע');
      await audit(caller.employee.id, 'resolve_without_replacement', 'daily_operation', operation.id, update); await emitEvent('daily_operations'); return send(res, 200, { ok: true });
    }

    const context = await loadContext(operation.operation_date);
    const suggestions = buildSuggestions(context, operation, shift);
    if (action === 'suggestions') return send(res, 200, { ok: true, suggestions, range: affectedRange(operation, shift) });
    if (action === 'assign') {
      const employeeId = String(body.employee_id || ''); const replacementType = String(body.replacement_type || '');
      if (!REPLACEMENT_TYPES.has(replacementType)) throw httpError(400, 'סוג ההחלפה אינו תקין');
      const chosen = suggestions.find((item) => item.employee_id === employeeId && item.replacement_type === replacementType);
      if (!chosen) throw httpError(409, 'העובד כבר אינו זמין להחלפה זו');
      const update = { replacement_employee_id: employeeId, replacement_from_class_id: chosen.from_class_id, replacement_type: replacementType, replacement_start: chosen.start_time, replacement_end: chosen.end_time, status: 'resolved', resolved_by: caller.employee.id, resolved_at: new Date().toISOString() };
      assertDb(await db().from('hadas_daily_operations').update(update).eq('id', operation.id), 'לא ניתן לשמור את ההחלפה');
      await notifyEmployees([employeeId], { type: 'daily_operation', title: 'שינוי תפעולי להיום', message: `נקבע עבורך ${replacementType === 'transfer' ? 'מעבר זמני' : 'שיבוץ החלפה'} לכיתה אחרת בין ${chosen.start_time}–${chosen.end_time}.`, entityType: 'daily_operation', entityId: operation.id, actionRequired: false });
      await audit(caller.employee.id, 'assign', 'daily_operation', operation.id, update); await emitEvent('daily_operations');
      return send(res, 200, { ok: true });
    }
    if (action === 'reopen') {
      assertDb(await db().from('hadas_daily_operations').update({ status: 'open', replacement_employee_id: null, replacement_from_class_id: null, replacement_type: null, replacement_start: null, replacement_end: null, resolved_by: null, resolved_at: null }).eq('id', operation.id), 'לא ניתן לפתוח מחדש');
      await emitEvent('daily_operations'); return send(res, 200, { ok: true });
    }
    throw httpError(400, 'פעולה לא נתמכת');
  } catch (error) { handleError(res, error); }
};

module.exports.buildSuggestions = buildSuggestions;
module.exports.sourceClassCanRelease = sourceClassCanRelease;
module.exports.affectedRange = affectedRange;
module.exports.unavailableInRange = unavailableInRange;
module.exports.targetNeedsLeader = targetNeedsLeader;
module.exports.employeeCanLead = employeeCanLead;
module.exports.loadContext = loadContext;
