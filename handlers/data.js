const {
  requireSession, isManager, scheduleScope, canViewFullSchedule, canCreateContent, canManageDailyOperations, db, assertDb, displayPhone, israelDateISO, send, handleError,
} = require('../lib/server');
const { dateRange, buildScheduleAvailability } = require('../lib/schedule');

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
    last_login_at: user?.last_login_at || null,
    onboarding_completed: Boolean(user?.onboarding_completed_at),
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
    const operationalManager = canManageDailyOperations(caller);
    const scope = scheduleScope(caller);
    const fullScheduleViewer = scope === 'full';
    const classScheduleViewer = scope === 'class';
    const dashboardOperationsViewer = operationalManager || fullScheduleViewer || classScheduleViewer;
    const contentCreator = canCreateContent(caller);
    const weekStart = getSunday(String(req.query?.week_start || israelDateISO()));
    const weekEnd = plusDays(weekStart, 5);
    const attendanceDate = String(req.query?.attendance_date || israelDateISO());
    const dailyDate = String(req.query?.daily_date || israelDateISO());
    const month = String(req.query?.calendar_month || israelDateISO().slice(0, 7));
    const calRange = calendarRange(month);
    const today = israelDateISO();
    const todayWeekStart = getSunday(today);
    const todayInSelectedWeek = todayWeekStart === weekStart;
    const dailyInSelectedWeek = getSunday(dailyDate) === weekStart;
    const dailyUsesAttendance = dailyDate === attendanceDate;

    const results = await Promise.all([
      db().from('hadas_classes').select('*').order('sort_order'),
      db().from('hadas_employees').select('*').order('full_name'),
      manager ? db().from('hadas_users').select('employee_id,phone,role,active,must_change_password,last_login_at,onboarding_completed_at') : Promise.resolve({ data: [], error: null }),
      manager ? db().from('hadas_employee_private').select('*') : Promise.resolve({ data: [], error: null }),
      manager ? db().from('hadas_employee_class_constraints').select('*') : Promise.resolve({ data: [], error: null }),
      db().from('hadas_employee_weekly_patterns').select('*').order('weekday'),
      db().from('hadas_app_settings').select('*').eq('id', 1).maybeSingle(),
      db().from('hadas_shifts').select('*').gte('shift_date', weekStart).lte('shift_date', weekEnd).order('shift_date').order('start_time'),
      db().from('hadas_attendance').select('*').eq('attendance_date', attendanceDate),
      attendanceDate === today ? Promise.resolve({ data:null, error:null }) : db().from('hadas_attendance').select('*').eq('attendance_date', today),
      db().from('hadas_requests').select('*').order('created_at', { ascending: false }).limit(500),
      db().from('hadas_request_messages').select('*').order('created_at').limit(1500),
      db().from('hadas_schedule_acknowledgements').select('*').eq('week_start', weekStart),
      db().from('hadas_announcements').select('*').order('published_at', { ascending: false }).limit(200),
      db().from('hadas_announcement_recipients').select('*'),
      db().from('hadas_announcement_reads').select('*'),
      Promise.resolve({ data: [], error: null }),
      Promise.resolve({ data: [], error: null }),
      db().from('hadas_calendar_events').select('*').gte('event_date', calRange.start).lte('event_date', calRange.end).order('event_date').order('start_time'),
      todayInSelectedWeek ? Promise.resolve({ data: [], error: null }) : db().from('hadas_shifts').select('*').eq('shift_date', today).order('start_time'),
      manager ? db().from('hadas_schedule_publications').select('*').eq('week_start', weekStart).maybeSingle() : Promise.resolve({ data:null, error:null }),
      db().from('hadas_schedule_changes').select('*').eq('week_start', weekStart).is('published_revision', 'null').order('created_at'),
      todayInSelectedWeek ? Promise.resolve({ data: [], error: null }) : db().from('hadas_schedule_changes').select('*').eq('week_start', todayWeekStart).is('published_revision', 'null').order('created_at'),
      operationalManager ? db().from('hadas_daily_operations').select('*').eq('operation_date', dailyDate).order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
      dailyDate === today && operationalManager
        ? Promise.resolve({ data:null, error:null })
        : dashboardOperationsViewer
          ? db().from('hadas_daily_operations').select('*').eq('operation_date', today).order('created_at', { ascending: false })
          : Promise.resolve({ data:[], error:null }),
      operationalManager && !dailyInSelectedWeek ? db().from('hadas_shifts').select('*').eq('shift_date', dailyDate).order('start_time') : Promise.resolve({ data: [], error: null }),
      operationalManager && !dailyUsesAttendance ? db().from('hadas_attendance').select('*').eq('attendance_date', dailyDate) : Promise.resolve({ data: [], error: null }),
      db().from('hadas_notifications').select('*').eq('employee_id', caller.employee.id).order('created_at', { ascending: false }).limit(150),
      operationalManager && !(manager && dailyInSelectedWeek)
        ? db().from('hadas_schedule_publications').select('week_start,revision,published_at,updated_at').eq('week_start', getSunday(dailyDate)).maybeSingle()
        : Promise.resolve({ data:null, error:null }),
    ]);

    const [classesR, employeesR, usersR, privateR, constraintsR, weeklyPatternsR, settingsR, shiftsR, attendanceR, todayAttendanceR, requestsR, requestMessagesR, ackR, announcementsR, recipientsR, readsR, tasksR, assigneesR, calendarR, todayShiftsR, publicationR, changesR, todayChangesR, dailyOperationsR, todayOperationsR, dailyShiftsR, dailyAttendanceR, notificationsR, dailyPublicationR] = results;
    const classes = assertDb(classesR, 'לא ניתן לטעון כיתות') || [];
    const employeeRows = assertDb(employeesR, 'לא ניתן לטעון עובדים') || [];
    const userRows = assertDb(usersR, 'לא ניתן לטעון הרשאות') || [];
    const privateRows = assertDb(privateR, 'לא ניתן לטעון הערות ניהוליות') || [];
    const constraints = assertDb(constraintsR, 'לא ניתן לטעון אילוצים') || [];
    const weeklyPatterns = assertDb(weeklyPatternsR, 'לא ניתן לטעון ימי עבודה קבועים') || [];
    const settings = assertDb(settingsR, 'לא ניתן לטעון הגדרות') || {};
    let shifts = assertDb(shiftsR, 'לא ניתן לטעון שיבוצים') || [];
    let attendance = assertDb(attendanceR, 'לא ניתן לטעון נוכחות') || [];
    let todayAttendance = attendanceDate === today ? [...attendance] : (assertDb(todayAttendanceR, 'לא ניתן לטעון את נוכחות היום') || []);
    let requests = assertDb(requestsR, 'לא ניתן לטעון בקשות') || [];
    let requestMessages = assertDb(requestMessagesR, 'לא ניתן לטעון תגובות לבקשות') || [];
    const allRequestsForCalendar=[...requests];
    let acknowledgements = assertDb(ackR, 'לא ניתן לטעון אישורי קריאה') || [];
    let announcements = assertDb(announcementsR, 'לא ניתן לטעון הודעות') || [];
    let announcementRecipients = assertDb(recipientsR, 'לא ניתן לטעון מקבלי הודעות') || [];
    let reads = assertDb(readsR, 'לא ניתן לטעון קריאות') || [];
    let tasks = assertDb(tasksR, 'לא ניתן לטעון משימות') || [];
    let assignees = assertDb(assigneesR, 'לא ניתן לטעון משימות') || [];
    let calendar = assertDb(calendarR, 'לא ניתן לטעון לוח שנה') || [];
    let todayShifts = todayInSelectedWeek ? shifts.filter((row) => row.shift_date === today) : (assertDb(todayShiftsR, 'לא ניתן לטעון את שיבוץ היום') || []);
    const publication = assertDb(publicationR, 'לא ניתן לטעון מצב פרסום') || null;
    const scheduleChanges = assertDb(changesR, 'לא ניתן לטעון שינויים') || [];
    const todayChanges = todayInSelectedWeek ? scheduleChanges : (assertDb(todayChangesR, 'לא ניתן לטעון שינויים') || []);
    const dailyOperations = assertDb(dailyOperationsR, 'לא ניתן לטעון תפעול יומי') || [];
    let todayOperations = dailyDate === today && operationalManager
      ? [...dailyOperations]
      : (assertDb(todayOperationsR, 'לא ניתן לטעון את תפעול היום') || []);
    const dailyShifts = operationalManager ? (dailyInSelectedWeek ? shifts.filter((row) => row.shift_date === dailyDate) : (assertDb(dailyShiftsR, 'לא ניתן לטעון את שיבוץ התפעול היומי') || [])) : [];
    const dailyAttendance = operationalManager ? (dailyUsesAttendance ? attendance : (assertDb(dailyAttendanceR, 'לא ניתן לטעון את נוכחות התפעול היומי') || [])) : [];
    const dailyPublication = operationalManager
      ? (manager && dailyInSelectedWeek ? publication : (assertDb(dailyPublicationR, 'לא ניתן לטעון את מצב פרסום השיבוץ היומי') || null))
      : null;
    const dailyScheduleMeta = operationalManager ? {
      week_start: getSunday(dailyDate),
      shift_count: dailyShifts.length,
      draft_count: dailyShifts.filter((row) => row.status === 'draft').length,
      published_count: dailyShifts.filter((row) => row.status === 'published').length,
      latest_shift_update: dailyShifts.reduce((latest, row) => row.updated_at && (!latest || String(row.updated_at) > latest) ? String(row.updated_at) : latest, null),
      publication_revision: dailyPublication?.revision || 0,
      published_at: dailyPublication?.published_at || null,
    } : null;
    const notifications = assertDb(notificationsR, 'לא ניתן לטעון עדכונים') || [];

    const usersByEmployee = new Map(userRows.map((row) => [row.employee_id, row]));
    const privateByEmployee = new Map(privateRows.map((row) => [row.employee_id, row]));
    const patternsByEmployee = new Map();
    for (const pattern of weeklyPatterns) {
      if (!patternsByEmployee.has(pattern.employee_id)) patternsByEmployee.set(pattern.employee_id, []);
      patternsByEmployee.get(pattern.employee_id).push(pattern);
    }
    const employees = employeeRows.map((row) => sanitizeEmployee(row, manager, usersByEmployee, privateByEmployee, patternsByEmployee));

    // רשימה מצומצמת ובטוחה להצגת זמינות לצד השיבוץ. לא נשלחים נימוקים
    // או פרטים אישיים, אך כן מוצגים ימי חופש קבועים גם כשאין חריגה.
    const absenceDates = [...new Set([...dateRange(weekStart, 6), today])];
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
      const visibleTodayShiftIds = new Set(todayShifts.map((row) => row.id));
      todayAttendance = todayAttendance.filter((row) => visibleTodayShiftIds.has(row.shift_id) || row.employee_id === caller.employee.id);
      todayOperations = dashboardOperationsViewer ? todayOperations.filter((row) => {
        if (visibleTodayShiftIds.has(row.shift_id)) return true;
        return classScheduleViewer && (row.class_id === caller.employee.primary_class_id || row.replacement_from_class_id === caller.employee.primary_class_id);
      }) : [];
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

    const visibleRequestIds=new Set(requests.map((row)=>row.id));requestMessages=requestMessages.filter((row)=>visibleRequestIds.has(row.request_id));
    const visibleShiftPool=[...shifts,...todayShifts];
    const absenceMap = new Map((fullScheduleViewer ? buildScheduleAvailability({ requests:allRequestsForCalendar, employees:employeeRows, weeklyPatterns, shifts:visibleShiftPool, weekStart, dates:absenceDates }) : []).map((row)=>[`${row.employee_id}:${row.absence_date}`,row]));
    const calendarVisibleLeave=(employee)=>manager||fullScheduleViewer||(classScheduleViewer&&employee?.primary_class_id===caller.employee.primary_class_id)||employee?.id===caller.employee.id;
    for(const request of allRequestsForCalendar){if(!['approved','applied'].includes(request.status)||request.request_type!=='leave')continue;const employee=employeeRows.find((row)=>row.id===request.requester_id);if(!employee||!calendarVisibleLeave(employee))continue;const end=request.request_end_date||request.request_date;for(const date of dateRange(request.request_date,Math.floor((new Date(`${end}T12:00:00Z`)-new Date(`${request.request_date}T12:00:00Z`))/86400000)+1)){if(date<calRange.start||date>calRange.end)continue;calendar.push({id:`leave:${request.id}:${date}`,title:employee.id===caller.employee.id?'חופשה מאושרת':`חופשה · ${employee.full_name}`,description:'חופשה מאושרת במערכת הבקשות',event_type:'approved_leave',event_date:date,start_time:null,end_time:null,visibility:'leave_request',class_id:employee.primary_class_id,created_by:null,source:'approved_leave',request_id:request.id,employee_id:employee.id,read_only:true});}}
    calendar.sort((a,b)=>`${a.event_date}-${a.start_time||''}-${a.title||''}`.localeCompare(`${b.event_date}-${b.start_time||''}-${b.title||''}`,'he'));

    const visibleScheduleAbsences = fullScheduleViewer
      ? [...absenceMap.values()].sort((a, b) => `${a.absence_date}-${a.employee_id}`.localeCompare(`${b.absence_date}-${b.employee_id}`))
      : [];
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

    // אל תשלח לסייעת רגילה ספר עובדים מלא. לתצוגת כיתה נשלחים רק חברי
    // הכיתה, ובכל תצוגה נשמרים מחברי הודעות/אירועים שנחוצים להצגת השם.
    const visibleEmployeeIds = new Set([
      caller.employee.id,
      ...shifts.map((row) => row.employee_id),
      ...todayShifts.map((row) => row.employee_id),
      ...announcements.map((row) => row.created_by),
      ...calendar.map((row) => row.created_by),
    ].filter(Boolean));
    if (classScheduleViewer) {
      employeeRows.filter((row) => row.primary_class_id === caller.employee.primary_class_id).forEach((row) => visibleEmployeeIds.add(row.id));
    }
    const visibleEmployees = manager || fullScheduleViewer
      ? employees
      : employees.filter((employee) => visibleEmployeeIds.has(employee.id));

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
        can_manage_daily_operations: operationalManager,
        fixed_day_off: caller.employee.fixed_day_off,
        weekly_patterns: patternsByEmployee.get(caller.employee.id) || [],
        onboarding_completed: Boolean(caller.user.onboarding_completed_at),
        onboarding_required: !caller.user.onboarding_completed_at,
      },
      classes,
      employees: visibleEmployees,
      constraints: manager ? constraints : [],
      settings,
      shifts,
      todayShifts,
      attendance,
      todayAttendance,
      todayOperations,
      requests,
      requestMessages: requestMessages.map((row)=>({...row,author_name:employeeRows.find((e)=>e.id===row.author_id)?.full_name||'עובד',author_is_manager:userRows.some((u)=>u.employee_id===row.author_id&&['admin','scheduler'].includes(u.role))})),
      acknowledgements,
      announcements,
      announcementRecipients,
      announcementReads: reads,
      tasks,
      taskAssignees: assignees,
      calendarEvents: calendar,
      publication: manager ? publication : null,
      scheduleChanges: manager ? scheduleChanges : [],
      scheduleAbsences: visibleScheduleAbsences,
      dailyOperations: operationalManager ? dailyOperations : [],
      dailyShifts: operationalManager ? dailyShifts : [],
      dailyAttendance: operationalManager ? dailyAttendance : [],
      dailyScheduleMeta,
      dailyDate,
      notifications,
      weekDates: dateRange(weekStart, 6),
    });
  } catch (error) { handleError(res, error); }
};
