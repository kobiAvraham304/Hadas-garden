const { requireSession, parseBody, db, assertDb, send, handleError, httpError } = require('./server');
const { timeToMinutes } = require('./schedule');
const { rankCandidates, scoreCandidate, normalizeScore } = require('./matching');

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
function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')); }

function normalizeVirtualShifts(rows, weekStart, weekEnd) {
  if (rows === undefined || rows === null) return null;
  if (!Array.isArray(rows)) throw httpError(400, 'טיוטת השיבוץ לתיקון אינה תקינה');
  if (rows.length > 400) throw httpError(400, 'טיוטת השיבוץ גדולה מדי');
  return rows.map((row, index) => {
    const shiftDate = String(row?.shift_date || '');
    const classId = String(row?.class_id || '');
    const employeeId = String(row?.employee_id || '');
    const start = short(row?.start_time);
    const end = short(row?.end_time);
    const role = ['teacher','lead','staff','replacement'].includes(String(row?.shift_role || '')) ? String(row.shift_role) : 'staff';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(shiftDate) || shiftDate < weekStart || shiftDate > weekEnd) throw httpError(400, 'נמצא תאריך לא תקין בטיוטת השיבוץ');
    if (!isUuid(classId) || !isUuid(employeeId)) throw httpError(400, 'נמצא עובד או כיתה לא תקינים בטיוטת השיבוץ');
    if (!start || !end || timeToMinutes(end) <= timeToMinutes(start)) throw httpError(400, 'נמצא טווח שעות לא תקין בטיוטת השיבוץ');
    return {
      id: isUuid(row?.id) ? String(row.id) : `virtual-${index}`,
      shift_date: shiftDate,
      class_id: classId,
      employee_id: employeeId,
      start_time: start,
      end_time: end,
      shift_role: role,
      status: 'draft',
      public_note: row?.public_note ? String(row.public_note).slice(0, 500) : null,
      rule_override: Boolean(row?.rule_override),
    };
  });
}

module.exports = async function handler(req, res) {
  try {
    if (!['GET','POST'].includes(req.method)) return send(res, 405, { ok: false, error: 'Method not allowed' });
    await requireSession(req, req.method === 'GET' ? { manager: true, csrf: false } : { manager: true });
    const input = req.method === 'POST' ? parseBody(req) : (req.query || {});

    let date = String(input.date || '');
    let classId = String(input.class_id || '');
    let start = String(input.start_time || '07:30').slice(0, 5);
    let end = String(input.end_time || '15:30').slice(0, 5);
    let neededRole = String(input.shift_role || 'staff');
    const excludeShiftId = String(input.exclude_shift_id || '');
    const mode = excludeShiftId ? 'replace' : String(input.mode || 'add');

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

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !classId) throw httpError(400, 'חסרים תאריך או כיתה');
    if (timeToMinutes(end) <= timeToMinutes(start)) throw httpError(400, 'טווח השעות אינו תקין');

    const weekStart = sunday(date);
    const weekEnd = addDays(weekStart, 5);
    const virtualShifts = normalizeVirtualShifts(input.virtual_shifts, weekStart, weekEnd);
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

    const persistedShifts = assertDb(shiftsR, 'לא ניתן לטעון שיבוצים') || [];
    // בתיקון תצוגה מקדימה משתמשים בטיוטה שהמשתמש רואה כאילו כבר הוחלה.
    // כך עובד שכבר תפוס בטיוטה לא יוצע שוב, וגם מכסות/העברות מחושבות מול המצב העתידי.
    const shifts = virtualShifts || persistedShifts;
    const ranking = rankCandidates({
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

    const candidates = ranking.candidates;
    return send(res, 200, {
      ok: true,
      mode,
      preview_context: Boolean(virtualShifts),
      context: { date, class_id: classId, start_time: start, end_time: end, shift_role: neededRole, target_shift_id: targetShift?.id || null },
      candidates,
      rejected: ranking.rejected,
      summary: {
        total: candidates.length,
        recommended: candidates.filter((item) => item.recommended).length,
        direct: candidates.filter((item) => item.candidate_type === 'direct').length,
        transfers: candidates.filter((item) => item.candidate_type === 'transfer').length,
      },
    });
  } catch (error) { handleError(res, error); }
};

module.exports.rankCandidates = (context) => rankCandidates(context).candidates;
module.exports.rankCandidatesDetailed = rankCandidates;
module.exports.scoreCandidate = scoreCandidate;
module.exports.normalizeScore = normalizeScore;
module.exports.normalizeVirtualShifts = normalizeVirtualShifts;
