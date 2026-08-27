const { requireSession, db, assertDb, send, handleError, httpError } = require('../lib/server');
const { timeToMinutes } = require('../lib/schedule');
const { rankCandidates, scoreCandidate, normalizeScore } = require('../lib/matching');

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
