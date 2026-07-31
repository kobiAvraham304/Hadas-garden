/* מערכת ניהול שיבוצים מעון הדס — גרסה 0.5.0 */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const ROLE_LABELS = { admin: 'מנהלת מעון', scheduler: 'אחראית שיבוץ', employee: 'עובדת' };
const SHIFT_ROLE_LABELS = { teacher: 'גננת', lead: 'מובילה', staff: 'אשת צוות', replacement: 'מחליפה' };
const SHIFT_STATUS_LABELS = { draft: 'ממתין לפרסום', published: 'פורסם' };
const REQUEST_LABELS = { leave: 'חופשה', day_off: 'יום חופשי', late_start: 'התחלה מאוחרת', early_finish: 'סיום מוקדם', sick: 'מחלה', swap: 'החלפת שיבוץ', other: 'בקשה אחרת' };
const REQUEST_STATUS_LABELS = { pending: 'ממתינה', approved: 'אושרה', rejected: 'נדחתה', applied: 'הוזרמה', cancelled: 'בוטלה' };
const REQUEST_ICONS = { leave: '☀', day_off: '⌂', late_start: '◷', early_finish: '◴', sick: '✚', swap: '↔', other: '✎' };
const ATTENDANCE_LABELS = { scheduled: 'טרם עודכן', present: 'נכחה', late: 'איחרה', left_early: 'יצאה מוקדם', absent: 'נעדרה', sick: 'מחלה', replacement: 'החליפה עובדת' };
const EVENT_LABELS = { holiday: 'חופשה/חג', meeting: 'ישיבה', training: 'הדרכה', birthday: 'יום הולדת', activity: 'פעילות', other: 'אחר' };
const EVENT_ICONS = { holiday: '☀', meeting: '◉', training: '✦', birthday: '🎈', activity: '★', other: '●' };
const PRIORITY_LABELS = { normal: 'רגילה', important: 'חשובה', urgent: 'דחופה' };
const CHANGE_LABELS = { create: 'שיבוץ חדש', update: 'שיבוץ השתנה', delete: 'שיבוץ נמחק', copy: 'הועתק משבוע קודם' };

function storageGet(kind, key, fallback = '') { try { return window[kind]?.getItem(key) ?? fallback; } catch { return fallback; } }
function storageSet(kind, key, value) { try { window[kind]?.setItem(key, String(value)); } catch {} }

const state = {
  config: null,
  realtimeClient: null,
  csrfToken: '',
  profile: null,
  classes: [],
  employees: [],
  constraints: [],
  settings: {},
  shifts: [],
  todayShifts: [],
  attendance: [],
  requests: [],
  acknowledgements: [],
  announcements: [],
  announcementRecipients: [],
  announcementReads: [],
  tasks: [],
  taskAssignees: [],
  calendarEvents: [],
  publication: null,
  scheduleChanges: [],
  weekStart: startOfWeek(new Date()),
  attendanceDate: dateISO(new Date()),
  calendarMonth: monthStart(new Date()),
  realtimeChannel: null,
  reloadTimer: null,
  pollTimer: null,
  suggestionsContext: null,
  lastRefreshAt: 0,
  refreshing: false,
  activeTab: storageGet('sessionStorage', 'hadas-active-tab', 'dashboard'),
  scheduleMode: storageGet('localStorage', 'hadas-schedule-mode', '') || (matchMedia('(max-width:760px)').matches ? 'day' : 'week'),
  scheduleDay: Number(storageGet('localStorage', 'hadas-schedule-day', String(Math.min(new Date().getDay(), 5)))),
  requestStatusFilter: 'open',
  requestSearch: '',
  employeeStatusFilter: 'active',
  employeeSearch: '',
  employeeClassFilter: 'all',
  employeeTypeFilter: 'all',
};

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function dateISO(date) { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseDateValue(value) { if (value instanceof Date) return value; if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T12:00:00`); return new Date(value); }
function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
function addMonths(date, months) { const d = new Date(date); d.setDate(1); d.setMonth(d.getMonth() + months); return d; }
function startOfWeek(date) { const d = new Date(date); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d; }
function monthStart(date) { const d = new Date(date); d.setHours(12, 0, 0, 0); d.setDate(1); return d; }
function monthParam(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function formatDate(value, options = { day: '2-digit', month: '2-digit', year: 'numeric' }) { const parsed = parseDateValue(value); return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('he-IL', options).format(parsed); }
function trimTime(value) { return value ? String(value).slice(0, 5) : ''; }
function timeHtml(start, end) { return `<bdi class="time-value">${escapeHtml(trimTime(start) || '—')}${end ? `–${escapeHtml(trimTime(end))}` : ''}</bdi>`; }
function timeToMinutes(value) { if (!value) return 0; const [h, m] = String(value).slice(0, 5).split(':').map(Number); return h * 60 + m; }
function overlaps(aStart, aEnd, bStart, bEnd) { return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(aEnd) > timeToMinutes(bStart); }
function initials(name) { return String(name || '').trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join(''); }
function isManager() { return ['admin', 'scheduler'].includes(state.profile?.role); }
function canCreateContent() { return Boolean(state.profile?.can_create_content || isManager() || /גננ/.test(String(state.profile?.job_title || ''))); }
function employeeById(id) { return state.employees.find((item) => item.id === id); }
function classById(id) { return state.classes.find((item) => item.id === id); }
function currentWeekDates() { return Array.from({ length: 6 }, (_, index) => addDays(state.weekStart, index)); }
function showToast(message, type = '') { const toast = $('#toast'); toast.textContent = message; toast.className = `toast ${type}`.trim(); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.add('hidden'), 3800); }
function setScreen(id) { for (const screen of ['loadingScreen', 'loginScreen', 'passwordScreen', 'appShell']) $(`#${screen}`).classList.toggle('hidden', screen !== id); }
function setBusy(button, busy, text = 'שומרת…') { if (!button) return; if (busy) { button.dataset.originalText = button.textContent; button.disabled = true; button.textContent = text; } else { button.disabled = false; button.textContent = button.dataset.originalText || button.textContent; } }
function formObject(form) { return Object.fromEntries(new FormData(form).entries()); }
function toIsoDateTime(local) { return local ? new Date(local).toISOString() : null; }
function debounce(fn, delay = 180) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); }; }

function setSyncState(kind, text) {
  const live = $('#liveStatus');
  if (!live) return;
  live.dataset.state = kind;
  live.innerHTML = `<span></span> ${escapeHtml(text)}`;
}
function timeoutSignal(milliseconds = 12000) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(milliseconds);
  const controller = new AbortController(); setTimeout(() => controller.abort(), milliseconds); return controller.signal;
}
async function apiFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && state.csrfToken) headers['X-CSRF-Token'] = state.csrfToken;
  const attempts = method === 'GET' ? 2 : 1;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { method, headers, credentials: 'same-origin', cache: 'no-store', signal: timeoutSignal(options.timeout || 12000), body: options.body === undefined ? undefined : JSON.stringify(options.body) });
      let data = {}; try { data = await response.json(); } catch {}
      if (response.status === 401) { state.profile = null; setScreen('loginScreen'); throw Object.assign(new Error(data.error || 'ההתחברות פגה'), { status: 401 }); }
      if (!response.ok) { const error = new Error(data.error || 'הפעולה נכשלה'); error.data = data; error.status = response.status; throw error; }
      return data;
    } catch (error) {
      lastError = error;
      if (error.status || attempt === attempts - 1) break;
      await new Promise((resolve) => setTimeout(resolve, 320));
    }
  }
  if (lastError?.name === 'TimeoutError' || lastError?.name === 'AbortError') throw new Error('החיבור לשרת התארך. בדקו אינטרנט ונסו שוב.');
  throw lastError || new Error('לא ניתן להתחבר לשרת');
}

