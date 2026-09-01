const crypto = require('node:crypto');
const previousHandler = require('./shifts-v027');
const {
  requireSession, parseBody, db, assertDb, notifyEmployees, emitEvent, audit,
  send, handleError, httpError, israelDateISO,
} = require('./server');
const schedule = require('./schedule');
const { validateWeek } = schedule;
const validateWeekUnapproved = schedule.validateWeekUnapproved || validateWeek;

function addDays(dateString, days) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function getSunday(dateString) {
  const d = new Date(`${dateString}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) throw httpError(400, 'תאריך השבוע שנבחר אינו תקין');
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
function validationIssueKey(issue = {}) {
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
function decorateIssue(issue) {
  return { ...issue, approval_key: validationIssueKey(issue) };
}

async function rawWeekValidation(weekStart) {
  const weekEnd = addDays(weekStart, 5);
  const [shiftsR, classesR, employeesR, settingsR, constraintsR, patternsR, requestsR] = await Promise.all([
    db().from('hadas_shifts').select('*').gte('shift_date', weekStart).lte('shift_date', weekEnd),
    db().from('hadas_classes').select('*').eq('active', true),
    db().from('hadas_employees').select('*').eq('active', true),
    db().from('hadas_app_settings').select('*').eq('id', 1).single(),
    db().from('hadas_employee_class_constraints').select('*'),
    db().from('hadas_employee_weekly_patterns').select('*'),
    db().from('hadas_requests').select('requester_id,request_type,request_date,request_end_date,status').in('request_type', ['leave','day_off','sick']).in('status', ['approved','applied']).lte('request_date', weekEnd),
  ]);
  const shifts = assertDb(shiftsR, 'לא ניתן לטעון שיבוצים') || [];
  const validation = validateWeekUnapproved({
    shifts,
    classes: assertDb(classesR, 'לא ניתן לטעון כיתות') || [],
    employees: assertDb(employeesR, 'לא ניתן לטעון עובדים') || [],
    settings: assertDb(settingsR, 'לא ניתן לטעון הגדרות') || {},
    constraints: assertDb(constraintsR, 'לא ניתן לטעון אילוצים') || [],
    weeklyPatterns: assertDb(patternsR, 'לא ניתן לטעון ימי עבודה') || [],
    requests: (assertDb(requestsR, 'לא ניתן לטעון חופשות ומחלות') || []).filter((row) => String(row.request_end_date || row.request_date) >= weekStart),
    weekStart,
  });
  return { shifts, validation };
}

async function approvedKeys(weekStart) {
  const rows = assertDb(await db().from('hadas_schedule_issue_approvals').select('*').eq('week_start', weekStart), 'לא ניתן לטעון אישורי חריגה') || [];
  return { rows, keys: new Set(rows.map((row) => row.issue_key)) };
}

async function validationWithApprovals(weekStart) {
  const raw = await rawWeekValidation(weekStart);
  const approvals = await approvedKeys(weekStart);
  const rawErrors = (raw.validation.errors || []).map(decorateIssue);
  const rawWarnings = (raw.validation.warnings || []).map(decorateIssue);
  const approved = rawErrors.filter((item) => approvals.keys.has(item.approval_key)).map((item) => ({ ...item, approved: true }));
  return {
    shifts: raw.shifts,
    validation: {
      errors: rawErrors.filter((item) => !approvals.keys.has(item.approval_key)),
      warnings: rawWarnings,
      approved,
    },
  };
}

function captureResponse() {
  return {
    statusCode: 200, headers: {}, body: '',
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
    end(value = '') { this.body = value ?? ''; return this; },
  };
}
function replay(source, target, payload) {
  target.status(source.statusCode || 200);
  for (const [name, value] of Object.entries(source.headers || {})) target.setHeader(name, value);
  return target.end(payload === undefined ? source.body : JSON.stringify(payload));
}

async function publishWithApprovals(caller, weekStart) {
  const { shifts, validation } = await validationWithApprovals(weekStart);
  if (!shifts.length) throw httpError(409, 'אין שיבוצים בשבוע זה');
  if (validation.errors.length) throw httpError(409, 'לא ניתן לפרסם לפני טיפול בשגיאות התקינה או אישור מפורש שלהן', validation);
  const currentPublication = assertDb(await db().from('hadas_schedule_publications').select('*').eq('week_start', weekStart).maybeSingle(), 'לא ניתן לבדוק פרסום קודם');
  const revision = Number(currentPublication?.revision || 0) + 1;
  const now = new Date().toISOString();
  const weekEnd = addDays(weekStart, 5);
  assertDb(await db().from('hadas_shifts').update({ status: 'published' }).gte('shift_date', weekStart).lte('shift_date', weekEnd), 'לא ניתן לפרסם את השבוע');
  assertDb(await db().from('hadas_schedule_publications').upsert({ week_start: weekStart, revision, published_at: now, published_by: caller.employee.id, updated_at: now }, { onConflict: 'week_start' }), 'לא ניתן לשמור את הפרסום');
  assertDb(await db().from('hadas_schedule_changes').update({ published_revision: revision }).eq('week_start', weekStart).is('published_revision', 'null'), 'לא ניתן לסיים את רישום השינויים');
  assertDb(await db().from('hadas_schedule_acknowledgements').delete().eq('week_start', weekStart), 'לא ניתן לאפס אישורי קריאה');
  await audit(caller.employee.id, 'publish', 'schedule', weekStart, {
    revision,
    approved_validation_issues: validation.approved.length,
    warnings: validation.warnings.length,
  });
  const activeUsers = assertDb(await db().from('hadas_users').select('employee_id').eq('active', true), 'לא ניתן לטעון משתמשים לעדכון') || [];
  await notifyEmployees(activeUsers.map((row) => row.employee_id), {
    type: 'schedule', title: 'פורסם שיבוץ שבועי חדש',
    message: `השיבוץ לשבוע שמתחיל בתאריך ${weekStart} פורסם וזמין לצפייה.`,
    entityType: 'schedule', entityId: weekStart,
  });
  await emitEvent('shifts');
  return { revision, publishedAt: now, validation };
}

module.exports = async function shiftsV030(req, res) {
  try {
    const body = parseBody(req);
    const action = String(body.action || '');

    if (req.method === 'POST' && action === 'approve_issue') {
      const caller = await requireSession(req, { manager: true });
      const weekStart = getSunday(String(body.week_start || israelDateISO()));
      const key = String(body.approval_key || '');
      if (!key) throw httpError(400, 'חסר מזהה בעיית התקינות');
      const raw = await rawWeekValidation(weekStart);
      const issue = (raw.validation.errors || []).map(decorateIssue).find((item) => item.approval_key === key);
      if (!issue) throw httpError(409, 'הבעיה כבר אינה קיימת בשיבוץ הנוכחי. רעננו את בדיקות התקינות.');
      assertDb(await db().from('hadas_schedule_issue_approvals').upsert({
        week_start: weekStart,
        issue_key: key,
        issue_snapshot: issue,
        approved_by: caller.employee.id,
        approved_at: new Date().toISOString(),
      }, { onConflict: 'week_start,issue_key' }), 'לא ניתן לשמור אישור חריגה');
      await audit(caller.employee.id, 'approve_validation_issue', 'schedule', weekStart, { issue_key: key, code: issue.code, message: issue.message });
      await emitEvent('shifts');
      return send(res, 200, { ok: true, approval_key: key });
    }

    if (req.method === 'POST' && action === 'revoke_issue') {
      const caller = await requireSession(req, { manager: true });
      const weekStart = getSunday(String(body.week_start || israelDateISO()));
      const key = String(body.approval_key || '');
      if (!key) throw httpError(400, 'חסר מזהה אישור החריגה');
      assertDb(await db().from('hadas_schedule_issue_approvals').delete().eq('week_start', weekStart).eq('issue_key', key), 'לא ניתן לבטל את אישור החריגה');
      await audit(caller.employee.id, 'revoke_validation_issue', 'schedule', weekStart, { issue_key: key });
      await emitEvent('shifts');
      return send(res, 200, { ok: true, approval_key: key });
    }

    if (req.method === 'POST' && ['validate', 'publish_preview'].includes(action)) {
      const captured = captureResponse();
      await previousHandler(req, captured);
      if (captured.statusCode >= 400) return replay(captured, res);
      let payload;
      try { payload = JSON.parse(String(captured.body || '{}')); } catch { return replay(captured, res); }
      const weekStart = getSunday(String(body.week_start || israelDateISO()));
      const approvals = await approvedKeys(weekStart);
      const rawErrors = (payload.errors || []).map(decorateIssue);
      payload.errors = rawErrors.filter((item) => !approvals.keys.has(item.approval_key));
      payload.warnings = (payload.warnings || []).map(decorateIssue);
      payload.approved = rawErrors.filter((item) => approvals.keys.has(item.approval_key)).map((item) => ({ ...item, approved: true }));
      payload.weekStart = weekStart;
      return replay(captured, res, payload);
    }

    if (req.method === 'POST' && action === 'publish') {
      const caller = await requireSession(req, { manager: true });
      const weekStart = getSunday(String(body.week_start || israelDateISO()));
      const result = await publishWithApprovals(caller, weekStart);
      return send(res, 200, { ok: true, ...result });
    }

    return previousHandler(req, res);
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports.validationIssueKey = validationIssueKey;
module.exports.validationWithApprovals = validationWithApprovals;
module.exports.rawWeekValidation = rawWeekValidation;
