const legacyHandler = require('./shifts');
const {
  requireSession, parseBody, db, assertDb, send, handleError, httpError,
} = require('../lib/server');
const { timeToMinutes, closingTimeForDate } = require('../lib/schedule');
const { employeeCanLead } = require('./daily-operations');

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

function rpcData(result, fallback, status = 409) {
  if (result?.error) throw httpError(status, result.error.message || fallback, result.error);
  return result?.data;
}

async function validateShiftFast(payload, id, overrideDayOff = false, overrideRules = false) {
  if (!payload.shift_date || !payload.class_id || !payload.employee_id) throw httpError(400, 'חסרים פרטי שיבוץ');
  if (!payload.start_time || !payload.end_time || timeToMinutes(payload.end_time) <= timeToMinutes(payload.start_time)) throw httpError(400, 'שעות השיבוץ אינן תקינות');

  const weekStart = getSunday(payload.shift_date);
  const weekEnd = addDays(weekStart, 5);
  const overlapQuery = db().from('hadas_shifts').select('id').eq('employee_id', payload.employee_id).eq('shift_date', payload.shift_date).lt('start_time', payload.end_time).gt('end_time', payload.start_time);
  if (id) overlapQuery.neq('id', id);

  // כל בדיקות הנתונים נטענות בסבב מקביל אחד במקום מספר סבבים רצופים.
  const [employeeR, classR, settingsR, patternR, requestsR, overlapsR, weekRowsR, constraintsR] = await Promise.all([
    db().from('hadas_employees').select('*').eq('id', payload.employee_id).maybeSingle(),
    db().from('hadas_classes').select('*').eq('id', payload.class_id).maybeSingle(),
    db().from('hadas_app_settings').select('*').eq('id', 1).maybeSingle(),
    db().from('hadas_employee_weekly_patterns').select('*').eq('employee_id', payload.employee_id),
    db().from('hadas_requests').select('request_type,request_date,request_end_date,status').eq('requester_id', payload.employee_id).in('request_type', ['leave', 'day_off', 'sick']).in('status', ['approved', 'applied']).lte('request_date', payload.shift_date),
    overlapQuery,
    db().from('hadas_shifts').select('id,shift_date').eq('employee_id', payload.employee_id).gte('shift_date', weekStart).lte('shift_date', weekEnd),
    db().from('hadas_employee_class_constraints').select('id,reason,valid_from,valid_to').eq('employee_id', payload.employee_id).eq('class_id', payload.class_id).eq('constraint_type', 'forbidden'),
  ]);

  const employee = assertDb(employeeR, 'העובד לא נמצא');
  const classItem = assertDb(classR, 'הכיתה לא נמצאה');
  const settings = assertDb(settingsR, 'הגדרות המערכת לא נמצאו');
  const weeklyPatterns = assertDb(patternR, 'לא ניתן לבדוק את ימי העבודה הקבועים') || [];
  const requests = assertDb(requestsR, 'לא ניתן לבדוק חופשות') || [];
  const overlaps = assertDb(overlapsR, 'בדיקת חפיפה נכשלה') || [];
  const weekRows = assertDb(weekRowsR, 'בדיקת מספר ימי העבודה נכשלה') || [];
  const constraintRows = assertDb(constraintsR, 'בדיקת אילוצים נכשלה') || [];

  if (!employee?.active) throw httpError(409, 'העובד אינו פעיל');
  const title = String(employee.job_title || '');
  payload.shift_role = /(גננת|גנן)/.test(title) ? 'teacher' : (title === 'סייעת מובילה' || employee.can_lead ? 'lead' : 'staff');
  if (employee.is_schedulable === false) throw httpError(409, 'העובד אינו מוגדר כחלק ממערך השיבוצים');
  if (['teacher', 'lead'].includes(payload.shift_role) && !employeeCanLead(employee)) throw httpError(409, 'העובד אינו מורשה לשמש גננת/גנן או מוביל/ת כיתה');
  if (!classItem?.active) throw httpError(409, 'הכיתה אינה פעילה');

  const dayClosing = closingTimeForDate(settings, payload.shift_date);
  if (timeToMinutes(payload.start_time) < timeToMinutes(settings.opening_time) || timeToMinutes(payload.end_time) > timeToMinutes(dayClosing)) throw httpError(409, `השיבוץ חייב להיות בין ${String(settings.opening_time).slice(0, 5)} ל-${dayClosing}`);
  if (overlaps.length) throw httpError(409, 'העובד כבר משובץ בשעות חופפות');

  if (!overrideRules && Number.isInteger(Number(employee.max_work_days_per_week)) && Number(employee.max_work_days_per_week) > 0) {
    const relevant = weekRows.filter((row) => !id || row.id !== id);
    const dates = new Set(relevant.map((row) => row.shift_date));
    if (!dates.has(payload.shift_date) && dates.size >= Number(employee.max_work_days_per_week)) throw httpError(409, `לעובד הוגדר מקסימום ${employee.max_work_days_per_week} ימי עבודה בשבוע. ניתן לשמור רק כשיבוץ ידני חריג.`);
  }

  if (!overrideRules) {
    if (employee.job_title === 'גננת' && employee.primary_class_id && employee.primary_class_id !== payload.class_id) throw httpError(409, 'גננת ניתנת לשיבוץ רק בכיתה הקבועה שלה');
    const forbidden = constraintRows.find((item) => (!item.valid_from || item.valid_from <= payload.shift_date) && (!item.valid_to || item.valid_to >= payload.shift_date));
    if (forbidden) throw httpError(409, forbidden.reason ? `קיים איסור שיבוץ בכיתה: ${forbidden.reason}` : 'קיים איסור לשבץ את העובד בכיתה זו');
    const approvedAbsence = requests.find((row) => row.request_date <= payload.shift_date && payload.shift_date <= String(row.request_end_date || row.request_date));
    if (approvedAbsence) throw httpError(409, `לעובד יש ${approvedAbsence.request_type === 'sick' ? 'מחלה' : 'חופשה/יום חופשי'} מאושרים בתאריך זה`);
    const day = new Date(`${payload.shift_date}T12:00:00Z`).getUTCDay();
    const pattern = weeklyPatterns.find((row) => Number(row.weekday) === day);
    if (!pattern) throw httpError(409, 'היום אינו מוגדר בכרטיס העובד. יש לעדכן יום עבודה/חופשי/לפי צורך או לבחור שיבוץ ידני חריג');
    const fixedDayOff = pattern.day_type === 'day_off';
    if (fixedDayOff && !(overrideDayOff || overrideRules)) throw httpError(409, 'זהו יום חופשי קבוע של העובד. ניתן לשמור רק כשיבוץ ידני חריג');
    if (pattern.day_type === 'work' && (timeToMinutes(payload.start_time) < timeToMinutes(pattern.start_time) || timeToMinutes(payload.end_time) > timeToMinutes(pattern.end_time))) throw httpError(409, `השעות חורגות מהשעות הקבועות ${String(pattern.start_time).slice(0, 5)}–${String(pattern.end_time).slice(0, 5)}`);
  }

  return { employee, classItem };
}