async function init() {
  bindEvents();
  try {
    const configResponse = await fetch('/api/config', { cache: 'no-store' });
    state.config = await configResponse.json();
    if (!configResponse.ok) throw new Error(state.config.error || 'לא ניתן לטעון הגדרות');
    $('#loginVersion').textContent = `גרסה ${state.config.version || '0.5.0'}`;
    if (window.supabase) state.realtimeClient = window.supabase.createClient(state.config.supabaseUrl, state.config.supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    try {
      const me = await apiFetch('/api/auth-me');
      state.csrfToken = me.csrfToken; state.profile = me.profile;
      if (state.profile.must_change_password) return setScreen('passwordScreen');
      await enterApp();
    } catch (error) { if (error.status !== 401) console.warn(error); setScreen('loginScreen'); }
  } catch (error) { setScreen('loginScreen'); showToast(error.message, 'error'); }
}

function bindEvents() {
  $('#loginForm').addEventListener('submit', handleLogin);
  $('#passwordForm').addEventListener('submit', handlePasswordChange);
  $('#logoutBtn').addEventListener('click', logout);
  $('#refreshBtn').addEventListener('click', () => refreshAll(true));
  $$('.nav-btn').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));

  $('#prevWeekBtn').addEventListener('click', () => setWeek(addDays(state.weekStart, -7)));
  $('#nextWeekBtn').addEventListener('click', () => setWeek(addDays(state.weekStart, 7)));
  $('#todayWeekBtn').addEventListener('click', () => setWeek(startOfWeek(new Date())));
  $('#copyWeekBtn').addEventListener('click', openCopyWeekDialog);
  $('#copyReplaceBtn').addEventListener('click', () => copyPreviousWeek('replace'));
  $('#copyMergeBtn').addEventListener('click', () => copyPreviousWeek('merge'));
  $('#addShiftBtn').addEventListener('click', () => openShiftDialog());
  $('#publishScheduleBtn').addEventListener('click', openPublishDialog);
  $('#confirmPublishBtn').addEventListener('click', publishWeek);
  $('#ackScheduleBtn').addEventListener('click', acknowledgeSchedule);
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#printBtn').addEventListener('click', () => window.print());
  $('#imageBtn').addEventListener('click', downloadScheduleImage);
  $('#scheduleMode').addEventListener('click', (event) => { const button = event.target.closest('[data-mode]'); if (!button) return; state.scheduleMode = button.dataset.mode; storageSet('localStorage', 'hadas-schedule-mode', state.scheduleMode); renderSchedule(); });
  $('#scheduleDaySelect').addEventListener('change', (event) => { state.scheduleDay = Number(event.target.value); storageSet('localStorage', 'hadas-schedule-day', state.scheduleDay); renderSchedule(); });

  $('#newEmployeeBtn').addEventListener('click', () => openEmployeeDialog());
  $('#employeeStatusFilter').addEventListener('change', (event) => { state.employeeStatusFilter = event.target.value; renderEmployees(); });
  $('#employeeClassFilter').addEventListener('change', (event) => { state.employeeClassFilter = event.target.value; renderEmployees(); });
  $('#employeeTypeFilter').addEventListener('change', (event) => { state.employeeTypeFilter = event.target.value; renderEmployees(); });
  $('#employeeSearch').addEventListener('input', debounce((event) => { state.employeeSearch = event.target.value; renderEmployees(); }));

  $('#newRequestBtn').addEventListener('click', openRequestDialog);
  $('#requestStatusFilter').addEventListener('change', (event) => { state.requestStatusFilter = event.target.value; renderRequests(); });
  $('#requestSearch').addEventListener('input', debounce((event) => { state.requestSearch = event.target.value; renderRequests(); }));
  $$('input[name="request_type"]', $('#requestForm')).forEach((input) => input.addEventListener('change', updateRequestFields));
  $('#requestForm [name="target_employee_id"]').addEventListener('change', populateTargetShifts);
  $('#requestForm [name="shift_id"]').addEventListener('change', syncRequestDateFromShift);

  $('#attendanceDate').addEventListener('change', async (event) => { state.attendanceDate = event.target.value; await refreshAll(); });
  $('#newAnnouncementBtn').addEventListener('click', openAnnouncementDialog);
  $('#newTaskBtn').addEventListener('click', openTaskDialog);
  $$('[data-audience-group="announcement"] input').forEach((input) => input.addEventListener('change', updateAnnouncementAudience));
  $$('[data-audience-group="task"] input').forEach((input) => input.addEventListener('change', updateTaskAudience));

  $('#prevMonthBtn').addEventListener('click', () => changeCalendarMonth(-1));
  $('#nextMonthBtn').addEventListener('click', () => changeCalendarMonth(1));
  $('#todayMonthBtn').addEventListener('click', () => setCalendarMonth(monthStart(new Date())));
  $('#newCalendarBtn').addEventListener('click', () => openCalendarDialog());

  $('#shiftForm').addEventListener('submit', saveShift);
  $('#employeeForm').addEventListener('submit', saveEmployee);
  $('#requestForm').addEventListener('submit', saveRequest);
  $('#announcementForm').addEventListener('submit', saveAnnouncement);
  $('#taskForm').addEventListener('submit', saveTask);
  $('#calendarForm').addEventListener('submit', saveCalendarEvent);
  $('#settingsForm').addEventListener('submit', saveSettings);

  $$('.close-dialog').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
  $('#scheduleExport').addEventListener('click', handleScheduleClick);
  $('#employeesList').addEventListener('click', handleEmployeeClick);
  $('#requestsList').addEventListener('click', handleRequestClick);
  $('#attendanceList').addEventListener('click', handleAttendanceClick);
  $('#announcementsList').addEventListener('click', handleAnnouncementClick);
  $('#tasksList').addEventListener('click', handleTaskClick);
  $('#calendarGrid').addEventListener('click', handleCalendarClick);
  $('#calendarEventActions').addEventListener('click', handleCalendarEventAction);
  $('#suggestionsList').addEventListener('click', handleSuggestionClick);
  $('#dashboardPanel').addEventListener('click', (event) => { const button = event.target.closest('[data-dashboard-tab]'); if (button) switchTab(button.dataset.dashboardTab); });

  window.addEventListener('online', () => { setSyncState('online', 'חזר החיבור — מעדכנת'); refreshAll(); });
  window.addEventListener('offline', () => setSyncState('offline', 'אין חיבור — הנתונים נשארים במסך'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - state.lastRefreshAt > 45000) refreshAll(); });
}

async function handleLogin(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button'); setBusy(button, true, 'מתחברת…');
  try {
    const data = await apiFetch('/api/auth-login', { method: 'POST', body: formObject(event.currentTarget) });
    state.csrfToken = data.csrfToken; state.profile = data.profile;
    if (state.profile.must_change_password) setScreen('passwordScreen'); else await enterApp();
  } catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); }
}
async function handlePasswordChange(event) {
  event.preventDefault(); const body = formObject(event.currentTarget);
  if (body.password !== body.confirmPassword) return showToast('הסיסמאות אינן זהות', 'error');
  const button = event.currentTarget.querySelector('button'); setBusy(button, true);
  try {
    const data = await apiFetch('/api/auth-change-password', { method: 'POST', body: { password: body.password } });
    state.csrfToken = data.csrfToken; state.profile = data.profile; await enterApp(); showToast('הסיסמה נשמרה', 'success');
  } catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); }
}
async function logout() {
  try { await apiFetch('/api/auth-logout', { method: 'POST', body: {} }); } catch {}
  state.profile = null; state.csrfToken = '';
  if (state.realtimeChannel && state.realtimeClient) state.realtimeClient.removeChannel(state.realtimeChannel);
  clearInterval(state.pollTimer); setScreen('loginScreen');
}
async function enterApp() { setScreen('appShell'); applyPermissions(); $('#attendanceDate').value = state.attendanceDate; switchTab(state.activeTab); await refreshAll(); subscribeRealtime(); }
function applyPermissions() {
  $$('.manager-only').forEach((element) => element.classList.toggle('hidden', !isManager()));
  $$('.employee-only').forEach((element) => element.classList.toggle('hidden', isManager()));
  $$('.content-creator-only').forEach((element) => element.classList.toggle('hidden', !canCreateContent()));
  $('#userName').textContent = state.profile?.full_name || '';
  $('#userRole').textContent = `${ROLE_LABELS[state.profile?.role] || state.profile?.role || ''} · ${state.profile?.job_title || ''}`;
}
function switchTab(tab) {
  if (tab === 'employees' && !isManager()) tab = 'dashboard';
  state.activeTab = tab; storageSet('sessionStorage', 'hadas-active-tab', tab);
  $$('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  $$('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === `${tab}Panel`));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function setWeek(date) { state.weekStart = startOfWeek(date); await refreshAll(); }

async function refreshAll(showSuccess = false) {
  if (state.refreshing) return;
  state.refreshing = true; const button = $('#refreshBtn'); if (button) setBusy(button, true, 'מעדכנת…'); setSyncState('syncing', 'מעדכנת נתונים…');
  try {
    const url = `/api/data?week_start=${dateISO(state.weekStart)}&attendance_date=${state.attendanceDate}&calendar_month=${monthParam(state.calendarMonth)}`;
    const data = await apiFetch(url);
    Object.assign(state, {
      profile: data.profile,
      classes: data.classes,
      employees: data.employees,
      constraints: data.constraints,
      settings: data.settings,
      shifts: data.shifts,
      todayShifts: data.todayShifts || [],
      attendance: data.attendance,
      requests: data.requests,
      acknowledgements: data.acknowledgements,
      announcements: data.announcements,
      announcementRecipients: data.announcementRecipients || [],
      announcementReads: data.announcementReads,
      tasks: data.tasks,
      taskAssignees: data.taskAssignees,
      calendarEvents: data.calendarEvents,
      publication: data.publication || null,
      scheduleChanges: data.scheduleChanges || [],
    });
    state.lastRefreshAt = Date.now(); applyPermissions(); populateSelects(); renderAll(); setSyncState('online', 'מעודכן בזמן אמת');
    if (showSuccess) showToast('הנתונים עודכנו', 'success');
  } catch (error) {
    setSyncState(navigator.onLine ? 'error' : 'offline', navigator.onLine ? 'העדכון נכשל — נסו רענון' : 'אין חיבור'); showToast(error.message, 'error');
  } finally { state.refreshing = false; if (button) setBusy(button, false); }
}
function subscribeRealtime() {
  if (!state.realtimeClient) return;
  if (state.realtimeChannel) state.realtimeClient.removeChannel(state.realtimeChannel);
  state.realtimeChannel = state.realtimeClient.channel('hadas-public-refresh').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hadas_realtime_events' }, () => {
    clearTimeout(state.reloadTimer); state.reloadTimer = setTimeout(() => refreshAll(), 420);
  }).subscribe((status) => {
    if (status === 'SUBSCRIBED') setSyncState('online', 'מעודכן בזמן אמת');
    else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) setSyncState('error', 'עדכון חי נותק — קיים רענון אוטומטי');
  });
  clearInterval(state.pollTimer); state.pollTimer = setInterval(() => refreshAll(), 60000);
}

