const {
  requireSession, isManager, scheduleScope, canViewFullSchedule, canCreateContent, db, assertDb, displayPhone, israelDateISO, send, handleError,
} = require('../lib/server');
const { dateRange } = require('../lib/schedule');

function plusDays(dateString, days) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getSunday(dateString) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

function calendarRange(monthValue) {
  const safe = /^\d{4}-\d{2}$/.test(String(monthValue || '')) ? `${monthValue}-01` : `${israelDateISO().slice(0, 7)}-01`;
  const firstMonthDay = new Date(`${safe}T12:00:00Z`);
  const start = new Date(firstMonthDay); start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const nextMonth = new Date(Date.UTC(firstMonthDay.getUTCFullYear(), firstMonthDay.getUTCMonth() + 1, 1, 12));
  const end = new Date(nextMonth); end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function sanitizeEmployee(employee, manager, usersByEmployee, privateByEmployee, patternsByEmployee) {
  const base = {
    id: employee.id,
    full_name: employee.full_name,
    job_title: employee.job_title,
    primary_class_id: employee.primary_class_id,
    can_lead: employee.can_lead,
    assignment_mode: employee.assignment_mode || (employee.primary_class_id ? 'fixed' : 'rotation'),
    is_schedulable: employee.is_schedulable !== false,
    active: employee.active,
  };
  if (!manager) return base;
  const user = usersByEmployee.get(employee.id);
  return {
    ...base,
    weekly_hours: employee.weekly_hours,
    max_weekly_hours: employee.max_weekly_hours,
    employment_percent: employee.employment_percent,
    default_start: employee.default_start,
    default_end: employee.default_end,
    fixed_day_off: employee.fixed_day_off,
    started_at: employee.started_at,
    ended_at: employee.ended_at,
    phone: user ? displayPhone(user.phone) : displayPhone(employee.contact_phone),
    role: user?.role || 'employee',
    user_active: user?.active ?? false,
    must_change_password: user?.must_change_password ?? true,
    admin_notes: privateByEmployee.get(employee.id)?.admin_notes || '',
    weekly_patterns: patternsByEmployee.get(employee.id) || [],
  };
}

function restoreLastPublished(currentRows, pendingChanges) {
  const result = new Map(currentRows.filter((row) => row.status === 'published').map((row) => [row.id, row]));
  for (const change of pendingChanges) {
    const before = change.before_data;
    if (before?.id && before.status === 'published' && !result.has(before.id)) result.set(before.id, before);
  }
  return [...result.values()].sort((a, b) => `${a.shift_date}-${a.start_time}`.localeCompare(`${b.shift_date}-${b.start_time}`));
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'Method not allowed' });
    const caller = await requireSession(req, { csrf: false });
    const manager = isManager(caller);
    const scope = scheduleScope(caller);
    const fullScheduleViewer = scope === 'full';
    const classScheduleViewer = scope === 'class';
    const contentCreator = canCreateContent(caller);
    const weekStart = getSunday(String(req.query?.week_start || israelDateISO()));
    const weekEnd = plusDays(weekStart, 5);
    const attendanceDate = String(req.query?.attendance_date || israelDateISO());
    const dailyDate = String(req.query?.daily_date || israelDateISO());
    const month = String(req.query?.calendar_month || israelDateISO().slice(0, 7));
    const calRange = calendarRange(month);
    const today = israelDateISO();
    const todayWeekStart = getSunday(today);

    const results = await Promise.all([
      db().from('hadas_classes').select('*').order('sort_order'),
      db().from('hadas_employees').select('*').order('full_name'),
      db().from('hadas_users').select('employee_id,phone,role,active,must_change_password'),
      db().from('hadas_employee_private').select('*'),
      db().from('hadas_employee_class_constraints').select('*'),
      db().from('hadas_employee_weekly_patterns').select('*').order('weekday'),
      db().from('hadas_app_settings').select('*').eq('id', 1).maybeSingle(),
      db().from('hadas_shifts').select('*').gte('shift_date', weekStart).lte('shift_date', weekEnd).order('shift_date').order('start_time'),
      db().from('hadas_attendance').select('*').eq('attendance_date', attendanceDate),
      db().from('hadas_requests').select('*').order('created_at', { ascending: false }).limit(500),
      db().from('hadas_schedule_acknowledgements').select('*').eq('week_start', weekStart),
      db().from('hadas_announcements').select('*').order('published_at', { ascending: false }).limit(200),
      db().from('hadas_announcement_recipients').select('*'),
      db().from('hadas_announcement_reads').select('*'),
      db().from('hadas_tasks').select('*').order('created_at', { ascending: false }).limit(300),
      db().from('hadas_task_assignees').select('*'),
      db().from('hadas_calendar_events').select('*').gte('event_date', calRange.start).lte('event_date', calRange.end).order('event_date').order('start_time'),
      db().from('hadas_shifts').select('*').eq('shift_date', today).order('start_time'),
      db().from('hadas_schedule_publications').select('*').eq('week_start', weekStart).maybeSingle(),
      db().from('hadas_schedule_changes').select('*').eq('week_start', weekStart).is('published_revision', 'null').order('created_at'),
      todayWeekStart === weekStart ? Promise.resolve({ data: [], error: null }) : db().from('hadas_schedule_changes').select('*').eq('week_start', todayWeekStart).is('published_revision', 'null').order('created_at'),
      manager ? db().from('hadas_daily_operations').select('*').eq('operation_date', dailyDate).order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
      manager ? db().from('hadas_shifts').select('*').eq('shift_date', dailyDate).order('start_time') : Promise.resolve({ data: [], error: null }),
      db().from('hadas_notifications').select('*').eq('employee_id', caller.employee.id).order('created_at', { ascending: false }).limit(150),
    ]);

    const [classesR, employeesR, usersR, privateR, constraintsR, weeklyPatternsR, settingsR, shiftsR, attendanceR, requestsR, ackR, announcementsR, recipientsR, readsR, tasksR, assigneesR, calendarR, todayShiftsR, publicationR, changesR, todayChangesR, dailyOperationsR, dailyShiftsR, notificationsR] = results;
    const classes = assertDb(classesR, 'לא ניתן לטעון כיתות') || [];
    const employeeRows = assertDb(employeesR, 'לא ניתן לטעון עובדים') || [];
    const userRows = assertDb(usersR, 'לא ניתן לטעון הרשאות') || [];
    const privateRows = assertDb(privateR, 'לא ניתן לטעון הערות ניהוליות') || [];
    const constraints = assertDb(constraintsR, 'לא ניתן לטעון אילוצים') || [];
    const weeklyPatterns = assertDb(weeklyPatternsR, 'לא ניתן לטעון ימי עבודה קבועים') || [];
    const settings = assertDb(settingsR, 'לא ניתן לטעון הגדרות') || {};
    let shifts = assertDb(shiftsR, 'לא ניתן לטעון שיבוצים') || [];
    let attendance = assertDb(attendanceR, 'לא ניתן לטעון נוכחות') || [];
    let requests = assertDb(requestsR, 'לא ניתן לטעון בקשות') || [];
    let acknowledgements = assertDb(ackR, 'לא ניתן לטעון אישורי קריאה') || [];
    let announcements = assertDb(announcementsR, 'לא ניתן לטעון הודעות') || [];
    let announcementRecipients = assertDb(recipientsR, 'לא ניתן לטעון מקבלי הודעות') || [];
    let reads = assertDb(readsR, 'לא ניתן לטעון קריאות') || [];
    let tasks = assertDb(tasksR, 'לא ניתן לטעון משימות') || [];
    let assignees = assertDb(assigneesR, 'לא ניתן לטעון משימות') || [];
    let calendar = assertDb(calendarR, 'לא ניתן לטעון לוח שנה') || [];
    let todayShifts = assertDb(todayShiftsR, 'לא ניתן לטעון את שיבוץ היום') || [];
    const publication = assertDb(publicationR, 'לא ניתן לטעון מצב פרסום') || null;
    const scheduleChanges = assertDb(changesR, 'לא ניתן לטעון שינויים') || [];
    const todayChanges = todayWeekStart === weekStart ? scheduleChanges : (assertDb(todayChangesR, 'לא ניתן לטעון שינויים') || []);
    const dailyOperations = assertDb(dailyOperationsR, 'לא ניתן לטעון תפעול יומי') || [];
    const dailyShifts = assertDb(dailyShiftsR, 'לא ניתן לטעון את שיבוץ התפעול היומי') || [];
    const notifications = assertDb(notificationsR, 'לא ניתן לטעון עדכונים') || [];

    const usersByEmployee = new Map(userRows.map((row) => [row.employee_id, row]));
    const privateByEmployee = new Map(privateRows.map((row) => [row.employee_id, row]));
    const patternsByEmployee = new Map();
    for (const pattern of weeklyPatterns) {
      if (!patternsByEmployee.has(pattern.employee_id)) patternsByEmployee.set(pattern.employee_id, []);
      patternsByEmployee.get(pattern.employee_id).push(pattern);
    }
    const employees = employeeRows.map((row) => sanitizeEmployee(row, manager, usersByEmployee, privateByEmployee, patternsByEmployee));

    // רשימה מצומצמת ובטוחה להצגת חופשות/היעדרויות לצד השיבוץ לכל הצוות.
    // לא נשלחים נימוקים, הערות מנהלת או מידע אישי אחר.
    const absenceMap = new Map();
    const absenceDates = new Set([...dateRange(weekStart, 6), today]);
    for (const request of requests) {
      if (!['approved', 'applied'].includes(request.status)) continue;
      if (!['leave', 'day_off', 'sick'].includes(request.request_type)) continue;
      const endDate = request.request_end_date || request.request_date;
      for (const cursor of absenceDates) {
        if (cursor < request.request_date || cursor > endDate) continue;
        absenceMap.set(`${request.requester_id}:${cursor}`, {
          employee_id: request.requester_id,
          absence_date: cursor,
          absence_type: request.request_type,
        });
      }
    }
    for (const pattern of weeklyPatterns.filter((row) => row.day_type === 'day_off')) {
      for (const date of absenceDates) {
        const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
        if (weekday !== Number(pattern.weekday)) continue;
        const key = `${pattern.employee_id}:${date}`;
        if (!absenceMap.has(key)) absenceMap.set(key, { employee_id: pattern.employee_id, absence_date: date, absence_type: 'day_off' });
      }
    }
    // תאימות לעובדים שטרם נשמרה עבורם תבנית שבועית חדשה.
    for (const employee of employeeRows.filter((row) => row.active && row.fixed_day_off !== null && row.fixed_day_off !== undefined && !patternsByEmployee.has(row.id))) {
      for (const date of absenceDates) {
        const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
        if (weekday !== Number(employee.fixed_day_off)) continue;
        const key = `${employee.id}:${date}`;
        if (!absenceMap.has(key)) absenceMap.set(key, { employee_id: employee.id, absence_date: date, absence_type: 'day_off' });
      }
    }
    if (!manager) {
      shifts = restoreLastPublished(shifts, scheduleChanges);
      todayShifts = restoreLastPublished(todayShifts, todayChanges);
      if (classScheduleViewer) {
        shifts = shifts.filter((row) => row.class_id === caller.employee.primary_class_id);
        todayShifts = todayShifts.filter((row) => row.class_id === caller.employee.primary_class_id);
      } else if (!fullScheduleViewer) {
        shifts = shifts.filter((row) => row.employee_id === caller.employee.id);
        todayShifts = todayShifts.filter((row) => row.employee_id === caller.employee.id);
      }
      attendance = attendance.filter((row) => row.employee_id === caller.employee.id);
      requests = requests.filter((row) => row.requester_id === caller.employee.id || row.target_employee_id === caller.employee.id);
      acknowledgements = acknowledgements.filter((row) => row.employee_id === caller.employee.id);
      reads = reads.filter((row) => row.employee_id === caller.employee.id || (contentCreator && announcements.some((a) => a.created_by === caller.employee.id && a.id === row.announcement_id)));

      const selectedAnnouncementIds = new Set(announcementRecipients.filter((row) => row.employee_id === caller.employee.id).map((row) => row.announcement_id));
      announcements = announcements.filter((row) => row.created_by === caller.employee.id || row.audience_type === 'all' || (row.audience_type === 'class' && row.class_id === caller.employee.primary_class_id) || (row.audience_type === 'employees' && selectedAnnouncementIds.has(row.id)));
      const visibleAnnouncementIds = new Set(announcements.map((row) => row.id));
      announcementRecipients = announcementRecipients.filter((row) => visibleAnnouncementIds.has(row.announcement_id) && (contentCreator || row.employee_id === caller.employee.id));

      const assignedTaskIds = new Set(assignees.filter((row) => row.employee_id === caller.employee.id).map((row) => row.task_id));
      const createdTaskIds = new Set(tasks.filter((row) => contentCreator && row.created_by === caller.employee.id).map((row) => row.id));
      tasks = tasks.filter((row) => row.active && (assignedTaskIds.has(row.id) || createdTaskIds.has(row.id)));
      assignees = assignees.filter((row) => row.employee_id === caller.employee.id || createdTaskIds.has(row.task_id));
      calendar = calendar.filter((row) => row.created_by === caller.employee.id || row.visibility === 'all' || (row.visibility === 'class' && row.class_id === caller.employee.primary_class_id));
    }

    if (classScheduleViewer) {
      const visibleIds = new Set(employeeRows.filter((row) => row.primary_class_id === caller.employee.primary_class_id).map((row) => row.id));
      for (const [key, value] of [...absenceMap.entries()]) if (!visibleIds.has(value.employee_id)) absenceMap.delete(key);
    } else if (!fullScheduleViewer) {
      for (const [key, value] of [...absenceMap.entries()]) if (value.employee_id !== caller.employee.id) absenceMap.delete(key);
    }
    const visibleScheduleAbsences = [...absenceMap.values()].sort((a, b) => `${a.absence_date}-${a.employee_id}`.localeCompare(`${b.absence_date}-${b.employee_id}`));
    requests = requests.map((request) => ({
      ...request,
      has_attachment: Boolean(request.attachment_path),
      attachment_path: undefined,
    }));

    const now = Date.now();
    announcements = announcements.filter((row) => {
      if (!row.active) return false;
      if (manager || row.created_by === caller.employee.id) return true;
      return Date.parse(row.published_at) <= now && (!row.expires_at || Date.parse(row.expires_at) >= now);
    });

    send(res, 200, {
      ok: true,
      profile: {
        id: caller.employee.id,
        full_name: caller.employee.full_name,
        job_title: caller.employee.job_title,
        primary_class_id: caller.employee.primary_class_id,
        can_lead: caller.employee.can_lead,
        role: caller.user.role,
        phone: displayPhone(caller.user.phone),
        must_change_password: caller.user.must_change_password,
        can_create_content: contentCreator,
        schedule_scope: scope,
        can_view_class_schedule: classScheduleViewer,
        can_view_full_schedule: fullScheduleViewer,
      },
      classes,
      employees,
      constraints: manager ? constraints : [],
      settings,
      shifts,
      todayShifts,
      attendance,
      requests,
      acknowledgements,
      announcements,
      announcementRecipients,
      announcementReads: reads,
      tasks,
      taskAssignees: assignees,
      calendarEvents: calendar,
      publication,
      scheduleChanges: manager ? scheduleChanges : [],
      scheduleAbsences: visibleScheduleAbsences,
      dailyOperations: manager ? dailyOperations : [],
      dailyShifts: manager ? dailyShifts : [],
      dailyDate,
      notifications,
      weekDates: dateRange(weekStart, 6),
    });
  } catch (error) { handleError(res, error); }
};
