const previousHandler = require('./shifts-v030');
const {
  requireSession, parseBody, db, assertDb, audit, send, handleError, httpError, israelDateISO,
} = require('./server');
const { validationIssueKey } = require('./shifts-v030');

function getSunday(dateString) {
  const d = new Date(`${dateString}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) throw httpError(400, 'תאריך השבוע שנבחר אינו תקין');
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
function addDays(dateString, days) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function cleanKey(value) {
  const key = String(value || '').trim();
  if (!/^[a-f0-9]{40}$/i.test(key)) throw httpError(400, 'מזהה בעיית התקינות אינו תקין');
  return key;
}
function snapshotForKey(snapshot = {}) {
  return {
    code: String(snapshot.code || ''),
    date: String(snapshot.date || ''),
    class_id: String(snapshot.class_id || snapshot.classId || ''),
    employee_id: String(snapshot.employee_id || snapshot.employeeId || ''),
    time: String(snapshot.time || snapshot.start_time || ''),
    start_time: String(snapshot.start_time || ''),
    end_time: String(snapshot.end_time || ''),
    count: snapshot.count ?? null,
    expected: snapshot.expected ?? null,
    message: String(snapshot.message || snapshot.text || ''),
  };
}
function assertSnapshotInWeek(snapshot, weekStart) {
  if (!snapshot.date) return;
  const weekEnd = addDays(weekStart, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.date) || snapshot.date < weekStart || snapshot.date > weekEnd) {
    throw httpError(400, 'החריגה אינה שייכת לשבוע שנבחר');
  }
}
function normalizedApprovalIssues(body, weekStart) {
  const raw = Array.isArray(body.issues) ? body.issues : [];
  if (!raw.length) throw httpError(400, 'לא נבחרו חריגות לאישור');
  if (raw.length > 80) throw httpError(400, 'ניתן לאשר עד 80 חריגות בפעולה אחת');
  const unique = new Map();
  for (const item of raw) {
    const key = cleanKey(item?.approval_key);
    const snapshot = snapshotForKey(item?.snapshot || {});
    assertSnapshotInWeek(snapshot, weekStart);
    if (validationIssueKey(snapshot) !== key) throw httpError(409, 'פרטי החריגה השתנו. יש לרענן את בדיקות התקינות לפני האישור.');
    unique.set(key, snapshot);
  }
  return [...unique.entries()].map(([approval_key, snapshot]) => ({ approval_key, snapshot }));
}

async function approveIssues(caller, weekStart, issues) {
  const now = new Date().toISOString();
  const rows = issues.map((item) => ({
    week_start: weekStart,
    issue_key: item.approval_key,
    issue_snapshot: item.snapshot,
    approved_by: caller.employee.id,
    approved_at: now,
  }));
  assertDb(await db().from('hadas_schedule_issue_approvals').upsert(rows, { onConflict: 'week_start,issue_key' }), 'לא ניתן לשמור אישורי חריגה');
  await audit(caller.employee.id, 'approve_validation_issues', 'schedule', weekStart, {
    count: rows.length,
    issue_keys: rows.map((row) => row.issue_key),
    codes: [...new Set(issues.map((item) => item.snapshot.code).filter(Boolean))],
  });
  return rows.map((row) => row.issue_key);
}

async function revokeIssues(caller, weekStart, keys) {
  const clean = [...new Set((keys || []).map(cleanKey))];
  if (!clean.length) throw httpError(400, 'לא נבחרו אישורי חריגה לביטול');
  if (clean.length > 80) throw httpError(400, 'ניתן לבטל עד 80 אישורים בפעולה אחת');
  assertDb(await db().from('hadas_schedule_issue_approvals').delete().eq('week_start', weekStart).in('issue_key', clean), 'לא ניתן לבטל את אישורי החריגה');
  await audit(caller.employee.id, 'revoke_validation_issues', 'schedule', weekStart, { count: clean.length, issue_keys: clean });
  return clean;
}

module.exports = async function shiftsV032(req, res) {
  try {
    const body = parseBody(req);
    const action = String(body.action || '');

    if (req.method === 'POST' && action === 'approve_issues') {
      const caller = await requireSession(req, { manager: true });
      const weekStart = getSunday(String(body.week_start || israelDateISO()));
      const issues = normalizedApprovalIssues(body, weekStart);
      const approvedKeys = await approveIssues(caller, weekStart, issues);
      // No realtime shifts event: the schedule did not change. Publishing still revalidates
      // the complete current week and only exact deterministic issue keys are honored.
      return send(res, 200, { ok: true, week_start: weekStart, approved_keys: approvedKeys });
    }

    if (req.method === 'POST' && action === 'revoke_issues') {
      const caller = await requireSession(req, { manager: true });
      const weekStart = getSunday(String(body.week_start || israelDateISO()));
      const revokedKeys = await revokeIssues(caller, weekStart, body.approval_keys);
      return send(res, 200, { ok: true, week_start: weekStart, revoked_keys: revokedKeys });
    }

    return previousHandler(req, res);
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports.normalizedApprovalIssues = normalizedApprovalIssues;
module.exports.approveIssues = approveIssues;
module.exports.revokeIssues = revokeIssues;