function employeePickerHtml(name, selected = []) {
  const chosen = new Set(selected);
  return state.employees.filter((employee) => employee.active).map((employee) => `<label class="employee-check"><input type="checkbox" name="${name}" value="${employee.id}" ${chosen.has(employee.id) ? 'checked' : ''}/><span>${escapeHtml(employee.full_name)}<small> ${escapeHtml(employee.job_title)}</small></span></label>`).join('');
}
function populateSelects() {
  const classOptions = state.classes.filter((item) => item.active).map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
  const employeeOptions = state.employees.filter((item) => item.active).map((item) => `<option value="${item.id}">${escapeHtml(item.full_name)} — ${escapeHtml(item.job_title)}</option>`).join('');
  $('#shiftForm [name="class_id"]').innerHTML = classOptions;
  $('#shiftForm [name="employee_id"]').innerHTML = employeeOptions;
  $('#employeeForm [name="primary_class_id"]').innerHTML = `<option value="">ללא כיתה קבועה</option>${classOptions}`;
  $('#requestForm [name="target_employee_id"]').innerHTML = `<option value="">בחרי עובדת</option>${state.employees.filter((item) => item.active && item.id !== state.profile.id).map((item) => `<option value="${item.id}">${escapeHtml(item.full_name)}</option>`).join('')}`;
  $('#announcementForm [name="class_id"]').innerHTML = `<option value="">בחרי כיתה</option>${classOptions}`;
  $('#taskForm [name="target_id"]').innerHTML = `<option value="">בחרי כיתה</option>${classOptions}`;
  $('#calendarForm [name="class_id"]').innerHTML = `<option value="">ללא</option>${classOptions}`;
  $('#announcementEmployeesField').innerHTML = employeePickerHtml('announcement_employee_ids');
  $('#taskEmployeesField').innerHTML = employeePickerHtml('task_employee_ids');
  $('#employeeClassFilter').innerHTML = `<option value="all">כל הכיתות</option><option value="none">ללא כיתה</option>${classOptions}`;
}
function renderAll() { renderDashboard(); renderSchedule(); renderRequests(); renderAttendance(); renderAnnouncements(); renderTasks(); renderCalendar(); if (isManager()) renderEmployees(); renderNavBadges(); }
function renderNavBadges() {
  const unread = state.announcements.filter((announcement) => !state.announcementReads.some((read) => read.announcement_id === announcement.id && read.employee_id === state.profile.id)).length;
  const openTasks = state.taskAssignees.filter((assignment) => assignment.employee_id === state.profile.id && assignment.status !== 'done').length;
  for (const [id, count] of [['announcementBadge', unread], ['taskBadge', openTasks]]) { const element = $(`#${id}`); element.textContent = count > 99 ? '99+' : String(count); element.classList.toggle('hidden', !count); }
}

function coverageFor(rows) {
  const count = new Set(rows.map((shift) => shift.employee_id)).size;
  const open = timeToMinutes(state.settings.opening_time || '07:30');
  const close = timeToMinutes(state.settings.closing_time || '15:30');
  const slot = Number(state.settings.validation_slot_minutes || 30);
  const closingWindow = Number(state.settings.closing_window_minutes || 30);
  let closing = Infinity; let leader = true; let ok = true;
  for (let minute = open; minute < close; minute += slot) {
    const end = Math.min(minute + slot, close);
    const startText = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const endText = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
    const active = rows.filter((shift) => overlaps(shift.start_time, shift.end_time, startText, endText));
    const activeCount = new Set(active.map((shift) => shift.employee_id)).size;
    const required = minute >= close - closingWindow ? Number(state.settings.closing_required_staff || 3) : Number(state.settings.required_staff || 4);
    if (minute >= close - closingWindow) closing = Math.min(closing, activeCount);
    if (activeCount < required) ok = false;
    if (!active.some((shift) => ['teacher', 'lead'].includes(shift.shift_role))) { leader = false; ok = false; }
  }
  if (!Number.isFinite(closing)) closing = 0;
  return { count, closing, leader, ok };
}
function shiftLineHtml(shift) {
  const employee = employeeById(shift.employee_id);
  return `<div class="employee-line"><span><strong>${escapeHtml(employee?.full_name || 'עובדת')}</strong><small>${SHIFT_ROLE_LABELS[shift.shift_role]}${shift.public_note ? ` · ${escapeHtml(shift.public_note)}` : ''}</small></span>${timeHtml(shift.start_time, shift.end_time)}</div>`;
}
function renderDashboard() {
  const today = dateISO(new Date());
  const shifts = state.todayShifts.length ? state.todayShifts : state.shifts.filter((shift) => shift.shift_date === today && shift.status === 'published');
  const staffed = new Set(shifts.map((shift) => shift.employee_id));
  const mine = shifts.filter((shift) => shift.employee_id === state.profile.id);
  const pending = state.requests.filter((request) => request.status === 'pending').length;
  const dueTasks = state.taskAssignees.filter((assignment) => assignment.employee_id === state.profile.id && assignment.status !== 'done').length;
  const unread = state.announcements.filter((announcement) => !state.announcementReads.some((read) => read.announcement_id === announcement.id && read.employee_id === state.profile.id)).length;
  const classCards = state.classes.filter((item) => item.active).map((item) => {
    const rows = shifts.filter((shift) => shift.class_id === item.id); const result = coverageFor(rows);
    return `<article class="class-card"><div class="card-heading"><h3>${escapeHtml(item.name)}</h3><span class="status-chip ${result.ok ? 'ok' : 'error'}">${result.ok ? 'תקין' : 'דורש טיפול'}</span></div>${rows.length ? rows.map(shiftLineHtml).join('') : '<div class="empty-state compact">אין שיבוץ להיום</div>'}<p class="small-note">${result.count} משובצות · ${result.closing} בסגירה · ${result.leader ? 'יש גננת/מובילה' : 'חסרה גננת/מובילה'}</p></article>`;
  }).join('');
  const quickActions = isManager()
    ? `<section class="quick-actions"><button data-dashboard-tab="schedule"><span>▦</span><strong>בניית שיבוץ</strong><small>הוספה, בדיקה ופרסום</small></button><button data-dashboard-tab="employees"><span>♙</span><strong>ניהול עובדות</strong><small>שעות, כיתה ואילוצים</small></button><button data-dashboard-tab="requests"><span>↔</span><strong>בקשות והחלפות</strong><small>${pending} ממתינות לטיפול</small></button><button data-dashboard-tab="attendance"><span>✓</span><strong>נוכחות היום</strong><small>עדכון ביצוע בפועל</small></button></section>`
    : `<section class="quick-actions"><button data-dashboard-tab="schedule"><span>▦</span><strong>השיבוץ השבועי</strong><small>כל הכיתות וכל העובדות</small></button><button data-dashboard-tab="requests"><span>↔</span><strong>בקשה חדשה</strong><small>חופשה, מחלה או החלפה</small></button><button data-dashboard-tab="tasks"><span>☑</span><strong>המשימות שלי</strong><small>${dueTasks} פתוחות</small></button><button data-dashboard-tab="announcements"><span>◉</span><strong>הודעות</strong><small>${unread} טרם נקראו</small></button></section>`;
  $('#dashboardPanel').innerHTML = `<div class="dashboard-welcome"><div><p class="eyebrow">מעון הדס</p><h2>שלום ${escapeHtml(state.profile.full_name)}</h2><p>${formatDate(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div><span class="dashboard-role">${escapeHtml(ROLE_LABELS[state.profile.role] || state.profile.job_title)}</span></div><div class="dashboard-grid"><article class="summary-card"><span class="caption">השיבוץ שלי היום</span><span class="metric">${mine.length || '—'}</span><small>${mine.length ? mine.map((shift) => `${classById(shift.class_id)?.name || ''} ${trimTime(shift.start_time)}–${trimTime(shift.end_time)}`).join(' · ') : 'אין שיבוץ'}</small></article><article class="summary-card"><span class="caption">עובדות משובצות</span><span class="metric">${staffed.size}</span><small>בכל המעון היום</small></article><article class="summary-card"><span class="caption">בקשות ממתינות</span><span class="metric">${pending}</span><small>${isManager() ? 'דורשות טיפול' : 'הבקשות שלך והחלפות'}</small></article><article class="summary-card"><span class="caption">משימות פתוחות</span><span class="metric">${dueTasks}</span><small>${unread} הודעות שלא נקראו</small></article></div>${quickActions}<div class="section-heading dashboard-section"><div><h2>מצב הכיתות היום</h2><p class="muted">תמונת מצב לפי השיבוץ שפורסם</p></div></div><div class="dashboard-grid class-grid">${classCards}</div>`;
}

