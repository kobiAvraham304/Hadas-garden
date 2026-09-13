const crypto = require('node:crypto');
const { db, assertDb, audit } = require('./server');

function validationApprovalKey(issue = {}) {
  const code = String(issue.code || '');
  const date = String(issue.date || '');
  const classId = String(issue.class_id || issue.classId || '');
  const employeeId = String(issue.employee_id || issue.employeeId || '');
  const stable = { code };
  if (['understaffed','missing_leader'].includes(code)) {
    stable.date = date;
    stable.class_id = classId;
  } else {
    if (date) stable.date = date;
    if (classId) stable.class_id = classId;
    if (employeeId) stable.employee_id = employeeId;
    stable.time = String(issue.time || issue.start_time || '');
    stable.end_time = String(issue.end_time || '');
    if (!date && !classId && !employeeId) stable.message = String(issue.message || issue.text || '');
  }
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 40);
}

function automaticApprovalMatchKey(issue = {}) {
  const code = String(issue.code || '');
  if (['understaffed','missing_leader'].includes(code)) return validationApprovalKey(issue);
  return [
    code, issue.date || '', issue.class_id || issue.classId || '', issue.employee_id || '',
    issue.start_time || issue.start || issue.time || '', issue.end_time || issue.end || '', issue.message || issue.text || '',
  ].join('|');
}

async function persistAutomaticApprovals({ weekStart, plan, approvedIssues, caller }) {
  const requested = Array.isArray(approvedIssues) ? approvedIssues : [];
  if (!requested.length) return [];
  const requestedKeys = new Set(requested.map(automaticApprovalMatchKey));
  const approvable = new Set(['understaffed', 'missing_leader']);
  const matched = (plan?.validation?.errors || []).filter((issue) => approvable.has(issue.code) && requestedKeys.has(automaticApprovalMatchKey(issue)));
  if (!matched.length) return [];
  const now = new Date().toISOString();
  const rows = matched.map((issue) => ({
    week_start: weekStart,
    issue_key: validationApprovalKey(issue),
    issue_snapshot: issue,
    approved_by: caller.employee.id,
    approved_at: now,
  }));
  assertDb(await db().from('hadas_schedule_issue_approvals').upsert(rows, { onConflict: 'week_start,issue_key' }), 'לא ניתן לשמור את אישורי החריגה מהשיבוץ האוטומטי');
  await audit(caller.employee.id, 'approve_auto_schedule_issues', 'schedule', weekStart, {
    count: rows.length,
    issue_keys: rows.map((row) => row.issue_key),
    codes: [...new Set(matched.map((issue) => issue.code))],
  });
  return rows.map((row) => row.issue_key);
}

module.exports = { validationApprovalKey, automaticApprovalMatchKey, persistAutomaticApprovals };
