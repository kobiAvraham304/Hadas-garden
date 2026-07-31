const {
  requireSession, isManager, db, assertDb, displayPhone, israelDateISO, send, handleError,
} = require('../lib/server');
const { dateRange } = require('../lib/schedule');

function plusDays(dateString, days) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0,10);
}

function sanitizeEmployee(employee, manager, usersByEmployee, privateByEmployee) {
  const base = {
    id:employee.id,
    full_name:employee.full_name,
    job_title:employee.job_title,
    primary_class_id:employee.primary_class_id,
    can_lead:employee.can_lead,
    active:employee.active,
  };
  if (manager) {
    const user = usersByEmployee.get(employee.id);
    return {
      ...base,
      weekly_hours:employee.weekly_hours,
      employment_percent:employee.employment_percent,
      default_start:employee.default_start,
      default_end:employee.default_end,
      fixed_day_off:employee.fixed_day_off,
      started_at:employee.started_at,
      ended_at:employee.ended_at,
      phone:user ? displayPhone(user.phone) : displayPhone(employee.contact_phone),
      role:user?.role || 'employee',
      user_active:user?.active ?? false,
      must_change_password:user?.must_change_password ?? true,
      admin_notes:privateByEmployee.get(employee.id)?.admin_notes || '',
    };
  }
  return base;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return send(res, 405, { ok:false, error:'Method not allowed' });
    const caller = await requireSession(req, { csrf:false });
    const manager = isManager(caller);
    const weekStart = String(req.query?.week_start || israelDateISO());
    const weekEnd = plusDays(weekStart, 5);
    const attendanceDate = String(req.query?.attendance_date || israelDateISO());
    const calendarStart = plusDays(weekStart, -31);
    const calendarEnd = plusDays(weekStart, 120);

    const queries = await Promise.all([
      db().from('hadas_classes').select('*').order('sort_order'),
      db().from('hadas_employees').select('*').order('full_name'),
      db().from('hadas_users').select('employee_id,phone,role,active,must_change_password'),
      db().from('hadas_employee_private').select('*'),
      db().from('hadas_employee_class_constraints').select('*'),
      db().from('hadas_app_settings').select('*').eq('id',1).maybeSingle(),
      db().from('hadas_shifts').select('*').gte('shift_date',weekStart).lte('shift_date',weekEnd).order('shift_date').order('start_time'),
      db().from('hadas_attendance').select('*').eq('attendance_date',attendanceDate),
      db().from('hadas_requests').select('*').order('created_at',{ ascending:false }).limit(500),
      db().from('hadas_schedule_acknowledgements').select('*').eq('week_start',weekStart),
      db().from('hadas_announcements').select('*').order('published_at',{ ascending:false }).limit(200),
      db().from('hadas_announcement_reads').select('*'),
      db().from('hadas_tasks').select('*').order('created_at',{ ascending:false }).limit(300),
      db().from('hadas_task_assignees').select('*'),
      db().from('hadas_calendar_events').select('*').gte('event_date',calendarStart).lte('event_date',calendarEnd).order('event_date'),
      db().from('hadas_documents').select('*').eq('active',true).order('created_at',{ ascending:false }).limit(200),
      db().from('hadas_shifts').select('*').eq('shift_date',israelDateISO()).order('start_time'),
    ]);
    const [classesR, employeesR, usersR, privateR, constraintsR, settingsR, shiftsR, attendanceR, requestsR, ackR, announcementsR, readsR, tasksR, assigneesR, calendarR, documentsR, todayShiftsR] = queries;
    const classes = assertDb(classesR, 'לא ניתן לטעון כיתות') || [];
    const employeeRows = assertDb(employeesR, 'לא ניתן לטעון עובדות') || [];
    const userRows = assertDb(usersR, 'לא ניתן לטעון הרשאות') || [];
    const privateRows = assertDb(privateR, 'לא ניתן לטעון הערות ניהוליות') || [];
    const constraints = assertDb(constraintsR, 'לא ניתן לטעון אילוצים') || [];
    const settings = assertDb(settingsR, 'לא ניתן לטעון הגדרות') || {};
    let shifts = assertDb(shiftsR, 'לא ניתן לטעון שיבוצים') || [];
    let attendance = assertDb(attendanceR, 'לא ניתן לטעון נוכחות') || [];
    let requests = assertDb(requestsR, 'לא ניתן לטעון בקשות') || [];
    let acknowledgements = assertDb(ackR, 'לא ניתן לטעון אישורי קריאה') || [];
    let announcements = assertDb(announcementsR, 'לא ניתן לטעון הודעות') || [];
    let reads = assertDb(readsR, 'לא ניתן לטעון קריאות') || [];
    let tasks = assertDb(tasksR, 'לא ניתן לטעון משימות') || [];
    let assignees = assertDb(assigneesR, 'לא ניתן לטעון משימות') || [];
    let calendar = assertDb(calendarR, 'לא ניתן לטעון לוח שנה') || [];
    let documents = assertDb(documentsR, 'לא ניתן לטעון מסמכים') || [];
    let todayShifts = assertDb(todayShiftsR, 'לא ניתן לטעון את שיבוץ היום') || [];

    const usersByEmployee = new Map(userRows.map((row) => [row.employee_id,row]));
    const privateByEmployee = new Map(privateRows.map((row) => [row.employee_id,row]));
    const employees = employeeRows.map((row) => sanitizeEmployee(row, manager, usersByEmployee, privateByEmployee));

    if (!manager) {
      shifts = shifts.filter((row) => row.status !== 'draft');
      todayShifts = todayShifts.filter((row) => row.status !== 'draft');
      attendance = attendance.filter((row) => row.employee_id === caller.employee.id);
      requests = requests.filter((row) => row.requester_id === caller.employee.id || row.target_employee_id === caller.employee.id);
      acknowledgements = acknowledgements.filter((row) => row.employee_id === caller.employee.id);
      reads = reads.filter((row) => row.employee_id === caller.employee.id);
      const myTaskIds = new Set(assignees.filter((row) => row.employee_id === caller.employee.id).map((row) => row.task_id));
      tasks = tasks.filter((row) => myTaskIds.has(row.id) && row.active);
      assignees = assignees.filter((row) => row.employee_id === caller.employee.id);
      calendar = calendar.filter((row) => row.visibility === 'all' || (row.visibility === 'class' && row.class_id === caller.employee.primary_class_id));
      documents = documents.filter((row) => row.visibility === 'all' || (row.visibility === 'class' && row.class_id === caller.employee.primary_class_id));
      announcements = announcements.filter((row) => row.active && (!row.class_id || row.class_id === caller.employee.primary_class_id));
    }

    const now = Date.now();
    announcements = announcements.filter((row) => {
      if (!row.active) return false;
      if (manager) return true;
      return Date.parse(row.published_at) <= now && (!row.expires_at || Date.parse(row.expires_at) >= now);
    });

    send(res, 200, {
      ok:true,
      profile:{
        id:caller.employee.id,
        full_name:caller.employee.full_name,
        job_title:caller.employee.job_title,
        primary_class_id:caller.employee.primary_class_id,
        can_lead:caller.employee.can_lead,
        role:caller.user.role,
        phone:displayPhone(caller.user.phone),
        must_change_password:caller.user.must_change_password,
      },
      classes,
      employees,
      constraints:manager ? constraints : [],
      settings,
      shifts,
      todayShifts,
      attendance,
      requests,
      acknowledgements,
      announcements,
      announcementReads:reads,
      tasks,
      taskAssignees:assignees,
      calendarEvents:calendar,
      documents,
      weekDates:dateRange(weekStart,6),
    });
  } catch (error) { handleError(res,error); }
};
