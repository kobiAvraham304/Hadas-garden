const {
  requireSession, parseBody, db, assertDb, emitEvent, audit,
  send, handleError, httpError, israelDateISO,
} = require('../lib/server');
const { validateWeek, timeToMinutes } = require('../lib/schedule');

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
  const [employeeR, classR, settingsR] = await Promise.all([
    db().from('hadas_employees').select('*').eq('id', payload.employee_id).maybeSingle(),
    db().from('hadas_classes').select('*').eq('id', payload.class_id).maybeSingle(),
    db().from('hadas_app_settings').select('*').eq('id', 1).maybeSingle(),
  ]);
  const employee = assertDb(employeeR, 'העובדת לא נמצאה');
  const classItem = assertDb(classR, 'הכיתה לא נמצאה');
  const settings = assertDb(settingsR, 'הגדרות המערכת לא נמצאו');
  if (!employee?.active) throw httpError(409, 'העובדת אינה פעילה');
  if (!classItem?.active) throw httpError(409, 'הכיתה אינה פעילה');
  if (timeToMinutes(payload.start_time) < timeToMinutes(settings.opening_time) || timeToMinutes(payload.end_time) > timeToMinutes(settings.closing_time)) {
    throw httpError(409, `השיבוץ חייב להיות בין ${String(settings.opening_time).slice(0, 5)} ל-${String(settings.closing_time).slice(0, 5)}`);
  }
  const constraintRows = assertDb(await db().from('hadas_employee_class_constraints').select('id,reason,valid_from,valid_to').eq('employee_id', payload.employee_id).eq('class_id', payload.class_id).eq('constraint_type', 'forbidden'), 'בדיקת אילוצים נכשלה') || [];
  const forbidden = constraintRows.find((item) => (!item.valid_from || item.valid_from <= payload.shift_date) && (!item.valid_to || item.valid_to >= payload.shift_date));
  if (forbidden) throw httpError(409, forbidden.reason ? `קיים איסור שיבוץ בכיתה: ${forbidden.reason}` : 'קיים איסור לשבץ את העובדת בכיתה זו');
  const day = new Date(`${payload.shift_date}T12:00:00Z`).getUTCDay();
  if (employee.fixed_day_off === day && !overrideDayOff) throw httpError(409, 'זהו היום החופשי הקבוע של העובדת. ניתן לשמור רק לאחר אישור חריגה');
  const existingQuery = db().from('hadas_shifts').select('id').eq('employee_id', payload.employee_id).eq('shift_date', payload.shift_date).lt('start_time', payload.end_time).gt('end_time', payload.start_time);
  if (id) existingQuery.neq('id', id);
  const overlaps = assertDb(await existingQuery, 'בדיקת חפיפה נכשלה') || [];
  if (overlaps.length) throw httpError(409, 'העובדת כבר משובצת בשעות חופפות');
  return { employee, classItem };
}

async function getWeekValidation(weekStart) {
  const weekEnd = addDays(weekStart, 5);
  const [shiftsR, classesR, employeesR, settingsR, constraintsR] = await Promise.all([
    db().from('hadas_shifts').select('*').gte('shift_date', weekStart).lte('shift_date', weekEnd),
    db().from('hadas_classes').select('*').eq('active', true),
    db().from('hadas_employees').select('*').eq('active', true),
    db().from('hadas_app_settings').select('*').eq('id', 1).single(),
    db().from('hadas_employee_class_constraints').select('*'),
  ]);
  const shifts = assertDb(shiftsR, 'לא ניתן לטעון שיבוצים') || [];
  return {
    shifts,
    validation: validateWeek({
      shifts,
      classes: assertDb(classesR, 'לא ניתן לטעון כיתות') || [],
      employees: assertDb(employeesR, 'לא ניתן לטעון עובדות') || [],
      settings: assertDb(settingsR, 'לא ניתן לטעון הגדרות') || {},
      constraints: assertDb(constraintsR, 'לא ניתן לטעון אילוצים') || [],
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

module.exports = async function handler(req, res) {
  try {
    const parsed = parseBody(req);
    const caller = await requireSession(req, { manager: req.method !== 'POST' || parsed.action !== 'ack' });
    const body = parsed;

    if (req.method === 'POST' && body.action === 'ack') {
      const weekStart = getSunday(String(body.week_start || israelDateISO()));
      assertDb(await db().from('hadas_schedule_acknowledgements').upsert({ employee_id: caller.employee.id, week_start: weekStart, acknowledged_at: new Date().toISOString() }, { onConflict: 'employee_id,week_start' }), 'לא ניתן לשמור אישור קריאה');
      await emitEvent('schedule_ack');
      return send(res, 200, { ok: true });
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
      const activeEmployees = assertDb(await db().from('hadas_employees').select('id').eq('active', true), 'לא ניתן לבדוק עובדות פעילות') || [];
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