function createPayload(body) {
  return {
    shift_date: String(body.shift_date || ''),
    class_id: body.class_id,
    employee_id: body.employee_id,
    start_time: body.start_time,
    end_time: body.end_time,
    shift_role: ['teacher', 'lead', 'staff', 'replacement'].includes(body.shift_role) ? body.shift_role : 'staff',
    status: 'draft',
    public_note: String(body.public_note || '').trim() || null,
    rule_override: Boolean(body.override_rules),
    rule_override_note: Boolean(body.override_rules) ? (String(body.override_reason || 'חריגה ידנית').trim().slice(0, 500) || 'חריגה ידנית') : null,
  };
}

async function saveThroughRpc(caller, id, payload) {
  const saved = rpcData(await db().rpc('hadas_save_shift_v025', {
    p_shift_id: id || null,
    p_payload: payload,
    p_actor_id: caller.employee.id,
  }), 'לא ניתן לשמור את השיבוץ');
  return saved?.shift || saved;
}

module.exports = async function handler(req, res) {
  const body = parseBody(req);
  const fastCreate = req.method === 'POST' && !body.action;
  const fastPatch = req.method === 'PATCH' && body.complete_payload === true;
  const moveAction = req.method === 'POST' && body.action === 'move';
  const clearAction = req.method === 'POST' && body.action === 'clear_week';

  if (!fastCreate && !fastPatch && !moveAction && !clearAction) return legacyHandler(req, res);

  try {
    const caller = await requireSession(req, { manager: true });

    if (clearAction) {
      const weekStart = getSunday(String(body.week_start || ''));
      if (!body.week_start || weekStart !== String(body.week_start)) throw httpError(400, 'תאריך השבוע שנבחר אינו תקין');
      const result = rpcData(await db().rpc('hadas_clear_schedule_week_v025', {
        p_week_start: weekStart,
        p_actor_id: caller.employee.id,
      }), 'לא ניתן לאפס את השיבוץ השבועי');
      return send(res, 200, { ok: true, count: Number(result?.count || 0), weekStart });
    }

    if (moveAction) {
      const id = String(body.id || '');
      if (!id || !body.shift_date || !body.class_id) throw httpError(400, 'חסרים פרטי ההעברה');
      const current = assertDb(await db().from('hadas_shifts').select('*').eq('id', id).maybeSingle(), 'השיבוץ לא נמצא');
      if (!current) throw httpError(404, 'השיבוץ לא נמצא');
      const payload = {
        shift_date: String(body.shift_date),
        class_id: String(body.class_id),
        employee_id: current.employee_id,
        start_time: current.start_time,
        end_time: current.end_time,
        shift_role: current.shift_role,
        status: 'draft',
        public_note: current.public_note ?? null,
        rule_override: Boolean(current.rule_override),
        rule_override_note: current.rule_override_note ?? null,
      };
      await validateShiftFast(payload, id, false, Boolean(payload.rule_override));
      const shift = await saveThroughRpc(caller, id, payload);
      return send(res, 200, { ok: true, shift, moved: true });
    }

    if (fastCreate) {
      const payload = createPayload(body);
      await validateShiftFast(payload, null, Boolean(body.override_day_off), Boolean(body.override_rules));
      const shift = await saveThroughRpc(caller, null, payload);
      return send(res, 201, { ok: true, shift, fast: true });
    }

    const id = String(body.id || '');
    if (!id) throw httpError(400, 'חסר מזהה שיבוץ');
    const payload = createPayload(body);
    await validateShiftFast(payload, id, Boolean(body.override_day_off), Boolean(body.override_rules));
    const shift = await saveThroughRpc(caller, id, payload);
    return send(res, 200, { ok: true, shift, fast: true });
  } catch (error) {
    handleError(res, error);
  }
};

module.exports.validateShiftFast = validateShiftFast;
module.exports.getSunday = getSunday;