function validateScheduleClient() {
  const errors = []; const warnings = [];
  const open = timeToMinutes(state.settings.opening_time || '07:30'); const close = timeToMinutes(state.settings.closing_time || '15:30'); const slot = Number(state.settings.validation_slot_minutes || 30); const closingWindow = Number(state.settings.closing_window_minutes || 30);
  for (const date of currentWeekDates().map(dateISO)) {
    for (const classItem of state.classes.filter((item) => item.active)) {
      for (let minute = open; minute < close; minute += slot) {
        const end = Math.min(minute + slot, close); const startText = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`; const endText = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
        const rows = state.shifts.filter((shift) => shift.shift_date === date && shift.class_id === classItem.id && overlaps(shift.start_time, shift.end_time, startText, endText));
        const count = new Set(rows.map((shift) => shift.employee_id)).size; const required = minute >= close - closingWindow ? Number(state.settings.closing_required_staff || 3) : Number(state.settings.required_staff || 4);
        if (count < required) errors.push(`${classItem.name} · ${formatDate(date)} · ${startText}: ${count}/${required} נשות צוות`);
        if (!rows.some((shift) => ['teacher', 'lead'].includes(shift.shift_role))) errors.push(`${classItem.name} · ${formatDate(date)} · ${startText}: חסרה גננת או מובילה`);
      }
    }
  }
  for (const employee of state.employees.filter((item) => item.active && item.weekly_hours)) {
    const hours = state.shifts.filter((shift) => shift.employee_id === employee.id).reduce((sum, shift) => sum + (timeToMinutes(shift.end_time) - timeToMinutes(shift.start_time)) / 60, 0);
    if (Math.abs(hours - Number(employee.weekly_hours)) >= 2) warnings.push(`${employee.full_name}: שובצה ${hours.toFixed(1)} שעות מתוך ${Number(employee.weekly_hours).toFixed(1)}`);
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
function renderWarnings() {
  if (!isManager()) { $('#scheduleWarnings').innerHTML = ''; return; }
  const validation = validateScheduleClient();
  if (!validation.errors.length && !validation.warnings.length) { $('#scheduleWarnings').innerHTML = '<div class="notice success">השיבוץ עומד בבדיקות התקינה.</div>'; return; }
  const items = [...validation.errors.map((text) => `<div class="warning-item error">${escapeHtml(text)}</div>`), ...validation.warnings.map((text) => `<div class="warning-item warn">${escapeHtml(text)}</div>`)].join('');
  $('#scheduleWarnings').innerHTML = `<details class="warning-details"><summary>${validation.errors.length} שגיאות · ${validation.warnings.length} התראות</summary><div class="warning-details-list">${items}</div></details>`;
}
function renderPublicationState() {
  const drafts = state.shifts.filter((shift) => shift.status === 'draft').length;
  const published = state.publication?.published_at;
  const text = drafts
    ? `<div class="publication-banner draft"><div><strong>${drafts} שיבוצים או שינויים ממתינים לפרסום</strong><small>הצוות ממשיך לראות את הגרסה האחרונה שפורסמה.</small></div><span class="status-chip draft">טיוטה</span></div>`
    : published
      ? `<div class="publication-banner published"><div><strong>השיבוץ פורסם לצוות</strong><small>גרסה ${state.publication.revision || 1} · ${formatDate(published, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></div><span class="status-chip published">פורסם</span></div>`
      : '<div class="publication-banner"><div><strong>השבוע עדיין לא פורסם</strong><small>הוסיפי שיבוצים ולחצי על פרסום השיבוץ.</small></div></div>';
  $('#schedulePublicationState').innerHTML = text;
}
function shiftCardHtml(shift, compact = false) {
  const employee = employeeById(shift.employee_id); const managerActions = isManager() ? `<div class="shift-actions"><button class="replace-shift" data-action="suggest" data-id="${shift.id}">מציאת מחליפה</button><button class="mini-btn" data-action="edit" data-id="${shift.id}">עריכה</button><button class="delete-shift" data-action="delete" data-id="${shift.id}" aria-label="מחיקת שיבוץ">×</button></div>` : '';
  return `<article class="shift-item ${shift.status === 'draft' ? 'is-draft' : ''} ${compact ? 'shift-card' : ''}" data-shift-id="${shift.id}"><div class="shift-main"><strong>${escapeHtml(employee?.full_name || 'עובדת')}</strong><span class="shift-time">${timeHtml(shift.start_time, shift.end_time)}</span><small>${SHIFT_ROLE_LABELS[shift.shift_role]}${shift.public_note ? ` · ${escapeHtml(shift.public_note)}` : ''}</small>${isManager() && shift.status === 'draft' ? '<span class="status-chip draft">טרם פורסם</span>' : ''}</div>${managerActions}</article>`;
}
function renderScheduleWeek() {
  const dates = currentWeekDates();
  const header = dates.map((date) => `<th><strong>${DAY_NAMES[date.getDay()]}</strong><small>${formatDate(date, { day: '2-digit', month: '2-digit' })}</small></th>`).join('');
  const rows = state.classes.filter((item) => item.active).map((classItem) => `<tr><td class="class-name">${escapeHtml(classItem.name)}</td>${dates.map((date) => { const iso = dateISO(date); const shifts = state.shifts.filter((shift) => shift.shift_date === iso && shift.class_id === classItem.id); return `<td><div class="schedule-cell">${shifts.map((shift) => shiftCardHtml(shift)).join('')}<div class="cell-footer manager-only ${isManager() ? '' : 'hidden'}"><button class="mini-btn cell-action" data-action="add" data-date="${iso}" data-class="${classItem.id}">＋ הוספה</button><button class="mini-btn cell-action" data-action="suggest-empty" data-date="${iso}" data-class="${classItem.id}">הצעת מחליפה</button></div></div></td>`; }).join('')}</tr>`).join('');
  return `<div class="schedule-table-scroll"><table class="schedule-table"><thead><tr><th class="class-name">כיתה</th>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function renderScheduleDay() {
  const date = currentWeekDates()[Math.min(Math.max(state.scheduleDay, 0), 5)] || currentWeekDates()[0]; const iso = dateISO(date);
  return `<div class="day-view-heading"><strong>${DAY_NAMES[date.getDay()]}</strong><span>${formatDate(date, { day: 'numeric', month: 'long' })}</span></div><div class="day-schedule-grid">${state.classes.filter((item) => item.active).map((classItem) => { const rows = state.shifts.filter((shift) => shift.shift_date === iso && shift.class_id === classItem.id); const coverage = coverageFor(rows); return `<article class="day-class-card"><div class="card-heading"><div><h3>${escapeHtml(classItem.name)}</h3><p>${coverage.count} משובצות · ${coverage.closing} בסגירה</p></div><span class="status-chip ${coverage.ok ? 'ok' : 'error'}">${coverage.ok ? 'תקין' : 'חוסר'}</span></div><div class="day-shifts">${rows.length ? rows.map((shift) => shiftCardHtml(shift, true)).join('') : '<div class="empty-state compact">אין שיבוצים</div>'}</div>${isManager() ? `<button class="secondary-btn full-button" data-action="add" data-date="${iso}" data-class="${classItem.id}">＋ הוספת עובדת</button>` : ''}</article>`; }).join('')}</div>`;
}
function renderScheduleMine() {
  return `<div class="my-schedule-list">${currentWeekDates().map((date) => { const iso = dateISO(date); const rows = state.shifts.filter((shift) => shift.shift_date === iso && shift.employee_id === state.profile.id); return `<article class="my-day-card"><div class="my-day-date"><strong>${DAY_NAMES[date.getDay()]}</strong><span>${formatDate(date, { day: '2-digit', month: '2-digit' })}</span></div><div class="my-day-shifts">${rows.length ? rows.map((shift) => `<div class="shift-item"><strong>${escapeHtml(classById(shift.class_id)?.name || '')}</strong><span class="shift-time">${timeHtml(shift.start_time, shift.end_time)}</span><small>${SHIFT_ROLE_LABELS[shift.shift_role]}${shift.public_note ? ` · ${escapeHtml(shift.public_note)}` : ''}</small></div>`).join('') : '<span class="day-off-label">יום חופשי / ללא שיבוץ</span>'}</div></article>`; }).join('')}</div>`;
}
function renderSchedule() {
  $('#weekLabel').textContent = `${formatDate(state.weekStart, { day: 'numeric', month: 'long' })} – ${formatDate(addDays(state.weekStart, 5), { day: 'numeric', month: 'long', year: 'numeric' })}`;
  $('#scheduleDaySelect').innerHTML = currentWeekDates().map((date, index) => `<option value="${index}" ${index === state.scheduleDay ? 'selected' : ''}>${DAY_NAMES[date.getDay()]} · ${formatDate(date, { day: '2-digit', month: '2-digit' })}</option>`).join('');
  $$('#scheduleMode [data-mode]').forEach((button) => button.classList.toggle('active', button.dataset.mode === state.scheduleMode));
  $('#scheduleDayField').classList.toggle('hidden', state.scheduleMode !== 'day');
  const exportElement = $('#scheduleExport'); exportElement.className = `schedule-wrap mode-${state.scheduleMode}`;
  exportElement.innerHTML = state.scheduleMode === 'day' ? renderScheduleDay() : state.scheduleMode === 'mine' ? renderScheduleMine() : renderScheduleWeek();
  renderWarnings(); renderPublicationState();
  const acknowledged = state.acknowledgements.some((row) => row.employee_id === state.profile.id);
  $('#ackScheduleBtn').textContent = acknowledged ? 'השיבוץ נקרא ✓' : 'קראתי את השיבוץ'; $('#ackScheduleBtn').disabled = acknowledged;
}
function openShiftDialog(shift = {}) {
  const form = $('#shiftForm'); form.reset();
  form.elements.id.value = shift.id || '';
  form.elements.shift_date.value = shift.shift_date || dateISO(state.weekStart);
  form.elements.class_id.value = shift.class_id || state.classes.find((item) => item.active)?.id || '';
  form.elements.employee_id.value = shift.employee_id || state.employees.find((item) => item.active)?.id || '';
  form.elements.start_time.value = trimTime(shift.start_time) || '07:30';
  form.elements.end_time.value = trimTime(shift.end_time) || '15:30';
  form.elements.shift_role.value = shift.shift_role || 'staff';
  form.elements.public_note.value = shift.public_note || '';
  form.elements.override_day_off.value = 'false';
  $('#shiftDialog').showModal();
}
async function saveShift(event) {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[value="default"]'); const data = formObject(form); data.override_day_off = data.override_day_off === 'true'; setBusy(button, true);
  try {
    try { await apiFetch('/api/shifts', { method: data.id ? 'PATCH' : 'POST', body: data }); }
    catch (error) { if (error.status === 409 && /יום החופשי/.test(error.message) && confirm(`${error.message}\nלשמור בכל זאת?`)) { data.override_day_off = true; await apiFetch('/api/shifts', { method: data.id ? 'PATCH' : 'POST', body: data }); } else throw error; }
    $('#shiftDialog').close(); await refreshAll(); showToast('השיבוץ נשמר בטיוטה', 'success');
  } catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); }
}
async function openPublishDialog() {
  const button = $('#publishScheduleBtn'); setBusy(button, true, 'בודקת…');
  try {
    const preview = await apiFetch('/api/shifts', { method: 'POST', body: { action: 'publish_preview', week_start: dateISO(state.weekStart) } });
    $('#publishSummary').innerHTML = `<div class="request-summary"><div class="mini-stat"><strong>${preview.shiftCount}</strong><span>שיבוצים בשבוע</span></div><div class="mini-stat"><strong>${preview.draftCount}</strong><span>שינויים לפרסום</span></div><div class="mini-stat"><strong>${preview.errors.length}</strong><span>שגיאות תקינה</span></div><div class="mini-stat"><strong>${preview.warnings.length}</strong><span>התראות</span></div></div>${preview.errors.length ? `<div class="notice error">יש לטפל בשגיאות לפני הפרסום.</div>` : '<div class="notice success">השיבוץ מוכן לפרסום.</div>'}`;
    $('#publishChanges').innerHTML = preview.changes.length ? preview.changes.map(changeRowHtml).join('') : '<div class="empty-state compact">אין שינויים חדשים, אך אפשר לפרסם מחדש את השבוע.</div>';
    $('#confirmPublishBtn').disabled = preview.errors.length > 0;
    $('#publishDialog').showModal();
  } catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); }
}
function changeRowHtml(change) {
  const data = change.after_data || change.before_data || {}; const employee = employeeById(data.employee_id); const classItem = classById(data.class_id);
  const icon = change.change_type === 'delete' ? '−' : change.change_type === 'update' ? '↻' : '+';
  return `<div class="change-row"><span class="change-icon">${icon}</span><div><strong>${CHANGE_LABELS[change.change_type] || 'שינוי'}</strong><small>${escapeHtml(employee?.full_name || 'עובדת')} · ${escapeHtml(classItem?.name || 'כיתה')} · ${formatDate(data.shift_date)} · ${timeHtml(data.start_time, data.end_time)}</small></div></div>`;
}
async function publishWeek() {
  const button = $('#confirmPublishBtn'); setBusy(button, true, 'מפרסמת…');
  try { await apiFetch('/api/shifts', { method: 'POST', body: { action: 'publish', week_start: dateISO(state.weekStart) } }); $('#publishDialog').close(); await refreshAll(); showToast('השיבוץ פורסם לכל הצוות', 'success'); }
  catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); }
}
async function openCopyWeekDialog() {
  const button = $('#copyWeekBtn'); setBusy(button, true, 'בודקת…');
  try {
    const preview = await apiFetch('/api/shifts', { method: 'POST', body: { action: 'copy_preview', week_start: dateISO(state.weekStart) } });
    $('#copyWeekPreview').innerHTML = `<div class="notice"><strong>שבוע מקור:</strong> ${formatDate(preview.previousStart)} · ${preview.previousCount} שיבוצים<br/><strong>השבוע הנוכחי:</strong> ${preview.existingCount} שיבוצים קיימים</div>`;
    $('#copyWeekDialog').showModal();
  } catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); }
}
async function copyPreviousWeek(mode) {
  const button = mode === 'merge' ? $('#copyMergeBtn') : $('#copyReplaceBtn'); setBusy(button, true, 'מעתיקה…');
  try { const result = await apiFetch('/api/shifts', { method: 'POST', body: { action: 'copy_previous', week_start: dateISO(state.weekStart), mode } }); $('#copyWeekDialog').close(); await refreshAll(); showToast(`הועתקו ${result.count} שיבוצים${result.skipped ? `, ${result.skipped} דולגו` : ''}`, 'success'); }
  catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); }
}
async function acknowledgeSchedule() { try { await apiFetch('/api/shifts', { method: 'POST', body: { action: 'ack', week_start: dateISO(state.weekStart) } }); await refreshAll(); showToast('אישור הקריאה נשמר', 'success'); } catch (error) { showToast(error.message, 'error'); } }
async function downloadScheduleImage() {
  if (!window.html2canvas) return showToast('רכיב שמירת התמונה עדיין נטען. נסו שוב.', 'error');
  const button = $('#imageBtn'); setBusy(button, true, 'מכינה תמונה…');
  try { const canvas = await window.html2canvas($('#scheduleExport'), { scale: 1.6, backgroundColor: '#ffffff', useCORS: true }); const link = document.createElement('a'); link.download = `שיבוץ-מעון-הדס-${dateISO(state.weekStart)}.png`; link.href = canvas.toDataURL('image/png'); link.click(); }
  catch { showToast('שמירת התמונה נכשלה', 'error'); } finally { setBusy(button, false); }
}
async function handleScheduleClick(event) {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const shift = state.shifts.find((item) => item.id === button.dataset.id);
  if (button.dataset.action === 'add') return openShiftDialog({ shift_date: button.dataset.date, class_id: button.dataset.class });
  if (button.dataset.action === 'edit' && shift) return openShiftDialog(shift);
  if (['suggest', 'suggest-empty'].includes(button.dataset.action)) return showSuggestions(button.dataset.date || shift?.shift_date, button.dataset.class || shift?.class_id, shift);
  if (button.dataset.action === 'delete' && shift && confirm('למחוק את השיבוץ? השינוי ימתין לפרסום.')) {
    try { await apiFetch('/api/shifts', { method: 'DELETE', body: { id: shift.id } }); await refreshAll(); showToast('השיבוץ הוסר מהטיוטה', 'success'); } catch (error) { showToast(error.message, 'error'); }
  }
}

function employeeType(employee) {
  const title = String(employee.job_title || '');
  if (/גננ/.test(title)) return 'teacher';
  if (/סייע|מטפל/.test(title)) return 'assistant';
  if (/קלינ|ריפוי|מרפא|פיזיו|פסיכ|עובד.*סוציא|פרא/.test(title)) return 'therapy';
  if (/מנהלת|אחראית/.test(title) || ['admin', 'scheduler'].includes(employee.role)) return 'management';
  return 'other';
}
function renderEmployees() {
  const term = state.employeeSearch.trim().toLowerCase();
  const filtered = state.employees.filter((employee) => {
    const statusOk = state.employeeStatusFilter === 'all' || (state.employeeStatusFilter === 'active' ? employee.active : !employee.active);
    const classOk = state.employeeClassFilter === 'all' || (state.employeeClassFilter === 'none' ? !employee.primary_class_id : employee.primary_class_id === state.employeeClassFilter);
    const typeOk = state.employeeTypeFilter === 'all' || employeeType(employee) === state.employeeTypeFilter;
    const haystack = `${employee.full_name} ${employee.phone || ''} ${employee.job_title || ''}`.toLowerCase();
    return statusOk && classOk && typeOk && (!term || haystack.includes(term));
  });
  const active = state.employees.filter((employee) => employee.active).length; const teachers = state.employees.filter((employee) => employee.active && employeeType(employee) === 'teacher').length; const assistants = state.employees.filter((employee) => employee.active && employeeType(employee) === 'assistant').length; const therapy = state.employees.filter((employee) => employee.active && employeeType(employee) === 'therapy').length;
  $('#employeeSummary').innerHTML = `<div class="mini-stat"><strong>${active}</strong><span>עובדות פעילות</span></div><div class="mini-stat"><strong>${teachers}</strong><span>גננות</span></div><div class="mini-stat"><strong>${assistants}</strong><span>סייעות</span></div><div class="mini-stat"><strong>${therapy}</strong><span>פרא־רפואי</span></div>`;
  $('#employeesList').innerHTML = filtered.length ? filtered.map((employee) => `<article class="employee-card ${employee.active ? '' : 'inactive'}"><span class="employee-card-status status-chip ${employee.active ? 'ok' : 'error'}">${employee.active ? 'פעילה' : 'לא פעילה'}</span><div class="employee-card-head"><span class="employee-avatar">${escapeHtml(initials(employee.full_name))}</span><div><h3>${escapeHtml(employee.full_name)}</h3><p>${escapeHtml(employee.job_title)} · ${escapeHtml(classById(employee.primary_class_id)?.name || 'ללא כיתה קבועה')}</p></div></div><div class="employee-card-meta"><div><small>טלפון</small>${escapeHtml(employee.phone || '—')}</div><div><small>הרשאה</small>${escapeHtml(ROLE_LABELS[employee.role] || 'עובדת')}</div><div><small>שעות שבועיות</small>${employee.weekly_hours ?? 'לא הוגדר'}</div><div><small>שעות רגילות</small>${timeHtml(employee.default_start, employee.default_end)}</div></div><div class="card-actions"><button class="secondary-btn" data-action="edit" data-id="${employee.id}">עריכת כרטיס</button><button class="ghost-btn" data-action="reset" data-id="${employee.id}">איפוס סיסמה</button><button class="${employee.active ? 'danger-btn' : 'primary-btn'}" data-action="toggle" data-id="${employee.id}">${employee.active ? 'השבתה' : 'הפעלה'}</button></div></article>`).join('') : '<div class="empty-state">לא נמצאו עובדות לפי הסינון.</div>';
}
function renderConstraintFields(employee = {}) {
  const existing = state.constraints.filter((constraint) => constraint.employee_id === employee.id);
  $('#constraintsFields').innerHTML = state.classes.filter((item) => item.active).map((item) => {
    const constraint = existing.find((row) => row.class_id === item.id);
    return `<div class="constraint-row" data-class-id="${item.id}"><label>${escapeHtml(item.name)}<select class="constraint-type"><option value="">ללא מגבלה</option><option value="preferred" ${constraint?.constraint_type === 'preferred' ? 'selected' : ''}>עדיפות</option><option value="avoid" ${constraint?.constraint_type === 'avoid' ? 'selected' : ''}>עדיף להימנע</option><option value="forbidden" ${constraint?.constraint_type === 'forbidden' ? 'selected' : ''}>אסור לשבץ</option></select></label><label>מתאריך<input class="constraint-from" type="date" value="${constraint?.valid_from || ''}"/></label><label>עד תאריך<input class="constraint-to" type="date" value="${constraint?.valid_to || ''}"/></label><label class="full-field">הסבר<input class="constraint-reason" value="${escapeHtml(constraint?.reason || '')}"/></label></div>`;
  }).join('');
}
function collectConstraints() { return $$('.constraint-row').map((row) => ({ class_id: row.dataset.classId, constraint_type: $('.constraint-type', row).value, valid_from: $('.constraint-from', row).value, valid_to: $('.constraint-to', row).value, reason: $('.constraint-reason', row).value })).filter((row) => row.constraint_type); }
function openEmployeeDialog(employee = {}) {
  const form = $('#employeeForm'); form.reset(); form.elements.id.value = employee.id || ''; form.elements.full_name.value = employee.full_name || ''; form.elements.phone.value = employee.phone || ''; form.elements.job_title.value = employee.job_title || 'סייעת'; form.elements.role.value = employee.role || 'employee'; form.elements.primary_class_id.value = employee.primary_class_id || ''; form.elements.can_lead.value = String(Boolean(employee.can_lead)); form.elements.weekly_hours.value = employee.weekly_hours ?? ''; form.elements.employment_percent.value = employee.employment_percent ?? ''; form.elements.fixed_day_off.value = employee.fixed_day_off ?? ''; form.elements.default_start.value = trimTime(employee.default_start) || '07:30'; form.elements.default_end.value = trimTime(employee.default_end) || '15:30'; form.elements.admin_notes.value = employee.admin_notes || ''; renderConstraintFields(employee); $('#employeeDialog').showModal();
}
async function saveEmployee(event) { event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[value="default"]'); const data = formObject(form); data.can_lead = data.can_lead === 'true'; data.constraints = collectConstraints(); setBusy(button, true); try { await apiFetch('/api/employees', { method: data.id ? 'PATCH' : 'POST', body: data }); $('#employeeDialog').close(); await refreshAll(); showToast('כרטיס העובדת נשמר', 'success'); } catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); } }
async function handleEmployeeClick(event) {
  const button = event.target.closest('[data-action]'); if (!button) return; const employee = employeeById(button.dataset.id); if (!employee) return;
  if (button.dataset.action === 'edit') return openEmployeeDialog(employee);
  if (button.dataset.action === 'reset' && !confirm(`לאפס את הסיסמה של ${employee.full_name} ל-hadas?`)) return;
  if (button.dataset.action === 'toggle' && !confirm(`${employee.active ? 'להשבית' : 'להפעיל'} את ${employee.full_name}?`)) return;
  try { await apiFetch('/api/employees', { method: 'PATCH', body: { id: employee.id, ...(button.dataset.action === 'reset' ? { reset_password: true } : { active: !employee.active }) } }); await refreshAll(); showToast('העובדת עודכנה', 'success'); } catch (error) { showToast(error.message, 'error'); }
}

function selectedRequestType() { return $('#requestForm input[name="request_type"]:checked')?.value || 'leave'; }
function openRequestDialog() { const form = $('#requestForm'); form.reset(); form.elements.request_date.value = dateISO(new Date()); $('input[name="request_type"][value="leave"]', form).checked = true; updateRequestShiftOptions(); updateRequestFields(); $('#requestDialog').showModal(); }
function updateRequestFields() {
  const form = $('#requestForm'); const type = selectedRequestType(); const needsShift = ['late_start', 'early_finish', 'swap'].includes(type);
  $$('.request-start').forEach((element) => element.classList.toggle('hidden', type !== 'late_start')); $$('.request-end').forEach((element) => element.classList.toggle('hidden', type !== 'early_finish')); $$('.shift-choice-field').forEach((element) => element.classList.toggle('hidden', !needsShift)); $$('.swap-field').forEach((element) => element.classList.toggle('hidden', type !== 'swap'));
  form.elements.shift_id.required = needsShift; form.elements.target_employee_id.required = type === 'swap'; form.elements.target_shift_id.required = type === 'swap'; form.elements.requested_start.required = type === 'late_start'; form.elements.requested_end.required = type === 'early_finish';
}
function updateRequestShiftOptions() { const mine = state.shifts.filter((shift) => shift.employee_id === state.profile.id); $('#requestForm [name="shift_id"]').innerHTML = `<option value="">בחרי שיבוץ</option>${mine.map((shift) => `<option value="${shift.id}">${formatDate(shift.shift_date)} · ${classById(shift.class_id)?.name || ''} · ${trimTime(shift.start_time)}–${trimTime(shift.end_time)}</option>`).join('')}`; populateTargetShifts(); }
function syncRequestDateFromShift() { const form = $('#requestForm'); const shift = state.shifts.find((item) => item.id === form.elements.shift_id.value); if (shift) form.elements.request_date.value = shift.shift_date; }
function populateTargetShifts() { const id = $('#requestForm [name="target_employee_id"]').value; $('#requestForm [name="target_shift_id"]').innerHTML = `<option value="">בחרי שיבוץ</option>${state.shifts.filter((shift) => shift.employee_id === id).map((shift) => `<option value="${shift.id}">${formatDate(shift.shift_date)} · ${classById(shift.class_id)?.name || ''} · ${trimTime(shift.start_time)}–${trimTime(shift.end_time)}</option>`).join('')}`; }
async function saveRequest(event) { event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[value="default"]'); const data = formObject(form); data.request_type = selectedRequestType(); setBusy(button, true, 'שולחת…'); try { await apiFetch('/api/requests', { method: 'POST', body: { action: 'create', ...data } }); $('#requestDialog').close(); await refreshAll(); showToast('הבקשה נשלחה', 'success'); } catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); } }
function requestFlowHtml(request) {
  const steps = request.request_type === 'swap' ? ['נשלחה', 'הסכמת העובדת', 'אישור', 'הוזרמה'] : ['נשלחה', 'אישור', 'הוזרמה'];
  const activeIndex = request.status === 'pending' ? 0 : request.status === 'approved' ? steps.length - 2 : request.status === 'applied' ? steps.length - 1 : 0;
  return `<div class="request-flow">${steps.map((step, index) => `<span class="flow-step ${index <= activeIndex ? 'active' : ''}">${step}</span>`).join('<span>›</span>')}</div>`;
}
function renderRequests() {
  const counts = { pending: 0, approved: 0, applied: 0, closed: 0 }; state.requests.forEach((request) => { if (request.status === 'pending') counts.pending += 1; else if (request.status === 'approved') counts.approved += 1; else if (request.status === 'applied') counts.applied += 1; else counts.closed += 1; });
  $('#requestSummary').innerHTML = `<div class="mini-stat"><strong>${counts.pending}</strong><span>ממתינות</span></div><div class="mini-stat"><strong>${counts.approved}</strong><span>אושרו</span></div><div class="mini-stat"><strong>${counts.applied}</strong><span>הוזרמו</span></div><div class="mini-stat"><strong>${counts.closed}</strong><span>סגורות</span></div>`;
  const term = state.requestSearch.trim().toLowerCase();
  const visible = state.requests.filter((request) => {
    const statusOk = state.requestStatusFilter === 'all' || request.status === state.requestStatusFilter || (state.requestStatusFilter === 'open' && ['pending', 'approved'].includes(request.status)) || (state.requestStatusFilter === 'closed' && ['rejected', 'applied', 'cancelled'].includes(request.status));
    const requester = employeeById(request.requester_id); const target = employeeById(request.target_employee_id); const haystack = `${requester?.full_name || ''} ${target?.full_name || ''} ${request.reason || ''} ${REQUEST_LABELS[request.request_type] || ''}`.toLowerCase(); return statusOk && (!term || haystack.includes(term));
  });
  $('#requestsList').innerHTML = visible.length ? visible.map((request) => {
    const requester = employeeById(request.requester_id); const target = employeeById(request.target_employee_id); const statusClass = request.status === 'rejected' || request.status === 'cancelled' ? 'error' : request.status === 'applied' ? 'ok' : 'warn';
    return `<article class="request-card type-${request.request_type}"><div class="card-heading"><div class="request-title"><span class="request-avatar">${REQUEST_ICONS[request.request_type]}</span><div><h3>${REQUEST_LABELS[request.request_type]}</h3><p class="muted">${escapeHtml(requester?.full_name || '')} · ${formatDate(request.request_date)}</p></div></div><span class="status-chip ${statusClass}">${REQUEST_STATUS_LABELS[request.status]}</span></div>${requestFlowHtml(request)}<div class="meta-grid"><div class="meta-item"><small>פירוט</small>${escapeHtml(request.reason || 'ללא פירוט')}</div><div class="meta-item"><small>שעות</small>${request.requested_start || request.requested_end ? timeHtml(request.requested_start, request.requested_end) : 'לא רלוונטי'}</div><div class="meta-item"><small>החלפה עם</small>${escapeHtml(target?.full_name || 'לא רלוונטי')}${request.request_type === 'swap' ? ` · ${request.target_approved ? 'אישרה' : 'טרם אישרה'}` : ''}</div></div>${request.manager_note ? `<div class="notice"><strong>הערת מנהלת:</strong> ${escapeHtml(request.manager_note)}</div>` : ''}<div class="card-actions">${request.request_type === 'swap' && request.target_employee_id === state.profile.id && !request.target_approved && request.status === 'pending' ? `<button class="secondary-btn" data-action="target_accept" data-id="${request.id}">אני מסכימה להחלפה</button>` : ''}${request.requester_id === state.profile.id && request.status === 'pending' ? `<button class="ghost-btn" data-action="cancel" data-id="${request.id}">ביטול הבקשה</button>` : ''}${isManager() && request.status === 'pending' ? `<button class="primary-btn" data-action="approve" data-id="${request.id}">אישור</button><button class="danger-btn" data-action="reject" data-id="${request.id}">דחייה</button>` : ''}${isManager() && request.status === 'approved' ? `<button class="publish-btn" data-action="apply" data-id="${request.id}">הזרמה לשיבוץ</button>` : ''}</div></article>`;
  }).join('') : '<div class="empty-state">אין בקשות לפי הסינון שנבחר.</div>';
}
async function handleRequestClick(event) { const button = event.target.closest('[data-action]'); if (!button) return; let body = { id: button.dataset.id, action: button.dataset.action }; if (button.dataset.action === 'approve' || button.dataset.action === 'reject') body = { ...body, action: 'decide', status: button.dataset.action === 'approve' ? 'approved' : 'rejected', manager_note: prompt('הערה לעובדת (אפשר להשאיר ריק):') || '' }; if (button.dataset.action === 'apply' && !confirm('להזרים את הבקשה לשיבוץ בפועל?')) return; try { await apiFetch('/api/requests', { method: 'POST', body }); await refreshAll(); showToast('הבקשה עודכנה', 'success'); } catch (error) { showToast(error.message, 'error'); } }

function renderAttendance() {
  const shifts = state.shifts.filter((shift) => shift.shift_date === state.attendanceDate && (isManager() || shift.employee_id === state.profile.id));
  $('#attendanceList').innerHTML = shifts.length ? shifts.map((shift) => { const row = state.attendance.find((attendance) => attendance.shift_id === shift.id); return `<article class="attendance-card" data-shift-id="${shift.id}"><div class="card-heading"><div><h3>${escapeHtml(employeeById(shift.employee_id)?.full_name || '')}</h3><p class="muted">${escapeHtml(classById(shift.class_id)?.name || '')} · ${timeHtml(shift.start_time, shift.end_time)}</p></div><span class="role-chip">${SHIFT_ROLE_LABELS[shift.shift_role]}</span></div>${isManager() ? `<div class="form-grid"><label>מצב<select class="attendance-status">${Object.entries(ATTENDANCE_LABELS).map(([value, label]) => `<option value="${value}" ${(row?.status || 'scheduled') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>התחלה בפועל<input class="attendance-start" type="time" value="${trimTime(row?.actual_start) || trimTime(shift.start_time)}"/></label><label>סיום בפועל<input class="attendance-end" type="time" value="${trimTime(row?.actual_end) || trimTime(shift.end_time)}"/></label><label>הערה<input class="attendance-note" value="${escapeHtml(row?.note || '')}"/></label></div><button class="primary-btn" data-action="save-attendance">שמירת נוכחות</button>` : `<div class="meta-grid"><div class="meta-item"><small>מצב</small>${ATTENDANCE_LABELS[row?.status || 'scheduled']}</div><div class="meta-item"><small>בפועל</small>${timeHtml(row?.actual_start, row?.actual_end)}</div></div>`}</article>`; }).join('') : `<div class="empty-state">אין שיבוצים בתאריך ${formatDate(state.attendanceDate)}.</div>`;
}
async function handleAttendanceClick(event) { const button = event.target.closest('[data-action="save-attendance"]'); if (!button) return; const card = button.closest('[data-shift-id]'); try { await apiFetch('/api/attendance', { method: 'POST', body: { shift_id: card.dataset.shiftId, status: $('.attendance-status', card).value, actual_start: $('.attendance-start', card).value, actual_end: $('.attendance-end', card).value, note: $('.attendance-note', card).value } }); await refreshAll(); showToast('הנוכחות נשמרה', 'success'); } catch (error) { showToast(error.message, 'error'); } }

function selectedCheckboxValues(container, name) { return $$(`input[name="${name}"]:checked`, container).map((input) => input.value); }
function openAnnouncementDialog() { const form = $('#announcementForm'); form.reset(); $('input[name="audience_type"][value="all"]', form).checked = true; $('#announcementEmployeesField').innerHTML = employeePickerHtml('announcement_employee_ids'); updateAnnouncementAudience(); $('#announcementDialog').showModal(); }
function updateAnnouncementAudience() { const type = $('#announcementForm input[name="audience_type"]:checked')?.value || 'all'; $('#announcementClassField').classList.toggle('hidden', type !== 'class'); $('#announcementEmployeesField').classList.toggle('hidden', type !== 'employees'); }
function audienceText(item, kind = 'announcement') {
  const type = kind === 'task' ? item.target_type : item.audience_type;
  if (type === 'class') return `כיתת ${classById(kind === 'task' ? item.target_id : item.class_id)?.name || ''}`;
  if (type === 'employees' || type === 'employee') {
    const count = kind === 'task' ? state.taskAssignees.filter((row) => row.task_id === item.id).length : state.announcementRecipients.filter((row) => row.announcement_id === item.id).length;
    return `${count} עובדות נבחרות`;
  }
  return 'כל המעון';
}
function canManageCreated(item) { return isManager() || item.created_by === state.profile.id; }
function renderAnnouncements() {
  $('#announcementsList').innerHTML = state.announcements.length ? state.announcements.map((announcement) => {
    const read = state.announcementReads.some((row) => row.announcement_id === announcement.id && row.employee_id === state.profile.id); const readCount = state.announcementReads.filter((row) => row.announcement_id === announcement.id).length; const creator = employeeById(announcement.created_by);
    return `<article class="announcement-card ${announcement.announcement_type}"><div class="card-heading"><div><h3>${escapeHtml(announcement.title)}${!read ? '<span class="unread-dot"></span>' : ''}</h3><p class="muted">${formatDate(announcement.published_at, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · ${escapeHtml(creator?.full_name || '')}</p></div><span class="status-chip ${announcement.announcement_type === 'urgent' ? 'error' : announcement.announcement_type === 'important' ? 'warn' : 'ok'}">${announcement.announcement_type === 'urgent' ? 'דחוף' : announcement.announcement_type === 'important' ? 'חשוב' : 'מידע'}</span></div><span class="audience-label">◉ ${escapeHtml(audienceText(announcement))}</span><p class="announcement-body">${escapeHtml(announcement.body).replaceAll('\n', '<br>')}</p><div class="card-actions">${!read ? `<button class="primary-btn" data-action="read" data-id="${announcement.id}">קראתי</button>` : '<span class="status-chip ok">נקרא ✓</span>'}${canManageCreated(announcement) ? `<span class="small-note">נקראה על ידי ${readCount}</span><button class="danger-btn" data-action="delete" data-id="${announcement.id}">הסרה</button>` : ''}</div></article>`;
  }).join('') : '<div class="empty-state">אין הודעות פעילות.</div>';
}
async function saveAnnouncement(event) { event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[value="default"]'); const data = formObject(form); data.audience_type = form.querySelector('input[name="audience_type"]:checked')?.value || 'all'; data.employee_ids = selectedCheckboxValues(form, 'announcement_employee_ids'); data.expires_at = toIsoDateTime(data.expires_at); setBusy(button, true); try { await apiFetch('/api/announcements', { method: 'POST', body: data }); $('#announcementDialog').close(); await refreshAll(); showToast('ההודעה פורסמה', 'success'); } catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); } }
async function handleAnnouncementClick(event) { const button = event.target.closest('[data-action]'); if (!button) return; try { if (button.dataset.action === 'delete' && !confirm('להסיר את ההודעה?')) return; await apiFetch('/api/announcements', { method: button.dataset.action === 'delete' ? 'DELETE' : 'POST', body: { action: button.dataset.action, id: button.dataset.id } }); await refreshAll(); } catch (error) { showToast(error.message, 'error'); } }

function openTaskDialog() { const form = $('#taskForm'); form.reset(); $('input[name="target_type"][value="all"]', form).checked = true; $('#taskEmployeesField').innerHTML = employeePickerHtml('task_employee_ids'); updateTaskAudience(); $('#taskDialog').showModal(); }
function updateTaskAudience() { const type = $('#taskForm input[name="target_type"]:checked')?.value || 'all'; $('#taskClassField').classList.toggle('hidden', type !== 'class'); $('#taskEmployeesField').classList.toggle('hidden', type !== 'employees'); }
function renderTasks() {
  const activeTasks = state.tasks.filter((task) => task.active);
  $('#tasksList').innerHTML = activeTasks.length ? activeTasks.map((task) => {
    const assignments = state.taskAssignees.filter((assignment) => assignment.task_id === task.id); const mine = assignments.find((assignment) => assignment.employee_id === state.profile.id); const done = assignments.filter((assignment) => assignment.status === 'done').length; const percent = assignments.length ? Math.round(done / assignments.length * 100) : 0; const creator = employeeById(task.created_by);
    return `<article class="task-card priority-${task.priority}"><div class="card-heading"><div><h3>${escapeHtml(task.title)}</h3><p class="muted">נוצרה על ידי ${escapeHtml(creator?.full_name || '')}${task.due_at ? ` · יעד ${formatDate(task.due_at, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}</p></div><span class="status-chip ${task.priority === 'urgent' ? 'error' : task.priority === 'important' ? 'warn' : 'ok'}">${PRIORITY_LABELS[task.priority]}</span></div><span class="audience-label">☑ ${escapeHtml(audienceText(task, 'task'))}</span><p>${escapeHtml(task.description || 'ללא פירוט')}</p>${canManageCreated(task) ? `<div class="small-note">${done} מתוך ${assignments.length} ביצעו</div><div class="progress-track"><span style="width:${percent}%"></span></div>` : ''}<div class="card-actions">${mine ? `<button class="${mine.status === 'done' ? 'ghost-btn' : 'primary-btn'}" data-action="${mine.status === 'done' ? 'reopen' : 'complete'}" data-id="${task.id}">${mine.status === 'done' ? 'פתיחה מחדש' : 'סימון כבוצע'}</button>` : ''}${canManageCreated(task) ? `<button class="danger-btn" data-action="delete" data-id="${task.id}">הסרה</button>` : ''}</div></article>`;
  }).join('') : '<div class="empty-state">אין משימות פעילות.</div>';
}
async function saveTask(event) { event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[value="default"]'); const data = formObject(form); data.target_type = form.querySelector('input[name="target_type"]:checked')?.value || 'all'; data.employee_ids = selectedCheckboxValues(form, 'task_employee_ids'); data.due_at = toIsoDateTime(data.due_at); setBusy(button, true); try { await apiFetch('/api/tasks', { method: 'POST', body: data }); $('#taskDialog').close(); await refreshAll(); showToast('המשימה נוצרה', 'success'); } catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); } }
async function handleTaskClick(event) { const button = event.target.closest('[data-action]'); if (!button) return; if (button.dataset.action === 'delete' && !confirm('להסיר את המשימה?')) return; try { await apiFetch('/api/tasks', { method: button.dataset.action === 'delete' ? 'DELETE' : 'POST', body: { action: button.dataset.action, id: button.dataset.id } }); await refreshAll(); } catch (error) { showToast(error.message, 'error'); } }

async function setCalendarMonth(date) { state.calendarMonth = monthStart(date); try { const result = await apiFetch(`/api/calendar?month=${monthParam(state.calendarMonth)}`); state.calendarEvents = result.events; renderCalendar(); } catch (error) { showToast(error.message, 'error'); } }
function changeCalendarMonth(delta) { return setCalendarMonth(addMonths(state.calendarMonth, delta)); }
function calendarCells() { const first = monthStart(state.calendarMonth); const gridStart = addDays(first, -first.getDay()); return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index)); }
function renderCalendar() {
  $('#calendarMonthLabel').textContent = formatDate(state.calendarMonth, { month: 'long', year: 'numeric' });
  const weekdays = DAY_NAMES.map((name) => `<div class="calendar-weekday">${name}</div>`).join('');
  const today = dateISO(new Date());
  const cells = calendarCells().map((date) => {
    const iso = dateISO(date); const events = state.calendarEvents.filter((event) => event.event_date === iso); const outside = date.getMonth() !== state.calendarMonth.getMonth();
    const shown = events.slice(0, 3).map((event) => `<button class="calendar-event ${event.event_type}" data-event-id="${event.id}" title="${escapeHtml(event.title)}">${EVENT_ICONS[event.event_type]} ${escapeHtml(event.title)}</button>`).join('');
    return `<div class="calendar-day ${outside ? 'outside' : ''} ${iso === today ? 'today' : ''}"><div class="calendar-day-number"><span>${date.getDate()}</span>${events.length ? `<small>${events.length}</small>` : ''}</div><div class="calendar-events">${shown}${events.length > 3 ? `<span class="calendar-more">ועוד ${events.length - 3}</span>` : ''}</div></div>`;
  }).join('');
  $('#calendarGrid').innerHTML = `<div class="calendar-weekdays">${weekdays}</div><div class="calendar-grid">${cells}</div>`;
}
function openCalendarDialog(event = {}) { const form = $('#calendarForm'); form.reset(); form.elements.event_date.value = event.event_date || dateISO(new Date()); form.elements.visibility.value = event.visibility || 'all'; form.elements.event_type.value = event.event_type || 'meeting'; $('#calendarDialog').showModal(); }
function openCalendarEvent(event) {
  $('#calendarEventTitle').textContent = event.title;
  $('#calendarEventDetails').innerHTML = `<div class="event-hero"><strong>${EVENT_ICONS[event.event_type]} ${EVENT_LABELS[event.event_type]}</strong><p>${formatDate(event.event_date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${event.start_time ? ` · ${timeHtml(event.start_time, event.end_time)}` : ''}</p></div><div class="event-detail-row"><strong>נראות</strong><span>${event.visibility === 'all' ? 'כל העובדות' : event.visibility === 'managers' ? 'לינור ואילנית בלבד' : `כיתת ${classById(event.class_id)?.name || ''}`}</span></div>${event.description ? `<div class="event-detail-row"><strong>פירוט</strong><span>${escapeHtml(event.description).replaceAll('\n', '<br>')}</span></div>` : ''}`;
  $('#calendarEventActions').innerHTML = isManager() ? `<button class="danger-btn" data-action="delete-event" data-id="${event.id}">מחיקת אירוע</button>` : '<button type="button" class="ghost-btn close-dialog-inline">סגירה</button>';
  $('#calendarEventDialog').showModal();
}
async function saveCalendarEvent(event) { event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[value="default"]'); const data = formObject(form); setBusy(button, true); try { await apiFetch('/api/calendar', { method: 'POST', body: data }); $('#calendarDialog').close(); await setCalendarMonth(state.calendarMonth); showToast('האירוע נשמר', 'success'); } catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); } }
function handleCalendarClick(event) { const button = event.target.closest('[data-event-id]'); if (!button) return; const item = state.calendarEvents.find((calendarEvent) => calendarEvent.id === button.dataset.eventId); if (item) openCalendarEvent(item); }
async function handleCalendarEventAction(event) { const button = event.target.closest('[data-action],.close-dialog-inline'); if (!button) return; if (button.classList.contains('close-dialog-inline')) return $('#calendarEventDialog').close(); if (button.dataset.action === 'delete-event') { if (!confirm('למחוק את האירוע?')) return; try { await apiFetch('/api/calendar', { method: 'DELETE', body: { id: button.dataset.id } }); $('#calendarEventDialog').close(); await setCalendarMonth(state.calendarMonth); showToast('האירוע נמחק', 'success'); } catch (error) { showToast(error.message, 'error'); } } }

async function showSuggestions(date, classId, shift = null) {
  const start = trimTime(shift?.start_time) || trimTime(state.settings.opening_time) || '07:30'; const end = trimTime(shift?.end_time) || trimTime(state.settings.closing_time) || '15:30'; const dayRows = state.shifts.filter((row) => row.shift_date === date && row.class_id === classId); const role = shift?.shift_role || (!dayRows.some((row) => ['teacher', 'lead'].includes(row.shift_role)) ? 'teacher' : 'staff'); const original = shift ? employeeById(shift.employee_id) : null;
  state.suggestionsContext = { date, classId, start, end, role, shiftId: shift?.id || null, originalName: original?.full_name || '', originalNote: shift?.public_note || '' };
  $('#suggestionsList').innerHTML = `<div class="empty-state">מחפשת עובדות פנויות ל-${start}–${end}…</div>`; $('#suggestionsDialog').showModal();
  try { const params = new URLSearchParams({ date, class_id: classId, start_time: start, end_time: end, shift_role: role }); const result = await apiFetch(`/api/suggestions?${params}`); $('#suggestionsList').innerHTML = result.candidates.length ? result.candidates.map((candidate) => `<article class="suggestion-card"><div class="card-heading"><div><h3>${escapeHtml(candidate.full_name)}</h3><p class="muted">${escapeHtml(candidate.job_title)} · ${timeHtml(start, end)}</p></div><span class="score-chip">התאמה ${candidate.score}</span></div><ul class="reason-list">${candidate.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul><button class="primary-btn" data-action="use-suggestion" data-id="${candidate.employee_id}" data-role="${candidate.suggested_role}">${shift ? 'החלפת העובדת בשיבוץ' : 'שיבוץ העובדת'}</button></article>`).join('') : '<div class="empty-state">לא נמצאה מחליפה זמינה בשעות אלה.</div>'; }
  catch (error) { $('#suggestionsList').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
}
async function handleSuggestionClick(event) { const button = event.target.closest('[data-action="use-suggestion"]'); if (!button) return; const context = state.suggestionsContext; try { if (context.shiftId) { const replacementNote = [context.originalNote, context.originalName ? `מחליפה במקום ${context.originalName}` : 'שובצה כמחליפה'].filter(Boolean).join(' · '); await apiFetch('/api/shifts', { method: 'PATCH', body: { id: context.shiftId, employee_id: button.dataset.id, shift_role: button.dataset.role, public_note: replacementNote } }); } else { await apiFetch('/api/shifts', { method: 'POST', body: { shift_date: context.date, class_id: context.classId, employee_id: button.dataset.id, start_time: context.start, end_time: context.end, shift_role: button.dataset.role, public_note: 'שובצה כהחלפה' } }); } $('#suggestionsDialog').close(); await refreshAll(); showToast(context.shiftId ? 'העובדת הוחלפה בטיוטה' : 'המחליפה שובצה בטיוטה', 'success'); } catch (error) { showToast(error.message, 'error'); } }

function openSettings() { const form = $('#settingsForm'); for (const name of ['opening_time', 'closing_time']) form.elements[name].value = trimTime(state.settings[name]); for (const name of ['required_staff', 'closing_required_staff', 'closing_window_minutes', 'validation_slot_minutes']) form.elements[name].value = state.settings[name]; $('#settingsDialog').showModal(); }
async function saveSettings(event) { event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[value="default"]'); const data = formObject(form); for (const name of ['required_staff', 'closing_required_staff', 'closing_window_minutes', 'validation_slot_minutes']) data[name] = Number(data[name]); setBusy(button, true); try { await apiFetch('/api/settings', { method: 'PATCH', body: data }); $('#settingsDialog').close(); await refreshAll(); showToast('ההגדרות נשמרו', 'success'); } catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); } }

init();
