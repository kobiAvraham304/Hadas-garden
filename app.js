/* מערכת ניהול שיבוצים מעון הדס — גרסה 0.12.0 */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const ROLE_LABELS = { admin: 'מנהלת מעון', scheduler: 'אחראית שיבוץ', employee: 'עובד' };
const SHIFT_ROLE_LABELS = { teacher: 'גננת/גנן', lead: 'מוביל/ה', staff: 'איש/ת צוות', replacement: 'מחליף/ה' };
const SHIFT_STATUS_LABELS = { draft: 'ממתין לפרסום', published: 'פורסם' };
const REQUEST_LABELS = { leave: 'חופשה', day_off: 'יום חופשי', late_start: 'התחלה מאוחרת', early_finish: 'סיום מוקדם', sick: 'מחלה', swap: 'החלפת שיבוץ', other: 'בקשה ישנה' };
const REQUEST_STATUS_LABELS = { pending: 'ממתין', approved: 'אושר', rejected: 'נדחה', applied: 'הוזרם', cancelled: 'בוטל' };
const REQUEST_ICONS = { leave: '☀', day_off: '⌂', late_start: '◷', early_finish: '◴', sick: '✚', swap: '↔', other: '✎' };
const ATTENDANCE_LABELS = { scheduled: 'טרם עודכן', present: 'נכח', late: 'איחר', left_early: 'יצא מוקדם', absent: 'נעדר', sick: 'מחלה', replacement: 'החליף עובד' };
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
  dailyOperations: [],
  dailyShifts: [],
  dailyAttendance: [],
  requests: [],
  acknowledgements: [],
  announcements: [],
  announcementRecipients: [],
  announcementReads: [],
  tasks: [],
  taskAssignees: [],
  calendarEvents: [],
  notifications: [],
  swapCandidates: [],
  swapCandidatesLoading: false,
  publication: null,
  scheduleChanges: [],
  scheduleAbsences: [],
  weekStart: startOfWeek(new Date()),
  attendanceDate: dateISO(new Date()),
  dailyDate: dateISO(new Date()),
  dailySuggestionsContext: null,
  dailyStatusFilter: 'all',
  dailyCache: new Map(),
  dailyInflight: new Map(),
  dailyRequestId: 0,
  calendarMonth: monthStart(new Date()),
  realtimeChannel: null,
  reloadTimer: null,
  pollTimer: null,
  suggestionsContext: null,
  shiftSuggestionCache: new Map(),
  shiftSuggestionRequestId: 0,
  postPublishContext: null,
  lastRefreshAt: 0,
  refreshing: false,
  scheduleLoading: false,
  weekRequestId: 0,
  weekCache: new Map(),
  weekInflight: new Map(),
  expandedWeekDay: null,
  scheduleIssueMap: new Map(),
  calendarCache: new Map(),
  calendarInflight: new Map(),
  calendarRequestId: 0,
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
function closingTimeForDate(value) { const date=parseDateValue(value); return date.getDay()===5 ? trimTime(state.settings.friday_closing_time)||'12:00' : trimTime(state.settings.closing_time)||'15:30'; }
function overlaps(aStart, aEnd, bStart, bEnd) { return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(aEnd) > timeToMinutes(bStart); }
function initials(name) { return String(name || '').trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join(''); }
function isManager() { return ['admin', 'scheduler'].includes(state.profile?.role); }
function scheduleScope() {
  if (state.profile?.schedule_scope) return state.profile.schedule_scope;
  const title = String(state.profile?.job_title || '');
  if (state.profile?.can_view_full_schedule || isManager() || /גנ(?:נ|ן)/.test(title) || ['אחות','מנהלת מעון','מזכירה'].includes(title)) return 'full';
  if (title === 'סייעת מובילה' && state.profile?.primary_class_id) return 'class';
  return 'personal';
}
function canViewFullSchedule() { return scheduleScope() === 'full'; }
function canViewClassSchedule() { return scheduleScope() === 'class'; }
function canViewScheduleGrid() { return ['full','class'].includes(scheduleScope()); }
function visibleScheduleClasses() { return canViewClassSchedule() ? state.classes.filter((item) => item.active && item.id === state.profile?.primary_class_id) : state.classes.filter((item) => item.active); }
function canCreateContent() {
  const title = String(state.profile?.job_title || '');
  return Boolean(state.profile?.can_create_content || isManager() || /גנ(?:נ|ן)/.test(title) || ['אחות','מזכירה'].includes(title));
}
function employeeById(id) { return state.employees.find((item) => item.id === id); }
function classById(id) { return state.classes.find((item) => item.id === id); }
function currentWeekDates() { return Array.from({ length: 6 }, (_, index) => addDays(state.weekStart, index)); }
function showToast(message, type = '') { const toast = $('#toast'); toast.textContent = message; toast.className = `toast ${type}`.trim(); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.add('hidden'), 3800); }
function setScreen(id) { for (const screen of ['loadingScreen', 'loginScreen', 'passwordScreen', 'appShell']) $(`#${screen}`).classList.toggle('hidden', screen !== id); }
function setBusy(button, busy, text = 'שומר…') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.textContent = text;
    button.setAttribute('aria-busy', 'true');
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
    button.removeAttribute('aria-busy');
  }
}
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
    const version = state.config.version || '0.12.0';
    $('#loginVersion').textContent = `גרסה ${version}`;
    if ($('#appVersionBadge')) $('#appVersionBadge').textContent = `v${version}`;
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
  $('#notificationsBtn').addEventListener('click', openNotificationsDialog);
  $('#markAllNotificationsBtn').addEventListener('click', markAllNotificationsRead);
  $('#notificationsList').addEventListener('click', handleNotificationClick);
  $('#refreshBtn').addEventListener('click', () => refreshAll(true));
  $$('.nav-btn[data-tab]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  $('#mobileMoreBtn').addEventListener('click', openMobileMore);
  $('#mobileMoreClose').addEventListener('click', closeMobileMore);
  $('#mobileMoreBackdrop').addEventListener('click', closeMobileMore);
  $$('#mobileMoreSheet [data-more-tab]').forEach((button) => button.addEventListener('click', () => { closeMobileMore(); switchTab(button.dataset.moreTab); }));

  $('#prevWeekBtn').addEventListener('click', () => setWeek(addDays(state.weekStart, -7)));
  $('#nextWeekBtn').addEventListener('click', () => setWeek(addDays(state.weekStart, 7)));
  $('#todayWeekBtn').addEventListener('click', () => setWeek(startOfWeek(new Date())));
  $('#copyWeekBtn').addEventListener('click', openCopyWeekDialog);
  $('#copyReplaceBtn').addEventListener('click', () => copyPreviousWeek('replace'));
  $('#copyMergeBtn').addEventListener('click', () => copyPreviousWeek('merge'));
  $('#addShiftBtn').addEventListener('click', () => openShiftDialog());
  $('#publishScheduleBtn').addEventListener('click', openPublishDialog);
  $('#confirmPublishBtn').addEventListener('click', publishWeek);
  $('#publishSummary').addEventListener('click', handlePublishIssueClick);
  $('#ackScheduleBtn').addEventListener('click', acknowledgeSchedule);
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#printBtn').addEventListener('click', printWeeklySchedule);
  $('#imageBtn').addEventListener('click', downloadScheduleImage);
  $('#monthImageBtn').addEventListener('click', downloadMonthlyScheduleImage);
  $('#scheduleMode').addEventListener('click', (event) => { const button = event.target.closest('[data-mode]'); if (!button) return; state.scheduleMode = button.dataset.mode; storageSet('localStorage', 'hadas-schedule-mode', state.scheduleMode); renderSchedule(); });
  $('#scheduleDaySelect').addEventListener('change', (event) => { state.scheduleDay = Number(event.target.value); storageSet('localStorage', 'hadas-schedule-day', state.scheduleDay); renderSchedule(); });

  $('#newEmployeeBtn').addEventListener('click', () => openEmployeeDialog());
  $('#employeeStatusFilter').addEventListener('change', (event) => { state.employeeStatusFilter = event.target.value; syncFilterChips('#employeeStatusChips', event.target.value); renderEmployees(); });
  $('#employeeClassFilter').addEventListener('change', (event) => { state.employeeClassFilter = event.target.value; renderEmployees(); });
  $('#employeeTypeFilter').addEventListener('change', (event) => { state.employeeTypeFilter = event.target.value; syncFilterChips('#employeeTypeChips', event.target.value); renderEmployees(); });
  $('#employeeStatusChips').addEventListener('click', (event) => handleFilterChip(event, '#employeeStatusFilter', 'employeeStatusFilter', renderEmployees));
  $('#employeeTypeChips').addEventListener('click', (event) => handleFilterChip(event, '#employeeTypeFilter', 'employeeTypeFilter', renderEmployees));
  $('#employeeSummary').addEventListener('click', handleEmployeeSummaryClick);
  $('#employeeSearch').addEventListener('input', debounce((event) => { state.employeeSearch = event.target.value; renderEmployees(); }));
  $('#employeeForm [name="job_title"]').addEventListener('change', syncEmployeeAssignmentFields);
  $('#employeeForm [name="assignment_mode"]').addEventListener('change', syncEmployeeAssignmentFields);

  $('#newRequestBtn').addEventListener('click', openRequestDialog);
  $('#requestStatusFilter').addEventListener('change', (event) => { state.requestStatusFilter = event.target.value; syncFilterChips('#requestStatusChips', event.target.value); renderRequests(); });
  $('#requestStatusChips').addEventListener('click', (event) => handleFilterChip(event, '#requestStatusFilter', 'requestStatusFilter', renderRequests));
  $('#requestSearch').addEventListener('input', debounce((event) => { state.requestSearch = event.target.value; renderRequests(); }));
  $$('input[name="request_type"]', $('#requestForm')).forEach((input) => input.addEventListener('change', updateRequestFields));
  $('#requestForm [name="request_date"]').addEventListener('change', handleRequestDateChange);
  $('#requestForm [name="request_end_date"]').addEventListener('change', updateRequestFields);
  $('#requestForm [name="shift_id"]').addEventListener('change', syncRequestDateFromShift);

  $('#dailyDate').addEventListener('change', async (event) => { state.dailyDate = event.target.value; await loadDailyOperations(state.dailyDate); });
  $('#dailyStatusChips').addEventListener('click', (event) => handleDailyFilterClick(event));
  $('#markAllPresentBtn').addEventListener('click', markAllPresent);
  $('#dailyRefreshBtn').addEventListener('click', () => loadDailyOperations(state.dailyDate, { force:true }));
  $('#dailyReportForm').addEventListener('submit', saveDailyReport);
  $$('input[name="operation_type"]', $('#dailyReportForm')).forEach((input) => input.addEventListener('change', syncDailyReportFields));
  $('#dailyClasses').addEventListener('click', handleDailyClick);
  $('#dailySuggestionsList').addEventListener('click', handleDailySuggestionClick);
  $('#dailyAttendanceForm').addEventListener('submit', saveDailyAttendance);
  $$('input[name="status"]', $('#dailyAttendanceForm')).forEach((input) => input.addEventListener('change', syncDailyAttendanceFields));
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
  $('#shiftForm [name="employee_id"]').addEventListener('change', () => { syncShiftHoursFromPattern(); updateShiftEmployeeHint(); });
  $('#shiftForm [name="shift_date"]').addEventListener('change', () => { syncShiftHoursFromPattern(); queueShiftRecommendations(); });
  for (const name of ['class_id','start_time','end_time','shift_role']) $('#shiftForm [name="'+name+'"]').addEventListener(name.includes('time') ? 'input' : 'change', queueShiftRecommendations);
  $('#shiftRecommendations').addEventListener('click', handleShiftRecommendationClick);
  $('#publishChangeNowBtn').addEventListener('click', publishPendingChangeNow);
  $('#employeeForm').addEventListener('submit', saveEmployee);
  $('#requestForm').addEventListener('submit', saveRequest);
  $('#announcementForm').addEventListener('submit', saveAnnouncement);
  $('#taskForm').addEventListener('submit', saveTask);
  $('#calendarForm').addEventListener('submit', saveCalendarEvent);
  $('#settingsForm').addEventListener('submit', saveSettings);
  $('#settingsForm').addEventListener('input', renderSettingsPreview);
  $('#settingsPresetBtn').addEventListener('click', () => applyStandardsPreset(4, 3, 30));
  $('#settingsPresetFullBtn').addEventListener('click', () => applyStandardsPreset(4, 4, 0));
  $('#settingsPresetLeanBtn').addEventListener('click', () => applyStandardsPreset(3, 3, 0));

  $$('.close-dialog').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
  $('#scheduleExport').addEventListener('click', handleScheduleClick);
  $('#scheduleWarnings').addEventListener('click', handleScheduleWarningClick);
  $('#employeesList').addEventListener('click', handleEmployeeClick);
  $('#requestsList').addEventListener('click', handleRequestClick);
  $('#attendanceList').addEventListener('click', handleAttendanceClick);
  $('#announcementsList').addEventListener('click', handleAnnouncementClick);
  $('#tasksList').addEventListener('click', handleTaskClick);
  $('#calendarGrid').addEventListener('click', handleCalendarClick);
  $('#calendarGrid').addEventListener('keydown', handleCalendarKeydown);
  $('#calendarEventActions').addEventListener('click', handleCalendarEventAction);
  $('#suggestionsList').addEventListener('click', handleSuggestionClick);
  $('#dashboardPanel').addEventListener('click', (event) => {
    const notificationButton = event.target.closest('[data-dashboard-notifications]');
    if (notificationButton) return openNotificationsDialog();
    const button = event.target.closest('[data-dashboard-tab]');
    if (button) switchTab(button.dataset.dashboardTab);
  });

  window.addEventListener('online', () => { setSyncState('online', 'חזר החיבור — מעדכן'); refreshAll(); });
  window.addEventListener('offline', () => setSyncState('offline', 'אין חיבור — הנתונים נשארים במסך'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - state.lastRefreshAt > 45000) refreshAll(); });
}

function syncFilterChips(selector, value) { $$(selector + ' [data-value]').forEach((button) => button.classList.toggle('active', button.dataset.value === value)); }
function handleFilterChip(event, selectSelector, stateKey, renderer) {
  const button = event.target.closest('[data-value]'); if (!button) return;
  const value = button.dataset.value; state[stateKey] = value;
  const select = $(selectSelector); if (select) select.value = value;
  syncFilterChips(event.currentTarget.id ? `#${event.currentTarget.id}` : '', value); renderer();
}
function openMobileMore() { const sheet = $('#mobileMoreSheet'); sheet.classList.remove('hidden'); sheet.setAttribute('aria-hidden', 'false'); document.body.classList.add('sheet-open'); }
function closeMobileMore() { const sheet = $('#mobileMoreSheet'); sheet.classList.add('hidden'); sheet.setAttribute('aria-hidden', 'true'); document.body.classList.remove('sheet-open'); }

async function handleLogin(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button'); setBusy(button, true, 'מתחבר…');
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
async function enterApp() { setScreen('appShell'); applyPermissions(); $('#attendanceDate').value = state.attendanceDate; $('#dailyDate').value = state.dailyDate; switchTab(state.activeTab); await refreshAll(); subscribeRealtime(); }
function applyPermissions() {
  $$('.manager-only').forEach((element) => element.classList.toggle('hidden', !isManager()));
  $$('.employee-only').forEach((element) => element.classList.toggle('hidden', isManager()));
  $$('.content-creator-only').forEach((element) => element.classList.toggle('hidden', !canCreateContent()));
  const scheduleGrid = canViewScheduleGrid();
  $$('#scheduleMode [data-mode="week"], #scheduleMode [data-mode="day"]').forEach((element) => element.classList.toggle('hidden', !scheduleGrid));
  if (!scheduleGrid) {
    state.scheduleMode = 'mine';
    storageSet('localStorage', 'hadas-schedule-mode', 'mine');
  }
  $('#userName').textContent = state.profile?.full_name || '';
  $('#userRole').textContent = `${ROLE_LABELS[state.profile?.role] || state.profile?.role || ''} · ${state.profile?.job_title || ''}`;
}
function switchTab(tab) {
  if ((tab === 'employees' || tab === 'daily') && !isManager()) tab = 'dashboard';
  const secondaryTabs = new Set(['daily', 'attendance', 'tasks', 'calendar', 'employees']);
  state.activeTab = tab; storageSet('sessionStorage', 'hadas-active-tab', tab);
  $$('.nav-btn[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  $('#mobileMoreBtn').classList.toggle('active', secondaryTabs.has(tab));
  $$('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === `${tab}Panel`));
  closeMobileMore();
  if (tab === 'daily' && isManager()) loadDailyOperations(state.dailyDate).catch(() => {});
  else renderPanel(tab);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function scheduleCacheKey(date = state.weekStart) { return dateISO(startOfWeek(date)); }
function schedulePayloadFromState() {
  return {
    shifts: state.shifts,
    publication: state.publication,
    scheduleChanges: state.scheduleChanges,
    scheduleAbsences: state.scheduleAbsences,
    acknowledgements: state.acknowledgements,
    settings: state.settings,
  };
}
function cacheSchedulePayload(key, payload) {
  state.weekCache.set(key, { payload, fetchedAt: Date.now() });
  if (state.weekCache.size > 8) {
    const oldest = [...state.weekCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)[0]?.[0];
    if (oldest) state.weekCache.delete(oldest);
  }
}
function applySchedulePayload(payload) {
  state.shifts = payload.shifts || [];
  state.publication = payload.publication || null;
  state.scheduleChanges = payload.scheduleChanges || [];
  state.scheduleAbsences = payload.scheduleAbsences || [];
  state.acknowledgements = payload.acknowledgements || [];
  if (payload.settings) state.settings = { ...state.settings, ...payload.settings };
}
function renderScheduleLoading() {
  $('#weekLabel').textContent = `${formatDate(state.weekStart, { day: 'numeric', month: 'long' })} – ${formatDate(addDays(state.weekStart, 5), { day: 'numeric', month: 'long', year: 'numeric' })}`;
  $('#schedulePublicationState').innerHTML = '<div class="publication-banner"><div><strong>טוען את השבוע…</strong><small>השיבוץ יופיע מיד.</small></div><span class="loading-dot"></span></div>';
  $('#scheduleWarnings').innerHTML = '';
  $('#scheduleExport').className = `schedule-wrap mode-${state.scheduleMode}`;
  $('#scheduleExport').innerHTML = '<div class="schedule-loading"><span></span><span></span><span></span><p>טוען שיבוצים…</p></div>';
  $('#scheduleAbsences').innerHTML = '';
}
async function fetchScheduleWeek(weekStart, { force = false, apply = true } = {}) {
  const key = scheduleCacheKey(weekStart);
  const cached = state.weekCache.get(key);
  if (!force && cached && Date.now() - cached.fetchedAt < 180000) {
    if (apply) { applySchedulePayload(cached.payload); renderSchedule(); }
    return cached.payload;
  }
  const requestId = apply ? ++state.weekRequestId : state.weekRequestId;
  if (apply) { state.scheduleLoading = true; document.body.classList.add('schedule-is-loading'); }
  let request = null;
  try {
    request = !force ? state.weekInflight.get(key) : null;
    if (!request) {
      request = apiFetch(`/api/shifts?week_start=${key}`, { timeout: 9000 });
      state.weekInflight.set(key, request);
    }
    const payload = await request;
    cacheSchedulePayload(key, payload);
    if (apply && requestId === state.weekRequestId && key === scheduleCacheKey()) {
      applySchedulePayload(payload);
      renderSchedule();
      setSyncState('online', 'מעודכן בזמן אמת');
    }
    return payload;
  } catch (error) {
    if (apply) showToast(error.message, 'error');
    throw error;
  } finally {
    if (request && state.weekInflight.get(key) === request) state.weekInflight.delete(key);
    if (apply && requestId === state.weekRequestId) {
      state.scheduleLoading = false;
      document.body.classList.remove('schedule-is-loading');
    }
  }
}
function prefetchAdjacentWeeks() {
  const weeks = [addDays(state.weekStart, -7), addDays(state.weekStart, 7)];
  const run = () => weeks.forEach((week) => {
    const cached = state.weekCache.get(scheduleCacheKey(week));
    if (!cached || Date.now() - cached.fetchedAt > 180000) fetchScheduleWeek(week, { apply: false }).catch(() => {});
  });
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 1800 }); else setTimeout(run, 300);
}
async function refreshScheduleWeek({ force = true } = {}) {
  await fetchScheduleWeek(state.weekStart, { force, apply: true });
  const today = dateISO(new Date());
  if (currentWeekDates().some((date) => dateISO(date) === today)) state.todayShifts = state.shifts.filter((shift) => shift.shift_date === today);
}
async function setWeek(date) {
  const target = startOfWeek(date); const key = scheduleCacheKey(target);
  if (key === scheduleCacheKey() && !state.scheduleLoading) return;
  state.weekStart = target; state.expandedWeekDay = null;
  const cached = state.weekCache.get(key);
  if (cached) {
    applySchedulePayload(cached.payload); renderSchedule();
    const stale = Date.now() - cached.fetchedAt > 30000;
    if (stale) fetchScheduleWeek(target, { force: true, apply: true }).then(prefetchAdjacentWeeks).catch(() => {}); else prefetchAdjacentWeeks();
    return;
  }
  renderScheduleLoading();
  try { await fetchScheduleWeek(target, { force: false, apply: true }); prefetchAdjacentWeeks(); } catch {}
}

async function refreshAll(showSuccess = false) {
  if (state.refreshing) return;
  state.refreshing = true; const button = $('#refreshBtn'); if (button) setBusy(button, true, 'מעדכן…'); setSyncState('syncing', 'מעדכן נתונים…');
  try {
    const url = `/api/data?week_start=${dateISO(state.weekStart)}&attendance_date=${state.attendanceDate}&daily_date=${state.dailyDate}&calendar_month=${monthParam(state.calendarMonth)}`;
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
      dailyOperations: data.dailyOperations || [],
      dailyShifts: data.dailyShifts || [],
      dailyAttendance: data.dailyAttendance || [],
      requests: data.requests,
      acknowledgements: data.acknowledgements,
      announcements: data.announcements,
      announcementRecipients: data.announcementRecipients || [],
      announcementReads: data.announcementReads,
      tasks: data.tasks,
      taskAssignees: data.taskAssignees,
      calendarEvents: data.calendarEvents,
      notifications: data.notifications || [],
      publication: data.publication || null,
      scheduleChanges: data.scheduleChanges || [],
      scheduleAbsences: data.scheduleAbsences || [],
    });
    cacheSchedulePayload(scheduleCacheKey(), schedulePayloadFromState());
    if(isManager()) state.dailyCache.set(state.dailyDate,{ operations:state.dailyOperations,shifts:state.dailyShifts,attendance:state.dailyAttendance,fetchedAt:Date.now() });
    state.calendarCache.set(monthParam(state.calendarMonth), { events: state.calendarEvents, fetchedAt: Date.now() });
    state.lastRefreshAt = Date.now(); applyPermissions(); populateSelects(); renderAll(); prefetchAdjacentWeeks(); setSyncState('online', 'מעודכן בזמן אמת');
    prefetchCalendarMonths();
    if (showSuccess) showToast('הנתונים עודכנו', 'success');
  } catch (error) {
    setSyncState(navigator.onLine ? 'error' : 'offline', navigator.onLine ? 'העדכון נכשל — נסו רענון' : 'אין חיבור'); showToast(error.message, 'error');
  } finally { state.refreshing = false; if (button) setBusy(button, false); }
}
function subscribeRealtime() {
  if (!state.realtimeClient) return;
  if (state.realtimeChannel) state.realtimeClient.removeChannel(state.realtimeChannel);
  state.realtimeChannel = state.realtimeClient.channel('hadas-public-refresh').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hadas_realtime_events' }, (payload) => {
    const topic = String(payload?.new?.topic || 'refresh');
    clearTimeout(state.reloadTimer);
    state.reloadTimer = setTimeout(() => {
      if (['daily_operations','attendance'].includes(topic) && state.activeTab === 'daily') { invalidateDailyCache(state.dailyDate); loadDailyOperations(state.dailyDate,{ force:true }).catch(() => {}); }
      else if (['shifts', 'schedule_ack', 'settings', 'requests'].includes(topic) && state.activeTab === 'schedule') refreshScheduleWeek({ force: true }).catch(() => {});
      else if (topic === 'calendar' && state.activeTab === 'calendar') setCalendarMonth(state.calendarMonth, { force: true }).catch(() => {});
      else refreshAll();
    }, 220);
  }).subscribe((status) => {
    if (status === 'SUBSCRIBED') setSyncState('online', 'מעודכן בזמן אמת');
    else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) setSyncState('error', 'עדכון חי נותק — קיים רענון אוטומטי');
  });
  clearInterval(state.pollTimer); state.pollTimer = setInterval(() => { if (!document.hidden && Date.now() - state.lastRefreshAt > 90000) refreshAll(); }, 120000);
}

function employeePickerHtml(name, selected = []) {
  const chosen = new Set(selected);
  return state.employees.filter((employee) => employee.active).map((employee) => `<label class="employee-check"><input type="checkbox" name="${name}" value="${employee.id}" ${chosen.has(employee.id) ? 'checked' : ''}/><span>${escapeHtml(employee.full_name)}<small> ${escapeHtml(employee.job_title)}</small></span></label>`).join('');
}
function populateSelects() {
  const classOptions = state.classes.filter((item) => item.active).map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
  const employeeOptions = state.employees.filter((item) => item.active && item.is_schedulable !== false).map((item) => `<option value="${item.id}">${escapeHtml(item.full_name)} — ${escapeHtml(item.job_title)}</option>`).join('');
  $('#shiftForm [name="class_id"]').innerHTML = classOptions;
  $('#shiftForm [name="employee_id"]').innerHTML = employeeOptions;
  $('#employeeForm [name="primary_class_id"]').innerHTML = `<option value="">ללא כיתה קבועה</option>${classOptions}`;
  $('#requestForm [name="target_employee_id"]').innerHTML = '<option value="">בחרו תאריך כדי לראות עובדים זמינים</option>';
  $('#announcementForm [name="class_id"]').innerHTML = `<option value="">בחר כיתה</option>${classOptions}`;
  $('#taskForm [name="target_id"]').innerHTML = `<option value="">בחר כיתה</option>${classOptions}`;
  $('#calendarForm [name="class_id"]').innerHTML = `<option value="">ללא</option>${classOptions}`;
  $('#announcementEmployeesField').innerHTML = employeePickerHtml('announcement_employee_ids');
  $('#taskEmployeesField').innerHTML = employeePickerHtml('task_employee_ids');
  $('#employeeClassFilter').innerHTML = `<option value="all">כל הכיתות</option><option value="none">ללא כיתה</option>${classOptions}`;
}
function renderPanel(tab) {
  if (tab === 'dashboard') return renderDashboard();
  if (tab === 'schedule') return renderSchedule();
  if (tab === 'requests') return renderRequests();
  if (tab === 'daily' && isManager()) return renderDailyOperations();
  if (tab === 'attendance') return renderAttendance();
  if (tab === 'announcements') return renderAnnouncements();
  if (tab === 'tasks') return renderTasks();
  if (tab === 'calendar') return renderCalendar();
  if (tab === 'employees' && isManager()) return renderEmployees();
}
function renderAll() { renderDashboard(); renderPanel(state.activeTab); renderNavBadges(); }
function renderNavBadges() {
  const unread = state.announcements.filter((announcement) => !state.announcementReads.some((read) => read.announcement_id === announcement.id && read.employee_id === state.profile.id)).length;
  const openTasks = state.taskAssignees.filter((assignment) => assignment.employee_id === state.profile.id && assignment.status !== 'done').length;
  const notificationCount = state.notifications.filter((item) => !item.read_at).length;
  for (const [id, count] of [['announcementBadge', unread], ['taskBadge', openTasks], ['notificationBadge', notificationCount]]) { const element = $(`#${id}`); if (!element) continue; element.textContent = count > 99 ? '99+' : String(count); element.classList.toggle('hidden', !count); }
}

function coverageFor(rows, dateValue = dateISO(new Date())) {
  const count = new Set(rows.map((shift) => shift.employee_id)).size;
  const open = timeToMinutes(state.settings.opening_time || '07:30');
  const close = timeToMinutes(closingTimeForDate(dateValue));
  const slot = Number(state.settings.validation_slot_minutes || 30);
  const closingWindow = Number(state.settings.closing_window_minutes || 30);
  const requireLeader = state.settings.require_leader !== false;
  let closing = Infinity; let leader = true; let ok = true;
  for (let minute = open; minute < close; minute += slot) {
    const end = Math.min(minute + slot, close);
    const startText = minutesLabel(minute); const endText = minutesLabel(end);
    const active = rows.filter((shift) => overlaps(shift.start_time, shift.end_time, startText, endText));
    const activeCount = new Set(active.map((shift) => shift.employee_id)).size;
    const required = minute >= close - closingWindow ? Number(state.settings.closing_required_staff || 3) : Number(state.settings.required_staff || 4);
    if (minute >= close - closingWindow) closing = Math.min(closing, activeCount);
    if (activeCount < required) ok = false;
    if (requireLeader && !active.some((shift) => ['teacher', 'lead'].includes(shift.shift_role))) { leader = false; ok = false; }
  }
  if (!Number.isFinite(closing)) closing = 0;
  return { count, closing, leader, ok };
}
function shiftLineHtml(shift) {
  const employee = employeeById(shift.employee_id);
  return `<div class="employee-line"><span><strong>${escapeHtml(employee?.full_name || 'עובד')}</strong><small>${SHIFT_ROLE_LABELS[shift.shift_role]}${shift.public_note ? ` · ${escapeHtml(shift.public_note)}` : ''}</small></span>${timeHtml(shift.start_time, shift.end_time)}</div>`;
}
function renderDashboard() {
  const today=dateISO(new Date());
  const shifts=state.todayShifts.length?state.todayShifts:state.shifts.filter((shift)=>shift.shift_date===today&&shift.status==='published');
  const mine=shifts.filter((shift)=>shift.employee_id===state.profile.id);
  const gridViewer=canViewScheduleGrid();
  const staffed=new Set(shifts.map((shift)=>shift.employee_id));
  const pending=state.requests.filter((request)=>request.status==='pending').length;
  const dueTasks=state.taskAssignees.filter((assignment)=>assignment.employee_id===state.profile.id&&assignment.status!=='done').length;
  const unread=state.announcements.filter((announcement)=>!state.announcementReads.some((read)=>read.announcement_id===announcement.id&&read.employee_id===state.profile.id)).length;
  const unreadNotifications=state.notifications.filter((item)=>!item.read_at).length;
  const absentToday=state.scheduleAbsences.filter((item)=>item.absence_date===today).length;
  const dailyOpen=state.dailyOperations.filter((item)=>item.status==='open'&&item.operation_date===today).length;
  const quickActions=isManager()?`<section class="quick-actions"><button data-dashboard-tab="daily" class="quick-sun"><span>⚡</span><strong>תפעול יומי</strong><small>${dailyOpen} אירועים פתוחים</small></button><button data-dashboard-tab="schedule" class="quick-blue"><span>▦</span><strong>בניית שיבוץ</strong><small>הוספה, בדיקה ופרסום</small></button><button data-dashboard-tab="employees" class="quick-lilac"><span>♙</span><strong>ניהול עובדים</strong><small>שעות, כיתה ואילוצים</small></button><button data-dashboard-tab="requests" class="quick-coral"><span>↔</span><strong>בקשות והחלפות</strong><small>${pending} ממתינים לטיפול</small></button></section>`:`<section class="quick-actions"><button data-dashboard-tab="schedule" class="quick-blue"><span>▦</span><strong>${gridViewer?'השיבוץ השבועי':'השיבוץ שלי'}</strong><small>${gridViewer?'צפייה בשיבוץ המורשה':'הימים והשעות שלי'}</small></button><button data-dashboard-tab="requests" class="quick-coral"><span>↔</span><strong>בקשה חדשה</strong><small>חופשה, מחלה או החלפה</small></button><button data-dashboard-tab="tasks" class="quick-lilac"><span>☑</span><strong>המשימות שלי</strong><small>${dueTasks} פתוחות</small></button><button data-dashboard-tab="announcements" class="quick-sun"><span>◉</span><strong>הודעות</strong><small>${unread} טרם נקראו</small></button></section>`;
  const summary=`<div class="dashboard-grid dashboard-action-grid">
    <article class="summary-card tone-blue"><span class="summary-icon">▦</span><span class="caption">השיבוץ שלי היום</span><span class="metric">${mine.length||'—'}</span><small>${mine.length?mine.map((shift)=>`${classById(shift.class_id)?.name||''} ${trimTime(shift.start_time)}–${trimTime(shift.end_time)}`).join(' · '):'אין שיבוץ'}</small></article>
    <button type="button" class="summary-card tone-lilac summary-card-button" data-dashboard-notifications><span class="summary-icon">🔔</span><span class="caption">עדכונים חדשים</span><span class="metric">${unreadNotifications}</span><small>בקשות, שיבוצים ופעולות שקשורות אליך</small><b class="card-link">פתיחת עדכונים ›</b></button>
    <button type="button" class="summary-card tone-coral summary-card-button" data-dashboard-tab="requests"><span class="summary-icon">↔</span><span class="caption">בקשות ממתינות</span><span class="metric">${pending}</span><small>${isManager()?'דורשות טיפול וקבלת החלטה':'הבקשות שלך והחלפות שמחכות לך'}</small><b class="card-link">לצפייה בבקשות ›</b></button>
    <button type="button" class="summary-card tone-sun summary-card-button" data-dashboard-tab="announcements"><span class="summary-icon">◉</span><span class="caption">הודעות שלא נקראו</span><span class="metric">${unread}</span><small>עדכונים חשובים מצוות המעון</small><b class="card-link">לצפייה בהודעות ›</b></button>
  </div>`;
  let details='';
  if(gridViewer){
    const visibleClasses=canViewClassSchedule()?state.classes.filter((item)=>item.id===state.profile.primary_class_id):state.classes.filter((item)=>item.active);
    const classCards=visibleClasses.map((item,index)=>{ const rows=shifts.filter((shift)=>shift.class_id===item.id); const result=coverageFor(rows,today); return `<article class="class-card class-tone-${index%4}"><div class="class-card-top"><span class="class-symbol">${['☁','✿','☀','★'][index%4]}</span><div class="card-heading"><h3>${escapeHtml(item.name)}</h3><span class="status-chip ${result.ok?'ok':'error'}">${result.ok?'תקין':'דורש טיפול'}</span></div></div>${rows.length?rows.map(shiftLineHtml).join(''):'<div class="empty-state compact">אין שיבוץ להיום</div>'}<p class="small-note">${result.count} משובצים · ${result.closing} בסגירה${state.settings.require_leader!==false?` · ${result.leader?'יש אחראי/ת כיתה':'חסר/ה אחראי/ת כיתה'}`:''}</p></article>`; }).join('');
    details=`<div class="section-heading dashboard-section"><div><p class="eyebrow">תמונת מצב יומית</p><h2>${canViewClassSchedule()?'הכיתה שלי היום':'מצב הכיתות היום'}</h2><p class="muted">${staffed.size} עובדים משובצים · ${absentToday} בחופשה או בהיעדרות</p></div></div><div class="dashboard-grid class-grid">${classCards}</div>`;
  }else{
    details=`<div class="section-heading dashboard-section"><div><p class="eyebrow">היום שלי</p><h2>פרטי השיבוץ שלי</h2></div></div><div class="my-schedule-list">${mine.length?mine.map((shift)=>`<article class="my-day-card"><div class="my-day-date"><strong>${escapeHtml(classById(shift.class_id)?.name||'')}</strong><span>${timeHtml(shift.start_time,shift.end_time)}</span></div><div class="my-day-shifts"><div class="shift-item"><strong>${SHIFT_ROLE_LABELS[shift.shift_role]}</strong><small>${escapeHtml(shift.public_note||'ללא הערה')}</small></div></div></article>`).join(''):'<div class="empty-state">אין לך שיבוץ היום.</div>'}</div>`;
  }
  $('#dashboardPanel').innerHTML=`<div class="dashboard-welcome"><div class="welcome-copy"><span class="welcome-kicker">✿ יום נעים במעון הדס</span><h2>שלום ${escapeHtml(state.profile.full_name)}</h2><p>${formatDate(today,{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p></div><div class="welcome-illustration" aria-hidden="true"><span class="cloud cloud-one"></span><span class="cloud cloud-two"></span><span class="sun-shape">☀</span><span class="flower-shape">✿</span></div><span class="dashboard-role">${escapeHtml(ROLE_LABELS[state.profile.role]||state.profile.job_title)}</span></div>${summary}${quickActions}${details}`;
}

function compactProblemRanges(rows, includeCounts = false) {
  if (!rows.length) return '';
  const ranges = [];
  let current = { start: rows[0].start, end: rows[0].end, counts: includeCounts ? [rows[0].count] : [] };
  for (const row of rows.slice(1)) {
    if (row.start === current.end) {
      current.end = row.end;
      if (includeCounts) current.counts.push(row.count);
    } else {
      ranges.push(current);
      current = { start: row.start, end: row.end, counts: includeCounts ? [row.count] : [] };
    }
  }
  ranges.push(current);
  return ranges.map((range) => {
    const minimum = includeCounts && range.counts.length ? ` · בפועל לפחות ${Math.min(...range.counts)}` : '';
    return `${range.start}–${range.end}${minimum}`;
  }).join(', ');
}
function validateScheduleClient() {
  const issues = []; const warnings = [];
  const open = timeToMinutes(state.settings.opening_time || '07:30');
  const slot = Math.max(15, Number(state.settings.validation_slot_minutes || 30));
  const closingWindow = Math.max(15, Number(state.settings.closing_window_minutes || 30));
  const requireLeader = state.settings.require_leader !== false;
  for (const date of currentWeekDates().map(dateISO)) {
    const close = timeToMinutes(closingTimeForDate(date));
    for (const classItem of state.classes.filter((item) => item.active)) {
      const staffProblems = []; const leaderProblems = [];
      for (let minute = open; minute < close; minute += slot) {
        const endMinute = Math.min(minute + slot, close);
        const startText = minutesLabel(minute); const endText = minutesLabel(endMinute);
        const rows = state.shifts.filter((shift) => shift.shift_date === date && shift.class_id === classItem.id && overlaps(shift.start_time, shift.end_time, startText, endText));
        const count = new Set(rows.map((shift) => shift.employee_id)).size;
        const required = minute >= close - closingWindow ? Number(state.settings.closing_required_staff || 3) : Number(state.settings.required_staff || 4);
        if (count < required) staffProblems.push({ start: startText, end: endText, count, required });
        if (requireLeader && !rows.some((shift) => ['teacher', 'lead'].includes(shift.shift_role))) leaderProblems.push({ start: startText, end: endText });
      }
      if (staffProblems.length || leaderProblems.length) {
        const details = [];
        if (staffProblems.length) details.push(`חוסר בכוח אדם: ${compactProblemRanges(staffProblems, true)}`);
        if (leaderProblems.length) details.push(`חסר/ה אחראי/ת כיתה: ${compactProblemRanges(leaderProblems)}`);
        issues.push({ id: `coverage-${date}-${classItem.id}`, kind: 'coverage', date, classId: classItem.id, title: `${classItem.name} · ${formatDate(date, { weekday: 'long', day: '2-digit', month: '2-digit' })}`, text: details.join(' · ') });
      }
    }
  }
  for (const employee of state.employees.filter((item) => item.active && item.is_schedulable !== false)) {
    const hours = state.shifts.filter((shift) => shift.employee_id === employee.id).reduce((sum, shift) => sum + (timeToMinutes(shift.end_time) - timeToMinutes(shift.start_time)) / 60, 0);
    if (employee.max_weekly_hours != null && hours > Number(employee.max_weekly_hours)) {
      issues.push({ id: `max-hours-${employee.id}`, kind: 'hours', employeeId: employee.id, title: employee.full_name, text: `שובץ ${hours.toFixed(1)} שעות ועבר את המקסימום השבועי ${Number(employee.max_weekly_hours).toFixed(1)}` });
    } else if (employee.weekly_hours != null && Math.abs(hours - Number(employee.weekly_hours)) >= 2) {
      warnings.push({ id: `hours-${employee.id}`, kind: 'hours', employeeId: employee.id, title: employee.full_name, text: `שובץ ${hours.toFixed(1)} שעות מתוך ${Number(employee.weekly_hours).toFixed(1)}` });
    }
  }
  return { errors: issues, warnings };
}
function minutesLabel(value) { return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
function renderWarnings() {
  if (!isManager()) { $('#scheduleWarnings').innerHTML = ''; return; }
  const validation = validateScheduleClient();
  state.scheduleIssueMap = new Map([...validation.errors, ...validation.warnings].map((item) => [item.id, item]));
  if (!validation.errors.length && !validation.warnings.length) {
    $('#scheduleWarnings').innerHTML = '<div class="schedule-health-card is-ok"><span>✓</span><div><strong>השיבוץ עומד בבדיקות התקינה</strong><small>לא נמצאו חוסרים, חריגות שעות או התראות המחייבות טיפול.</small></div></div>';
    return;
  }
  const errorCards=validation.errors.map((item)=>{
    const isCoverage=item.kind==='coverage';
    return `<article class="schedule-issue-card is-error" data-issue-card="${escapeHtml(item.id)}"><div class="issue-icon">!</div><div class="issue-copy"><span class="issue-level">שגיאה שחוסמת פרסום</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text)}</p><small>${isCoverage?'דרך תיקון: הוסיפו עובד מתאים או הפעילו הצעה אוטומטית לשעות החסרות.':'דרך תיקון: פתחו את כרטיס העובד ובדקו שעות, מקסימום שבועי או שיבוצים כפולים.'}</small></div><div class="issue-actions">${isCoverage?`<button type="button" class="primary-btn" data-issue-id="${escapeHtml(item.id)}" data-fix-action="suggest">הצעת עובד מתאים</button><button type="button" class="ghost-btn" data-issue-id="${escapeHtml(item.id)}" data-fix-action="add">הוספת שיבוץ ידנית</button>`:`<button type="button" class="primary-btn" data-issue-id="${escapeHtml(item.id)}" data-fix-action="employee">פתיחת כרטיס העובד</button>`}</div></article>`;
  }).join('');
  const warningCards=validation.warnings.map((item)=>`<article class="schedule-issue-card is-warning" data-issue-card="${escapeHtml(item.id)}"><div class="issue-icon">i</div><div class="issue-copy"><span class="issue-level">התראה לבדיקה</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text)}</p><small>ההתראה אינה חוסמת פרסום, אך מומלץ לבדוק לפני שליחה לצוות.</small></div><div class="issue-actions"><button type="button" class="ghost-btn" data-issue-id="${escapeHtml(item.id)}" data-fix-action="employee">בדיקת העובד</button></div></article>`).join('');
  $('#scheduleWarnings').innerHTML = `<details class="warning-details upgraded-warning-details" open><summary><span><b>${validation.errors.length}</b> שגיאות · <b>${validation.warnings.length}</b> התראות</span><small>לכל שגיאה מוצגת דרך תיקון ישירה</small></summary><div class="schedule-issue-toolbar"><span>תקנו את השגיאות האדומות לפני פרסום השיבוץ.</span><button type="button" class="ghost-btn" data-fix-action="settings">פתיחת הגדרות תקינה</button></div><div class="warning-details-list">${errorCards}${warningCards}</div></details>`;
}
function focusScheduleIssue(issue) {
  const index = currentWeekDates().findIndex((date) => dateISO(date) === issue.date);
  state.scheduleDay = Math.max(0, index); state.scheduleMode = 'day';
  storageSet('localStorage', 'hadas-schedule-mode', 'day'); storageSet('localStorage', 'hadas-schedule-day', state.scheduleDay);
  renderSchedule();
  requestAnimationFrame(() => {
    const card = document.querySelector(`[data-day-class="${issue.classId}"]`);
    if (card) { card.classList.add('attention-pulse'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => card.classList.remove('attention-pulse'), 1800); }
  });
}
function handleScheduleWarningClick(event) {
  const settingsButton=event.target.closest('[data-fix-action="settings"]');
  if(settingsButton)return openSettings();
  const button = event.target.closest('[data-issue-id]'); if (!button) return;
  const issue = state.scheduleIssueMap.get(button.dataset.issueId); if (!issue) return;
  const action=button.dataset.fixAction||'';
  if (issue.kind === 'hours' || action==='employee') {
    switchTab('employees');
    const card = document.querySelector(`[data-employee-card="${issue.employeeId}"]`);
    if (card) { card.classList.add('attention-pulse'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => card.classList.remove('attention-pulse'), 1800); }
    return;
  }
  if(action==='add')return openShiftDialog({shift_date:issue.date,class_id:issue.classId});
  if(action==='suggest')return showSuggestions(issue.date,issue.classId,null);
  focusScheduleIssue(issue);
}

function renderPublicationState() {
  const drafts = state.shifts.filter((shift) => shift.status === 'draft').length;
  const published = state.publication?.published_at;
  const text = drafts
    ? `<div class="publication-banner draft"><div><strong>${drafts} שיבוצים או שינויים ממתינים לפרסום</strong><small>הצוות ממשיך לראות את הגרסה האחרונה שפורסמה.</small></div><span class="status-chip draft">טיוטה</span></div>`
    : published
      ? `<div class="publication-banner published"><div><strong>השיבוץ פורסם לצוות</strong><small>גרסה ${state.publication.revision || 1} · ${formatDate(published, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></div><span class="status-chip published">פורסם</span></div>`
      : '<div class="publication-banner"><div><strong>השבוע עדיין לא פורסם</strong><small>הוסף שיבוצים ולחץ על פרסום השיבוץ.</small></div></div>';
  $('#schedulePublicationState').innerHTML = text;
}
function shiftCardHtml(shift, compact = false) {
  const employee = employeeById(shift.employee_id); const managerActions = isManager() ? `<div class="shift-actions"><button class="replace-shift" data-action="suggest" data-id="${shift.id}">מציאת מחליף/ה</button><button class="mini-btn" data-action="edit" data-id="${shift.id}">עריכה</button><button class="delete-shift" data-action="delete" data-id="${shift.id}" aria-label="מחיקת שיבוץ">×</button></div>` : '';
  return `<article class="shift-item ${shift.status === 'draft' ? 'is-draft' : ''} ${compact ? 'shift-card' : ''}" data-shift-id="${shift.id}"><div class="shift-main"><strong>${escapeHtml(employee?.full_name || 'עובד')}</strong><span class="shift-time">${timeHtml(shift.start_time, shift.end_time)}</span><small>${SHIFT_ROLE_LABELS[shift.shift_role]}${shift.public_note ? ` · ${escapeHtml(shift.public_note)}` : ''}</small>${isManager() && shift.status === 'draft' ? '<span class="status-chip draft">טרם פורסם</span>' : ''}</div>${managerActions}</article>`;
}
function renderMobileWeekClass(classItem, date) {
  const iso = dateISO(date);
  const rows = state.shifts.filter((shift) => shift.shift_date === iso && shift.class_id === classItem.id);
  const coverage = coverageFor(rows, iso);
  return `<section class="mobile-week-class"><div class="mobile-week-class-head"><div><h4>${escapeHtml(classItem.name)}</h4><small>${coverage.count} משובצים · ${coverage.closing} בסגירה</small></div><span class="status-chip ${coverage.ok ? 'ok' : 'error'}">${coverage.ok ? 'תקין' : 'דורש טיפול'}</span></div><div class="mobile-week-class-shifts">${rows.length ? rows.map((shift) => shiftCardHtml(shift, true)).join('') : '<div class="empty-state compact">אין שיבוצים בכיתה</div>'}</div>${isManager() ? `<button class="mobile-add-shift" data-action="add" data-date="${iso}" data-class="${classItem.id}">＋ הוספת עובד לכיתה</button>` : ''}</section>`;
}
function renderMobileWeekDay(date, index) {
  const iso = dateISO(date);
  const dayRows = state.shifts.filter((shift) => shift.shift_date === iso);
  const classResults = visibleScheduleClasses().map((item) => coverageFor(dayRows.filter((shift) => shift.class_id === item.id), iso));
  const issues = classResults.filter((result) => !result.ok).length;
  const open = state.expandedWeekDay === index;
  return `<details class="mobile-week-day ${issues ? 'has-issue' : ''}" data-day-index="${index}" ${open ? 'open' : ''}><summary><span class="mobile-week-day-name"><strong>${DAY_NAMES[date.getDay()]}</strong><small>${formatDate(date, { day: '2-digit', month: '2-digit' })}</small></span><span class="mobile-week-day-stats"><b>${new Set(dayRows.map((shift) => shift.employee_id)).size}</b><small>עובדים</small></span><span class="mobile-week-day-status ${issues ? 'issue' : 'ok'}">${issues ? `${issues} כיתות לבדיקה` : 'כל הכיתות תקינות'}</span><span class="mobile-week-chevron">⌄</span></summary><div class="mobile-week-day-body">${visibleScheduleClasses().map((item) => renderMobileWeekClass(item, date)).join('')}</div></details>`;
}
function renderScheduleWeek() {
  const dates = currentWeekDates();
  const header = dates.map((date) => `<th><strong>${DAY_NAMES[date.getDay()]}</strong><small>${formatDate(date, { day: '2-digit', month: '2-digit' })}</small></th>`).join('');
  const rows = visibleScheduleClasses().map((classItem) => `<tr><td class="class-name">${escapeHtml(classItem.name)}</td>${dates.map((date) => { const iso = dateISO(date); const shifts = state.shifts.filter((shift) => shift.shift_date === iso && shift.class_id === classItem.id); return `<td><div class="schedule-cell">${shifts.map((shift) => shiftCardHtml(shift)).join('')}<div class="cell-footer manager-only ${isManager() ? '' : 'hidden'}"><button class="mini-btn cell-action" data-action="add" data-date="${iso}" data-class="${classItem.id}">＋ הוספה</button><button class="mini-btn cell-action" data-action="suggest-empty" data-date="${iso}" data-class="${classItem.id}">הצעת מחליף/ה</button></div></div></td>`; }).join('')}</tr>`).join('');
  const desktop = `<div class="schedule-desktop-week"><div class="schedule-table-scroll"><table class="schedule-table"><thead><tr><th class="class-name">כיתה</th>${header}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
  const mobile = `<div class="schedule-mobile-week"><div class="mobile-week-intro"><span>שבוע מלא בלי גלילה לצדדים</span><small>לחץ על יום כדי לפתוח את כל הכיתות והשיבוצים.</small></div>${dates.map(renderMobileWeekDay).join('')}</div>`;
  return desktop + mobile;
}
function renderScheduleDay() {
  const date = currentWeekDates()[Math.min(Math.max(state.scheduleDay, 0), 5)] || currentWeekDates()[0]; const iso = dateISO(date);
  return `<div class="day-view-heading"><strong>${DAY_NAMES[date.getDay()]}</strong><span>${formatDate(date, { day: 'numeric', month: 'long' })}</span></div><div class="day-schedule-grid">${visibleScheduleClasses().map((classItem) => { const rows = state.shifts.filter((shift) => shift.shift_date === iso && shift.class_id === classItem.id); const coverage = coverageFor(rows, iso); return `<article class="day-class-card" data-day-class="${classItem.id}"><div class="card-heading"><div><h3>${escapeHtml(classItem.name)}</h3><p>${coverage.count} משובצים · ${coverage.closing} בסגירה</p></div><span class="status-chip ${coverage.ok ? 'ok' : 'error'}">${coverage.ok ? 'תקין' : 'חוסר'}</span></div><div class="day-shifts">${rows.length ? rows.map((shift) => shiftCardHtml(shift, true)).join('') : '<div class="empty-state compact">אין שיבוצים</div>'}</div>${isManager() ? `<button class="secondary-btn full-button" data-action="add" data-date="${iso}" data-class="${classItem.id}">＋ הוספת עובד</button>` : ''}</article>`; }).join('')}</div>`;
}
function renderScheduleMine() {
  return `<div class="my-schedule-list">${currentWeekDates().map((date) => { const iso = dateISO(date); const rows = state.shifts.filter((shift) => shift.shift_date === iso && shift.employee_id === state.profile.id); return `<article class="my-day-card"><div class="my-day-date"><strong>${DAY_NAMES[date.getDay()]}</strong><span>${formatDate(date, { day: '2-digit', month: '2-digit' })}</span></div><div class="my-day-shifts">${rows.length ? rows.map((shift) => `<div class="shift-item"><strong>${escapeHtml(classById(shift.class_id)?.name || '')}</strong><span class="shift-time">${timeHtml(shift.start_time, shift.end_time)}</span><small>${SHIFT_ROLE_LABELS[shift.shift_role]}${shift.public_note ? ` · ${escapeHtml(shift.public_note)}` : ''}</small></div>`).join('') : '<span class="day-off-label">יום חופשי / ללא שיבוץ</span>'}</div></article>`; }).join('')}</div>`;
}
function absenceLabel(type) { return type === 'leave' ? 'חופשה' : type === 'day_off' ? 'יום חופשי' : type === 'sick' ? 'מחלה' : 'היעדרות'; }
function absenceIcon(type) { return type === 'leave' ? '☀' : type === 'day_off' ? '⌂' : type === 'sick' ? '✚' : '•'; }
function renderAbsenceDay(date) {
  const iso = typeof date === 'string' ? date : dateISO(date);
  const rows = state.scheduleAbsences.filter((item) => item.absence_date === iso);
  return `<article class="absence-day-card ${rows.length ? 'has-absences' : ''}"><div class="absence-day-heading"><div><strong>${DAY_NAMES[parseDateValue(iso).getDay()]}</strong><span>${formatDate(iso, { day: '2-digit', month: '2-digit' })}</span></div><span class="absence-count">${rows.length}</span></div><div class="absence-people">${rows.length ? rows.map((item) => `<div class="absence-person type-${item.absence_type}"><span class="absence-icon">${absenceIcon(item.absence_type)}</span><span><strong>${escapeHtml(employeeById(item.employee_id)?.full_name || item.employee_name || 'עובד')}</strong><small>${absenceLabel(item.absence_type)}</small></span></div>`).join('') : '<span class="absence-empty">אין חופשות או היעדרויות</span>'}</div></article>`;
}
function renderScheduleAbsences() {
  const target = $('#scheduleAbsences');
  const dates = state.scheduleMode === 'day' ? [currentWeekDates()[Math.min(Math.max(state.scheduleDay, 0), 5)]] : currentWeekDates();
  const total = dates.reduce((sum, date) => sum + state.scheduleAbsences.filter((item) => item.absence_date === dateISO(date)).length, 0);
  target.innerHTML = `<div class="absence-section-heading"><div><span class="section-icon">☀</span><div><p class="eyebrow">זמינות צוות</p><h3>${state.scheduleMode === 'day' ? 'בחופש או בהיעדרות באותו יום' : 'חופשות והיעדרויות השבוע'}</h3></div></div><span class="absence-total">${total} בסך הכול</span></div><div class="absence-grid ${state.scheduleMode === 'day' ? 'single-day' : ''}">${dates.map(renderAbsenceDay).join('')}</div>`;
}

function renderSchedule() {
  $('#weekLabel').textContent = `${formatDate(state.weekStart, { day: 'numeric', month: 'long' })} – ${formatDate(addDays(state.weekStart, 5), { day: 'numeric', month: 'long', year: 'numeric' })}`;
  $('#scheduleDaySelect').innerHTML = currentWeekDates().map((date, index) => `<option value="${index}" ${index === state.scheduleDay ? 'selected' : ''}>${DAY_NAMES[date.getDay()]} · ${formatDate(date, { day: '2-digit', month: '2-digit' })}</option>`).join('');
  $$('#scheduleMode [data-mode]').forEach((button) => button.classList.toggle('active', button.dataset.mode === state.scheduleMode));
  $('#scheduleDayField').classList.toggle('hidden', state.scheduleMode !== 'day');
  const exportElement = $('#scheduleExport'); exportElement.className = `schedule-wrap mode-${state.scheduleMode}`;
  exportElement.innerHTML = state.scheduleMode === 'day' ? renderScheduleDay() : state.scheduleMode === 'mine' ? renderScheduleMine() : renderScheduleWeek();
  renderWarnings(); renderPublicationState(); renderScheduleAbsences();
  const acknowledged = state.acknowledgements.some((row) => row.employee_id === state.profile.id);
  $('#ackScheduleBtn').textContent = acknowledged ? 'השיבוץ נקרא ✓' : 'קראתי את השיבוץ'; $('#ackScheduleBtn').disabled = acknowledged;
}
function employeePatternForDate(employeeId, dateValue) {
  const employee = employeeById(employeeId);
  if (!employee || !dateValue) return null;
  const weekday = parseDateValue(dateValue).getDay();
  return (employee.weekly_patterns || []).find((row) => Number(row.weekday) === weekday) || null;
}
function shiftRecommendationKey(form = $("#shiftForm")) {
  const data = formObject(form);
  return [data.shift_date, data.class_id, data.start_time, data.end_time, data.shift_role, data.id || "new"].join("|");
}
function setShiftEmployeeOptions(candidates = [], selectedId = "") {
  const select = $("#shiftForm [name=\"employee_id\"]");
  const active = state.employees.filter((item) => item.active && item.is_schedulable !== false);
  const candidateIds = new Set(candidates.map((item) => item.employee_id));
  const recommended = candidates.map((candidate) => `<option value="${candidate.employee_id}" ${candidate.employee_id === selectedId ? "selected" : ""}>★ ${escapeHtml(candidate.full_name)} — התאמה ${candidate.score}</option>`).join("");
  const other = active.filter((item) => !candidateIds.has(item.id)).sort((a,b) => a.full_name.localeCompare(b.full_name,"he")).map((item) => `<option value="${item.id}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(item.full_name)} — ${escapeHtml(item.job_title)}</option>`).join("");
  select.innerHTML = `${recommended ? `<optgroup label="מומלצים לפי התאמה">${recommended}</optgroup>` : ""}<optgroup label="כל שאר העובדים">${other}</optgroup>`;
  if (selectedId && active.some((item) => item.id === selectedId)) select.value = selectedId;
  if (!select.value && candidates[0]) select.value = candidates[0].employee_id;
  updateShiftEmployeeHint();
}
function updateShiftEmployeeHint() {
  const form = $("#shiftForm"); const employeeId = form.elements.employee_id.value;
  const key = shiftRecommendationKey(form); const cached = state.shiftSuggestionCache.get(key);
  const candidate = cached?.candidates?.find((item) => item.employee_id === employeeId);
  const employee = employeeById(employeeId); const hint = $("#shiftEmployeeHint"); if (!hint) return;
  hint.textContent = candidate ? `התאמה ${candidate.score}: ${candidate.reasons.slice(0,2).join(" · ")}` : employee ? `${employee.job_title} · ניתן לבחור גם עובד שאינו ברשימת המומלצים.` : "בחרו עובד לשיבוץ.";
}
function renderShiftRecommendations(candidates = []) {
  const target = $("#shiftRecommendations"); const status = $("#shiftRecommendationStatus");
  if (!candidates.length) { target.innerHTML = '<div class="empty-state compact">לא נמצאו עובדים זמינים שמתאימים לטווח שנבחר. אפשר לבחור עובד אחר ולבדוק את החריגה.</div>'; status.textContent = "אין התאמה מלאה"; status.className = "status-chip warn"; return; }
  const top = candidates.slice(0,5);
  target.innerHTML = top.map((candidate,index) => `<button type="button" class="shift-recommendation-card level-${candidate.recommendation_level || "possible"}" data-recommended-employee="${candidate.employee_id}" data-recommended-role="${candidate.suggested_role}"><span class="recommendation-rank">${index+1}</span><div><strong>${escapeHtml(candidate.full_name)}</strong><small>${escapeHtml(candidate.job_title)} · ${candidate.reasons.slice(0,2).map(escapeHtml).join(" · ")}</small></div><span class="recommendation-score">${candidate.score}</span></button>`).join("");
  status.textContent = `${candidates.length} התאמות`; status.className = "status-chip ok";
}
async function updateShiftRecommendations({ force = false } = {}) {
  const form = $("#shiftForm"); const data = formObject(form); const selected = form.elements.employee_id.value;
  if (!data.shift_date || !data.class_id || !data.start_time || !data.end_time || timeToMinutes(data.end_time) <= timeToMinutes(data.start_time)) { $("#shiftRecommendations").innerHTML = '<div class="empty-state compact">השלימו תאריך, כיתה וטווח שעות תקין.</div>'; return; }
  const key = shiftRecommendationKey(form); const requestId = ++state.shiftSuggestionRequestId; const cached = state.shiftSuggestionCache.get(key);
  if (!force && cached && Date.now() - cached.fetchedAt < 90000) { renderShiftRecommendations(cached.candidates); setShiftEmployeeOptions(cached.candidates, selected); return; }
  $("#shiftRecommendationStatus").textContent = "מחשב…"; $("#shiftRecommendationStatus").className = "status-chip";
  $("#shiftRecommendations").innerHTML = '<div class="recommendation-loading"><span></span><span>בודק העדפות, שעות וזמינות…</span></div>';
  try {
    const params = new URLSearchParams({ date:data.shift_date, class_id:data.class_id, start_time:data.start_time, end_time:data.end_time, shift_role:data.shift_role || "staff" });
    if (data.id) params.set("exclude_shift_id", data.id);
    const result = await apiFetch(`/api/suggestions?${params}`, { timeout:8000 });
    if (requestId !== state.shiftSuggestionRequestId) return;
    const candidates = result.candidates || []; state.shiftSuggestionCache.set(key, { candidates, fetchedAt:Date.now() });
    renderShiftRecommendations(candidates); setShiftEmployeeOptions(candidates, selected);
  } catch (error) {
    if (requestId !== state.shiftSuggestionRequestId) return;
    $("#shiftRecommendations").innerHTML = `<div class="empty-state compact">${escapeHtml(error.message)}</div>`;
    $("#shiftRecommendationStatus").textContent = "לא נטען"; $("#shiftRecommendationStatus").className = "status-chip error";
  }
}
function queueShiftRecommendations() { clearTimeout(queueShiftRecommendations.timer); queueShiftRecommendations.timer = setTimeout(() => updateShiftRecommendations(), 220); }
function handleShiftRecommendationClick(event) {
  const button = event.target.closest("[data-recommended-employee]"); if (!button) return;
  const form = $("#shiftForm"); form.elements.employee_id.value = button.dataset.recommendedEmployee;
  if (button.dataset.recommendedRole) form.elements.shift_role.value = button.dataset.recommendedRole;
  $$(".shift-recommendation-card").forEach((item) => item.classList.toggle("selected", item === button)); updateShiftEmployeeHint();
}

function syncShiftHoursFromPattern() {
  const form = $('#shiftForm');
  const employee = employeeById(form.elements.employee_id.value);
  const date = form.elements.shift_date.value;
  if (!employee || !date) return;
  const pattern = employeePatternForDate(employee.id, date);
  const dayClose = closingTimeForDate(date);
  if (pattern?.day_type === 'work') {
    form.elements.start_time.value = trimTime(pattern.start_time) || trimTime(employee.default_start) || '07:30';
    form.elements.end_time.value = trimTime(pattern.end_time) || trimTime(employee.default_end) || dayClose;
  } else {
    form.elements.start_time.value = trimTime(employee.default_start) || '07:30';
    form.elements.end_time.value = trimTime(employee.default_end) || dayClose;
  }
  if (timeToMinutes(form.elements.end_time.value) > timeToMinutes(dayClose)) form.elements.end_time.value = dayClose;
  form.elements.end_time.max = dayClose;
}
function openShiftDialog(shift = {}) {
  const form = $("#shiftForm"); form.reset();
  form.elements.id.value = shift.id || "";
  form.elements.shift_date.value = shift.shift_date || dateISO(state.weekStart);
  form.elements.class_id.value = shift.class_id || state.classes.find((item) => item.active)?.id || "";
  const initialEmployee = shift.employee_id || state.employees.find((item) => item.active && item.is_schedulable !== false)?.id || "";
  setShiftEmployeeOptions([], initialEmployee); form.elements.employee_id.value = initialEmployee;
  if (shift.id) {
    form.elements.start_time.value = trimTime(shift.start_time) || "07:30";
    form.elements.end_time.value = trimTime(shift.end_time) || closingTimeForDate(form.elements.shift_date.value);
    form.elements.end_time.max = closingTimeForDate(form.elements.shift_date.value);
  } else syncShiftHoursFromPattern();
  form.elements.shift_role.value = shift.shift_role || "staff";
  form.elements.public_note.value = shift.public_note || "";
  form.elements.override_day_off.value = "false";
  $("#shiftRecommendations").innerHTML = '<div class="recommendation-loading"><span></span><span>מחשב התאמות…</span></div>';
  $("#shiftRecommendationStatus").textContent = "מחשב התאמות"; $("#shiftRecommendationStatus").className = "status-chip";
  $("#shiftDialog").showModal(); queueShiftRecommendations();
}

function isPublishedWeekDate(dateValue) {
  if (!state.publication?.published_at || !dateValue) return false;
  const date = dateISO(parseDateValue(dateValue)); const start = dateISO(state.weekStart); const end = dateISO(addDays(state.weekStart,5));
  return date >= start && date <= end;
}
function showPostPublishChangePrompt(details) {
  state.postPublishContext = details || {};
  $("#postPublishChangeDetails").innerHTML = `<div class="publish-change-icon">↻</div><div><strong>${escapeHtml(details.title || "השיבוץ השתנה")}</strong><p>${escapeHtml(details.message || "השינוי נשמר בטיוטה ומחכה לפרסום.")}</p><small>המערכת תבצע בדיקת תקינה נוספת לפני הפרסום.</small></div>`;
  $("#postPublishChangeDialog").showModal();
}
async function publishPendingChangeNow() {
  $("#postPublishChangeDialog").close();
  await openPublishDialog();
}

async function saveShift(event) {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[value="default"]'); const data = formObject(form); data.override_day_off = data.override_day_off === 'true'; const wasPublished=isPublishedWeekDate(data.shift_date); const employeeName=employeeById(data.employee_id)?.full_name || 'העובד'; setBusy(button, true);
  try {
    try { await apiFetch('/api/shifts', { method: data.id ? 'PATCH' : 'POST', body: data }); }
    catch (error) { if (error.status === 409 && /יום החופשי/.test(error.message) && confirm(`${error.message}\nלשמור בכל זאת?`)) { data.override_day_off = true; await apiFetch('/api/shifts', { method: data.id ? 'PATCH' : 'POST', body: data }); } else throw error; }
    $('#shiftDialog').close(); state.shiftSuggestionCache.clear(); await refreshScheduleWeek({ force: true }); showToast('השיבוץ נשמר בטיוטה', 'success');
    if(wasPublished)showPostPublishChangePrompt({title:data.id?'שיבוץ פורסם עודכן':'נוסף שיבוץ לשבוע שכבר פורסם',message:`השינוי עבור ${employeeName} עדיין אינו גלוי לצוות. לפרסם אותו עכשיו?`});
  } catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); }
}

async function openPublishDialog() {
  const button = $('#publishScheduleBtn'); setBusy(button, true, 'בודק…');
  try {
    const preview = await apiFetch('/api/shifts', { method: 'POST', body: { action: 'publish_preview', week_start: dateISO(state.weekStart) } });
    $('#publishSummary').innerHTML = `<div class="request-summary"><div class="mini-stat"><strong>${preview.shiftCount}</strong><span>שיבוצים בשבוע</span></div><div class="mini-stat"><strong>${preview.draftCount}</strong><span>שינויים לפרסום</span></div><div class="mini-stat"><strong>${preview.errors.length}</strong><span>שגיאות תקינה</span></div><div class="mini-stat"><strong>${preview.warnings.length}</strong><span>התראות</span></div></div>${preview.errors.length ? `<div class="notice error">יש לטפל בשגיאות לפני הפרסום.</div>` : '<div class="notice success">השיבוץ מוכן לפרסום.</div>'}`;
    const issueList = [...(preview.errors || []), ...(preview.warnings || [])];
    $('#publishSummary').innerHTML += issueList.length ? `<div class="publish-issue-list">${issueList.map((issue, index) => `<button type="button" class="actionable-warning ${index < preview.errors.length ? 'error' : 'warn'}" data-publish-date="${escapeHtml(issue.date || '')}" data-publish-class="${escapeHtml(issue.class_id || '')}"><span><strong>${index < preview.errors.length ? 'שגיאה' : 'התראה'}</strong><small>${escapeHtml(issue.message || '')}</small></span><b>הצגה ›</b></button>`).join('')}</div>` : '';
    $('#publishChanges').innerHTML = preview.changes.length ? preview.changes.map(changeRowHtml).join('') : '<div class="empty-state compact">אין שינויים חדשים, אך אפשר לפרסם מחדש את השבוע.</div>';
    $('#confirmPublishBtn').disabled = preview.errors.length > 0;
    $('#publishDialog').showModal();
  } catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); }
}
function handlePublishIssueClick(event) {
  const button = event.target.closest('[data-publish-date]'); if (!button || !button.dataset.publishDate) return;
  $('#publishDialog').close();
  const index = currentWeekDates().findIndex((date) => dateISO(date) === button.dataset.publishDate);
  state.scheduleDay = Math.max(0, index); state.scheduleMode = 'day';
  storageSet('localStorage', 'hadas-schedule-mode', 'day'); storageSet('localStorage', 'hadas-schedule-day', state.scheduleDay);
  renderSchedule();
  requestAnimationFrame(() => { const card = document.querySelector(`[data-day-class="${button.dataset.publishClass}"]`); if (card) { card.classList.add('attention-pulse'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => card.classList.remove('attention-pulse'), 1800); } });
}
function changeRowHtml(change) {
  const data = change.after_data || change.before_data || {}; const employee = employeeById(data.employee_id); const classItem = classById(data.class_id);
  const icon = change.change_type === 'delete' ? '−' : change.change_type === 'update' ? '↻' : '+';
  return `<div class="change-row"><span class="change-icon">${icon}</span><div><strong>${CHANGE_LABELS[change.change_type] || 'שינוי'}</strong><small>${escapeHtml(employee?.full_name || 'עובד')} · ${escapeHtml(classItem?.name || 'כיתה')} · ${formatDate(data.shift_date)} · ${timeHtml(data.start_time, data.end_time)}</small></div></div>`;
}
async function publishWeek() {
  const button = $('#confirmPublishBtn'); setBusy(button, true, 'מפרסם…');
  try { await apiFetch('/api/shifts', { method: 'POST', body: { action: 'publish', week_start: dateISO(state.weekStart) } }); $('#publishDialog').close(); await refreshScheduleWeek({ force: true }); showToast('השיבוץ פורסם לכל הצוות', 'success'); }
  catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); }
}
async function openCopyWeekDialog() {
  const button = $('#copyWeekBtn'); setBusy(button, true, 'בודק…');
  try {
    const preview = await apiFetch('/api/shifts', { method: 'POST', body: { action: 'copy_preview', week_start: dateISO(state.weekStart) } });
    $('#copyWeekPreview').innerHTML = `<div class="notice"><strong>שבוע מקור:</strong> ${formatDate(preview.previousStart)} · ${preview.previousCount} שיבוצים<br/><strong>השבוע הנוכחי:</strong> ${preview.existingCount} שיבוצים קיימים</div>`;
    $('#copyWeekDialog').showModal();
  } catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); }
}
async function copyPreviousWeek(mode) {
  const button = mode === 'merge' ? $('#copyMergeBtn') : $('#copyReplaceBtn'); setBusy(button, true, 'מעתיק…');
  try { const result = await apiFetch('/api/shifts', { method: 'POST', body: { action: 'copy_previous', week_start: dateISO(state.weekStart), mode } }); $('#copyWeekDialog').close(); await refreshScheduleWeek({ force: true }); showToast(`הועתקו ${result.count} שיבוצים${result.skipped ? `, ${result.skipped} דולגו` : ''}`, 'success'); }
  catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); }
}
async function acknowledgeSchedule() { try { await apiFetch('/api/shifts', { method: 'POST', body: { action: 'ack', week_start: dateISO(state.weekStart) } }); await refreshScheduleWeek({ force: true }); showToast('אישור הקריאה נשמר', 'success'); } catch (error) { showToast(error.message, 'error'); } }
function exportShiftHtml(shift) {
  const employee = employeeById(shift.employee_id);
  return `<div class="export-shift"><strong>${escapeHtml(employee?.full_name || 'עובד')}</strong><span>${timeHtml(shift.start_time, shift.end_time)}</span><small>${escapeHtml(SHIFT_ROLE_LABELS[shift.shift_role] || '')}${shift.public_note ? ` · ${escapeHtml(shift.public_note)}` : ''}</small></div>`;
}
function buildWeeklyExportHtml(payload = schedulePayloadFromState(), weekStart = state.weekStart, title = 'שיבוץ שבועי') {
  const dates = Array.from({ length: 6 }, (_, index) => addDays(weekStart, index));
  const shifts = payload.shifts || [];
  const headers = dates.map((date) => `<th><strong>${DAY_NAMES[date.getDay()]}</strong><small>${formatDate(date, { day: '2-digit', month: '2-digit' })}</small></th>`).join('');
  const rows = visibleScheduleClasses().map((classItem) => `<tr><th class="export-class">${escapeHtml(classItem.name)}</th>${dates.map((date) => { const iso = dateISO(date); const items = shifts.filter((shift) => shift.shift_date === iso && shift.class_id === classItem.id); return `<td>${items.length ? items.map(exportShiftHtml).join('') : '<span class="export-empty">—</span>'}</td>`; }).join('')}</tr>`).join('');
  const absences = payload.scheduleAbsences || [];
  const absenceRow = dates.map((date) => { const iso = dateISO(date); const items = absences.filter((item) => item.absence_date === iso); return `<td>${items.length ? items.map((item) => `<span class="export-absence">${escapeHtml(employeeById(item.employee_id)?.full_name || item.employee_name || 'עובד')} · ${absenceLabel(item.absence_type)}</span>`).join('') : '<span class="export-empty">אין</span>'}</td>`; }).join('');
  return `<section class="export-sheet"><header><div><p>מערכת ניהול שיבוצים מעון הדס</p><h1>${escapeHtml(title)}</h1></div><strong>${formatDate(weekStart, { day: 'numeric', month: 'long' })} – ${formatDate(addDays(weekStart, 5), { day: 'numeric', month: 'long', year: 'numeric' })}</strong></header><table class="export-table"><thead><tr><th class="export-class">כיתה</th>${headers}</tr></thead><tbody>${rows}<tr class="export-absence-row"><th class="export-class">חופש / היעדרות</th>${absenceRow}</tr></tbody></table><footer>נוצר בתאריך ${formatDate(new Date(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</footer></section>`;
}
function createExportHost(html, monthly = false) {
  const host = document.createElement('div');
  host.className = `capture-export-host ${monthly ? 'monthly' : ''}`;
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}
async function canvasToUserFile(canvas, filename, title) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.96));
  if (!blob) throw new Error('לא ניתן ליצור קובץ תמונה');
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      // Some mobile browsers expire the user gesture while the image is rendered.
      // Fall back to a normal download instead of losing the generated file.
    }
  }
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.download = filename; link.href = url; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000); return 'downloaded';
}
async function captureExport(html, filename, title, monthly = false) {
  if (!window.html2canvas) throw new Error('רכיב שמירת התמונה עדיין נטען. נסו שוב.');
  const host = createExportHost(html, monthly);
  try {
    await document.fonts?.ready;
    const maxCanvasSide = monthly ? 3800 : 7000;
    const requestedScale = monthly ? 1.05 : 1.6;
    const safeScale = Math.max(0.72, Math.min(requestedScale, maxCanvasSide / Math.max(host.scrollWidth, host.scrollHeight)));
    const canvas = await window.html2canvas(host, { scale: safeScale, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: host.scrollWidth, windowHeight: host.scrollHeight });
    return await canvasToUserFile(canvas, filename, title);
  } finally { host.remove(); }
}
async function downloadScheduleImage() {
  const button = $('#imageBtn'); setBusy(button, true, 'מכין שבוע…');
  try {
    const mode = await captureExport(buildWeeklyExportHtml(), `שיבוץ-שבועי-מעון-הדס-${dateISO(state.weekStart)}.png`, 'שיבוץ שבועי מעון הדס');
    showToast(mode === 'shared' ? 'נפתח תפריט השיתוף — ניתן לבחור שמירה לתמונות' : 'התמונה נשמרה', 'success');
  } catch (error) { if (error.name !== 'AbortError') showToast(error.message || 'שמירת התמונה נכשלה', 'error'); }
  finally { setBusy(button, false); }
}
async function monthSchedulePayloads(monthDate) {
  const first = monthStart(monthDate); const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12);
  let cursor = startOfWeek(first); const weeks = [];
  while (cursor <= last) { weeks.push(new Date(cursor)); cursor = addDays(cursor, 7); }
  return Promise.all(weeks.map(async (week) => ({ week, payload: await fetchScheduleWeek(week, { apply: false }) })));
}
async function downloadMonthlyScheduleImage() {
  const button = $('#monthImageBtn'); setBusy(button, true, 'מכין חודש…');
  try {
    const monthDate = monthStart(state.weekStart); const weeks = await monthSchedulePayloads(monthDate);
    const html = `<div class="monthly-export-title"><p>מערכת ניהול שיבוצים מעון הדס</p><h1>שיבוץ חודשי · ${formatDate(monthDate, { month: 'long', year: 'numeric' })}</h1></div>${weeks.map(({ week, payload }, index) => buildWeeklyExportHtml(payload, week, `שבוע ${index + 1}`)).join('')}`;
    const mode = await captureExport(html, `שיבוץ-חודשי-מעון-הדס-${monthParam(monthDate)}.png`, 'שיבוץ חודשי מעון הדס', true);
    showToast(mode === 'shared' ? 'נפתח תפריט השיתוף — ניתן לבחור שמירה לתמונות' : 'השיבוץ החודשי נשמר', 'success');
  } catch (error) { if (error.name !== 'AbortError') showToast(error.message || 'שמירת החודש נכשלה', 'error'); }
  finally { setBusy(button, false); }
}
function printWeeklySchedule() {
  const root = $('#printExportRoot'); root.innerHTML = buildWeeklyExportHtml();
  document.body.classList.add('printing-schedule'); root.setAttribute('aria-hidden', 'false');
  const cleanup = () => { document.body.classList.remove('printing-schedule'); root.setAttribute('aria-hidden', 'true'); root.innerHTML = ''; window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup); setTimeout(() => window.print(), 80); setTimeout(cleanup, 60000);
}
async function handleScheduleClick(event) {
  const summary = event.target.closest('.mobile-week-day > summary');
  if (summary) {
    event.preventDefault();
    const details = summary.parentElement;
    const nextOpen = !details.open;
    $$('.mobile-week-day').forEach((item) => { item.open = false; });
    details.open = nextOpen;
    state.expandedWeekDay = nextOpen ? Number(details.dataset.dayIndex) : null;
    return;
  }
  const button = event.target.closest('[data-action]'); if (!button) return;
  const shift = state.shifts.find((item) => item.id === button.dataset.id);
  if (button.dataset.action === 'add') return openShiftDialog({ shift_date: button.dataset.date, class_id: button.dataset.class });
  if (button.dataset.action === 'edit' && shift) return openShiftDialog(shift);
  if (['suggest', 'suggest-empty'].includes(button.dataset.action)) return showSuggestions(button.dataset.date || shift?.shift_date, button.dataset.class || shift?.class_id, shift);
  if (button.dataset.action === 'delete' && shift && confirm('למחוק את השיבוץ? השינוי ימתין לפרסום.')) {
    const wasPublished=isPublishedWeekDate(shift.shift_date); const employeeName=employeeById(shift.employee_id)?.full_name||'העובד';
    try { await apiFetch('/api/shifts', { method: 'DELETE', body: { id: shift.id } }); state.shiftSuggestionCache.clear(); await refreshScheduleWeek({ force: true }); showToast('השיבוץ הוסר מהטיוטה', 'success'); if(wasPublished)showPostPublishChangePrompt({title:'שיבוץ פורסם הוסר',message:`מחיקת השיבוץ של ${employeeName} עדיין אינה גלויה לצוות. לפרסם את השינוי עכשיו?`}); } catch (error) { showToast(error.message, 'error'); }
  }
}

function employeeType(employee) {
  const title = String(employee.job_title || '');
  if (employee.assignment_mode === 'rotation' || employee.assignment_mode === 'substitute') return 'flexible';
  if (title === 'גננת') return 'teacher';
  if (title === 'סייעת מובילה') return 'lead';
  if (title === 'סייעת/ סייע' || ['סייעת','סייע'].includes(title)) return 'assistant';
  return 'other';
}
function handleEmployeeSummaryClick(event) {
  const button=event.target.closest('[data-employee-summary-filter]'); if(!button)return;
  const value=button.dataset.employeeSummaryFilter; state.employeeTypeFilter=value;
  const select=$('#employeeTypeFilter'); if(select)select.value=value;
  syncFilterChips('#employeeTypeChips',value); renderEmployees();
}
function employeeAssignmentLabel(employee) {
  if (employee.is_schedulable === false || employee.assignment_mode === 'no_schedule') return 'ללא שיבוץ';
  if (employee.assignment_mode === 'substitute') return 'משלימ/ת מקום';
  if (employee.assignment_mode === 'rotation') return 'רוטציה בין כיתות';
  return `כיתה קבועה · ${classById(employee.primary_class_id)?.name || 'טרם נבחרה'}`;
}
function employeeDaysOffLabel(employee) {
  const days = (employee.weekly_patterns || []).filter((row) => row.day_type === 'day_off').map((row) => DAY_NAMES[Number(row.weekday)]).filter(Boolean);
  return days.length ? days.join(', ') : 'ללא ימים קבועים';
}
function employeeWorkPatternLabel(employee) {
  const patterns = employee.weekly_patterns || [];
  if (!patterns.length) return 'לא הוגדרו ימים קבועים';
  const visible = patterns.filter((row) => row.day_type);
  return visible.map((row) => row.day_type === 'day_off' ? `${DAY_NAMES[Number(row.weekday)]} חופשי` : row.day_type === 'as_needed' ? `${DAY_NAMES[Number(row.weekday)]} לפי צורך` : `${DAY_NAMES[Number(row.weekday)]} ${trimTime(row.start_time)}–${trimTime(row.end_time)}`).join(' · ');
}
function renderEmployees() {
  syncFilterChips('#employeeStatusChips', state.employeeStatusFilter); syncFilterChips('#employeeTypeChips', state.employeeTypeFilter);
  const term = state.employeeSearch.trim().toLowerCase();
  const filtered = state.employees.filter((employee) => {
    const statusOk = state.employeeStatusFilter === 'all' || (state.employeeStatusFilter === 'active' ? employee.active : !employee.active);
    const classOk = state.employeeClassFilter === 'all' || (state.employeeClassFilter === 'none' ? !employee.primary_class_id : employee.primary_class_id === state.employeeClassFilter);
    const typeOk = state.employeeTypeFilter === 'all' || employeeType(employee) === state.employeeTypeFilter;
    const haystack = `${employee.full_name} ${employee.phone || ''} ${employee.job_title || ''} ${employeeAssignmentLabel(employee)}`.toLowerCase();
    return statusOk && classOk && typeOk && (!term || haystack.includes(term));
  });
  const activeRows=state.employees.filter((employee)=>employee.active);
  const counts={ all:activeRows.length, assistant:activeRows.filter((e)=>employeeType(e)==='assistant').length, lead:activeRows.filter((e)=>employeeType(e)==='lead').length, teacher:activeRows.filter((e)=>employeeType(e)==='teacher').length, flexible:activeRows.filter((e)=>employeeType(e)==='flexible').length };
  const summaryItems=[['all','כל העובדים','♙'],['assistant','סייעות','☀'],['lead','סייעות מובילות','★'],['teacher','גננות','✿'],['flexible','רוטציה / השלמה','↻']];
  $('#employeeSummary').innerHTML = summaryItems.map(([key,label,icon])=>`<button type="button" class="mini-stat employee-summary-button ${state.employeeTypeFilter===key?'active':''}" data-employee-summary-filter="${key}"><span>${icon}</span><strong>${counts[key]}</strong><small>${label}</small></button>`).join('');
  $('#employeesList').innerHTML = filtered.length ? filtered.map((employee) => {
    const type = employeeType(employee);
    const titleBadge = type === 'teacher' ? '✿ גננת' : type === 'lead' ? '★ סייעת מובילה' : type === 'assistant' ? '☀ סייעת/ סייע' : type === 'flexible' ? '↻ צוות גמיש' : employee.job_title === 'אחות' ? '✚ אחות' : employee.job_title === 'מזכירה' ? '▤ מזכירה' : '♙ ניהול';
    return `<article data-employee-card="${employee.id}" class="employee-card employee-type-${type} ${employee.active ? '' : 'inactive'}"><div class="employee-card-accent"></div><span class="employee-card-status status-chip ${employee.active ? 'ok' : 'error'}">${employee.active ? 'פעיל' : 'לא פעיל'}</span><div class="employee-card-head"><span class="employee-avatar">${escapeHtml(initials(employee.full_name))}</span><div><h3>${escapeHtml(employee.full_name)}</h3><p>${escapeHtml(employee.job_title)} · ${escapeHtml(employeeAssignmentLabel(employee))}</p></div></div><div class="employee-role-strip"><span>${titleBadge}</span>${employee.can_lead ? '<span>תפקיד הובלה</span>' : ''}${employee.is_schedulable === false ? '<span>ללא שיבוץ</span>' : ''}</div><div class="employee-card-meta"><div><small>טלפון</small><strong>${escapeHtml(employee.phone || '—')}</strong></div><div><small>הרשאה</small><strong>${escapeHtml(ROLE_LABELS[employee.role] || 'עובד')}</strong></div><div><small>שעות מתוכננות / מקסימום</small><strong>${employee.weekly_hours ?? '—'} / ${employee.max_weekly_hours ?? '—'}</strong></div><div><small>ימי חופשה קבועים</small><strong>${escapeHtml(employeeDaysOffLabel(employee))}</strong></div></div><div class="employee-pattern-preview"><small>ימים קבועים</small><span>${escapeHtml(employeeWorkPatternLabel(employee))}</span></div><div class="card-actions"><button class="secondary-btn" data-action="edit" data-id="${employee.id}"><span>✎</span> עריכת כרטיס</button><button class="ghost-btn" data-action="reset" data-id="${employee.id}">איפוס סיסמה</button><button class="${employee.active ? 'danger-btn' : 'primary-btn'}" data-action="toggle" data-id="${employee.id}">${employee.active ? 'השבתה' : 'הפעלה'}</button></div></article>`;
  }).join('') : '<div class="empty-state">לא נמצאו עובדים לפי הסינון.</div>';
}
function renderConstraintFields(employee = {}) {
  const existing = state.constraints.filter((constraint) => constraint.employee_id === employee.id);
  $('#constraintsFields').innerHTML = state.classes.filter((item) => item.active).map((item) => {
    const constraint = existing.find((row) => row.class_id === item.id);
    return `<div class="constraint-row compact-constraint" data-class-id="${item.id}"><label>${escapeHtml(item.name)}<select class="constraint-type"><option value="">ללא מגבלה</option><option value="preferred" ${constraint?.constraint_type === 'preferred' ? 'selected' : ''}>עדיפות</option><option value="avoid" ${constraint?.constraint_type === 'avoid' ? 'selected' : ''}>עדיף להימנע</option><option value="forbidden" ${constraint?.constraint_type === 'forbidden' ? 'selected' : ''}>אסור לשבץ</option></select></label><label class="constraint-reason-field">הסבר<input class="constraint-reason" value="${escapeHtml(constraint?.reason || '')}" placeholder="לא חובה"/></label></div>`;
  }).join('');
}
function collectConstraints() {
  return $$('.constraint-row').map((row) => ({ class_id: row.dataset.classId, constraint_type: $('.constraint-type', row).value, valid_from: null, valid_to: null, reason: $('.constraint-reason', row).value })).filter((row) => row.constraint_type);
}
function syncWeeklyPatternRow(row) {
  const type = $('.weekly-day-type', row).value;
  row.classList.toggle('is-work', type === 'work');
  row.classList.toggle('is-day-off', type === 'day_off');
  row.classList.toggle('is-as-needed', type === 'as_needed');
  $$('.weekly-time', row).forEach((field) => { field.classList.toggle('hidden', !['work','as_needed'].includes(type)); field.querySelector('input').required = type === 'work'; });
  const note=$('.weekly-day-off-note',row); if(note) note.textContent=type==='as_needed'?'זמין/ה רק לפי צורך':type==='day_off'?'יום חופשי קבוע':'';
}
function renderWeeklyPatternFields(employee = {}) {
  const patterns = employee.weekly_patterns || [];
  const substitute = (employee.assignment_mode || $('#employeeForm [name="assignment_mode"]')?.value) === 'substitute';
  $('#weeklyPatternFields').innerHTML = Array.from({ length: 6 }, (_, weekday) => {
    const pattern = patterns.find((row) => Number(row.weekday) === weekday);
    const type = pattern?.day_type || '';
    const start = trimTime(pattern?.start_time) || trimTime(employee.default_start) || '07:30';
    const fallbackEnd=weekday===5?'12:00':trimTime(employee.default_end)||'15:30';
    let end = trimTime(pattern?.end_time) || fallbackEnd;
    if (weekday===5 && timeToMinutes(end)>720) end='12:00';
    return `<article class="weekly-pattern-row" data-weekday="${weekday}"><div class="weekly-pattern-head"><strong>${DAY_NAMES[weekday]}</strong><select class="weekly-day-type" aria-label="הגדרת יום ${DAY_NAMES[weekday]}"><option value="" ${!type ? 'selected' : ''}>לא קבוע</option><option value="work" ${type === 'work' ? 'selected' : ''}>יום עבודה</option><option value="day_off" ${type === 'day_off' ? 'selected' : ''}>יום חופשי</option>${substitute?`<option value="as_needed" ${type==='as_needed'?'selected':''}>לפי צורך</option>`:''}</select></div><label class="weekly-time">התחלה<input class="weekly-start" type="time" value="${start}"/></label><label class="weekly-time">סיום<input class="weekly-end" type="time" value="${end}" ${weekday===5?'max="12:00"':''}/></label><span class="weekly-day-off-note">${type==='as_needed'?'זמין/ה רק אם נדרש':'יום חופשי קבוע'}</span></article>`;
  }).join('');
  $$('.weekly-pattern-row').forEach((row) => { syncWeeklyPatternRow(row); $('.weekly-day-type', row).addEventListener('change', () => syncWeeklyPatternRow(row)); });
}
function collectWeeklyPatterns() {
  return $$('.weekly-pattern-row').map((row) => ({ weekday:Number(row.dataset.weekday), day_type:$('.weekly-day-type', row).value, start_time:$('.weekly-start', row).value, end_time:$('.weekly-end', row).value }));
}
function syncEmployeeAssignmentFields() {
  const form = $('#employeeForm');
  const title = form.elements.job_title.value;
  const managerTitle = title === 'מנהלת מעון';
  const noSchedule = ['מנהלת מעון','אחות','מזכירה'].includes(title);
  const assignment = form.elements.assignment_mode;
  const patternsBefore = $$('.weekly-pattern-row').length ? collectWeeklyPatterns() : [];
  if (noSchedule) assignment.value = 'no_schedule';
  else if (assignment.value === 'no_schedule') assignment.value = 'fixed';
  assignment.disabled = noSchedule;
  $('#assignmentModeField').classList.toggle('hidden', noSchedule);
  const schedulingDisabled = noSchedule || assignment.value === 'no_schedule';
  const fixed = assignment.value === 'fixed' && !schedulingDisabled;
  $('#primaryClassField').classList.toggle('hidden', !fixed);
  form.elements.primary_class_id.required = fixed;
  $('.weekly-patterns-box', form).classList.toggle('hidden', schedulingDisabled);
  $('#constraintsFields')?.closest('.form-section')?.classList.toggle('hidden', schedulingDisabled || managerTitle);
  const help=$('#assignmentModeHelp');
  if(help) help.textContent=assignment.value==='fixed'?'כיתה קבועה ולאחר מכן בחירת הכיתה.':assignment.value==='rotation'?'עובר/ת בין כיתות לפי הרוטציה והעדפות הכיתה.':'משלימ/ת מקום ללא כיתה קבועה; ניתן לסמן ימים לפי צורך.';
  if (!schedulingDisabled) renderWeeklyPatternFields({ assignment_mode: assignment.value, default_start: form.elements.default_start.value, default_end: form.elements.default_end.value, weekly_patterns: patternsBefore });
}
function openEmployeeDialog(employee = {}) {
  const form = $('#employeeForm'); form.reset();
  form.elements.id.value = employee.id || '';
  form.elements.full_name.value = employee.full_name || '';
  form.elements.phone.value = employee.phone || '';
  const titleSelect = form.elements.job_title;
  titleSelect.querySelectorAll('option[data-legacy-title]').forEach((option) => option.remove());
  const titleMap={'סייעת':'סייעת/ סייע','סייע':'סייעת/ סייע'};
  const selectedTitle = titleMap[employee.job_title] || employee.job_title || 'סייעת/ סייע';
  if (selectedTitle && ![...titleSelect.options].some((option) => option.value === selectedTitle)) {
    const legacyOption = document.createElement('option'); legacyOption.value = selectedTitle; legacyOption.textContent = `${selectedTitle} (תפקיד קודם — מומלץ לעדכן)`; legacyOption.dataset.legacyTitle = 'true'; titleSelect.append(legacyOption);
  }
  titleSelect.value = selectedTitle;
  form.elements.role.value = employee.role || 'employee';
  form.elements.assignment_mode.value = employee.assignment_mode || (employee.primary_class_id ? 'fixed' : 'rotation');
  form.elements.primary_class_id.value = employee.primary_class_id || '';
  form.elements.weekly_hours.value = employee.weekly_hours ?? '';
  form.elements.max_weekly_hours.value = employee.max_weekly_hours ?? '';
  form.elements.employment_percent.value = employee.employment_percent ?? '';
  form.elements.default_start.value = trimTime(employee.default_start) || '07:30';
  form.elements.default_end.value = trimTime(employee.default_end) || '15:30';
  form.elements.admin_notes.value = employee.admin_notes || '';
  renderWeeklyPatternFields(employee); renderConstraintFields(employee); syncEmployeeAssignmentFields();
  $('#employeeDialog').showModal();
}
async function saveEmployee(event) {
  event.preventDefault();
  const form = event.currentTarget; const button = form.querySelector('button[value="default"]');
  const data = formObject(form);
  const noSchedule=['מנהלת מעון','אחות','מזכירה'].includes(data.job_title);
  data.assignment_mode = noSchedule ? 'no_schedule' : form.elements.assignment_mode.value;
  data.primary_class_id = data.assignment_mode === 'fixed' ? form.elements.primary_class_id.value : '';
  data.weekly_patterns = data.assignment_mode === 'no_schedule' ? [] : collectWeeklyPatterns();
  data.constraints = data.assignment_mode === 'no_schedule' ? [] : collectConstraints();
  setBusy(button, true);
  try { await apiFetch('/api/employees', { method: data.id ? 'PATCH' : 'POST', body: data }); $('#employeeDialog').close(); await refreshAll(); showToast('כרטיס העובד נשמר', 'success'); }
  catch (error) { showToast(error.message, 'error'); }
  finally { setBusy(button, false); }
}
async function handleEmployeeClick(event) {
  const button = event.target.closest('[data-action]'); if (!button) return; const employee = employeeById(button.dataset.id); if (!employee) return;
  if (button.dataset.action === 'edit') return openEmployeeDialog(employee);
  if (button.dataset.action === 'reset' && !confirm(`לאפס את הסיסמה של ${employee.full_name} ל-hadas?`)) return;
  if (button.dataset.action === 'toggle' && !confirm(`${employee.active ? 'להשבית' : 'להפעיל'} את ${employee.full_name}?`)) return;
  try { await apiFetch('/api/employees', { method: 'PATCH', body: { id: employee.id, ...(button.dataset.action === 'reset' ? { reset_password: true } : { active: !employee.active }) } }); await refreshAll(); showToast('העובד עודכן', 'success'); } catch (error) { showToast(error.message, 'error'); }
}

function notificationIcon(type) {
  return ({ swap:'↔',request:'◷',schedule:'▦',announcement:'◉',task:'☑',calendar:'◫' })[type] || '●';
}
function renderNotifications() {
  const list = $('#notificationsList');
  if (!list) return;
  list.innerHTML = state.notifications.length ? state.notifications.map((item) => `
    <article class="notification-card ${item.read_at ? 'read' : 'unread'} ${item.action_required ? 'requires-action' : ''}" data-id="${item.id}" data-entity-type="${escapeHtml(item.entity_type || '')}" data-entity-id="${escapeHtml(item.entity_id || '')}">
      <span class="notification-icon">${notificationIcon(item.notification_type)}</span>
      <div><div class="notification-title-row"><strong>${escapeHtml(item.title)}</strong>${!item.read_at ? '<i>חדש</i>' : ''}</div><p>${escapeHtml(item.message || '')}</p><small>${formatDate(item.created_at,{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})}${item.action_required ? ' · דורש פעולה' : ''}</small></div>
      <button type="button" class="ghost-btn" data-action="open-notification">פתיחה</button>
    </article>`).join('') : '<div class="empty-state">אין עדכונים חדשים.</div>';
}
function openNotificationsDialog() { renderNotifications(); $('#notificationsDialog').showModal(); }
async function markAllNotificationsRead() {
  try { await apiFetch('/api/notifications',{method:'POST',body:{action:'mark_all_read'}}); state.notifications=state.notifications.map((item)=>({...item,read_at:item.read_at||new Date().toISOString()})); renderNotifications(); renderNavBadges(); } catch(error){ showToast(error.message,'error'); }
}
async function handleNotificationClick(event) {
  const button=event.target.closest('[data-action="open-notification"]'); if(!button)return;
  const card=button.closest('[data-id]'); const id=card.dataset.id; const item=state.notifications.find((row)=>row.id===id);
  try { if(item && !item.read_at) await apiFetch('/api/notifications',{method:'POST',body:{action:'mark_read',id}}); } catch {}
  if(item) item.read_at=item.read_at||new Date().toISOString();
  $('#notificationsDialog').close(); renderNavBadges();
  const type=card.dataset.entityType;
  if(type==='request') switchTab('requests');
  else if(type==='schedule') switchTab('schedule');
  else if(type==='announcement') switchTab('announcements');
  else if(type==='task') switchTab('tasks');
  else if(type==='calendar') switchTab('calendar');
}

function selectedRequestType() { return $('#requestForm input[name="request_type"]:checked')?.value || 'leave'; }
function requestDateLabel(request) { return request.request_end_date && request.request_end_date !== request.request_date ? `${formatDate(request.request_date)} – ${formatDate(request.request_end_date)}` : formatDate(request.request_date); }
function openRequestDialog() {
  const form = $('#requestForm'); form.reset();
  form.elements.request_date.value = dateISO(new Date());
  form.elements.request_end_date.value = dateISO(new Date());
  $('input[name="request_type"][value="leave"]', form).checked = true;
  state.swapCandidates=[]; updateRequestShiftOptions(); updateRequestFields();
  $('#requestDialog').showModal();
}
function updateRequestFields() {
  const form = $('#requestForm'); const type = selectedRequestType();
  const needsShift = ['late_start','early_finish'].includes(type);
  const range = ['leave','sick'].includes(type);
  $$('.request-start').forEach((element)=>element.classList.toggle('hidden',type!=='late_start'));
  $$('.request-end').forEach((element)=>element.classList.toggle('hidden',type!=='early_finish'));
  $$('.request-range-end').forEach((element)=>element.classList.toggle('hidden',!range));
  $$('.shift-choice-field').forEach((element)=>element.classList.toggle('hidden',!needsShift));
  $$('.swap-field').forEach((element)=>element.classList.toggle('hidden',type!=='swap'));
  $$('.sick-attachment').forEach((element)=>element.classList.toggle('hidden',type!=='sick'));
  $('#leaveDayOffField').classList.toggle('hidden',type!=='leave');
  form.elements.shift_id.required=needsShift;
  form.elements.target_employee_id.required=type==='swap';
  form.elements.request_end_date.required=range;
  form.elements.requested_start.required=type==='late_start';
  form.elements.requested_end.required=type==='early_finish';
  $('.request-date-start',form).firstChild.textContent=range?'מתאריך':'תאריך';
  if(range && !form.elements.request_end_date.value) form.elements.request_end_date.value=form.elements.request_date.value;
  const start=form.elements.request_date.value; const end=form.elements.request_end_date.value;
  const days=start&&end?Math.floor((parseDateValue(end)-parseDateValue(start))/86400000)+1:0;
  $('#leaveManualReminder').classList.toggle('hidden',!(type==='leave'&&days>2));
  if(type==='swap') loadSwapCandidates();
}
function updateRequestShiftOptions() {
  const mine=state.shifts.filter((shift)=>shift.employee_id===state.profile.id);
  $('#requestForm [name="shift_id"]').innerHTML=`<option value="">בחר שיבוץ</option>${mine.map((shift)=>`<option value="${shift.id}">${formatDate(shift.shift_date)} · ${classById(shift.class_id)?.name||''} · ${trimTime(shift.start_time)}–${trimTime(shift.end_time)}</option>`).join('')}`;
}
function syncRequestDateFromShift() { const form=$('#requestForm'); const shift=state.shifts.find((item)=>item.id===form.elements.shift_id.value); if(shift){ form.elements.request_date.value=shift.shift_date; form.elements.request_end_date.value=shift.shift_date; } }
function handleRequestDateChange() { const form=$('#requestForm'); if(['leave','sick'].includes(selectedRequestType()) && (!form.elements.request_end_date.value || form.elements.request_end_date.value<form.elements.request_date.value)) form.elements.request_end_date.value=form.elements.request_date.value; if(selectedRequestType()==='swap') loadSwapCandidates(); }
async function loadSwapCandidates() {
  const form=$('#requestForm'); const select=form.elements.target_employee_id; const hint=$('#swapCandidatesHint'); const date=form.elements.request_date.value;
  if(!date){ select.innerHTML='<option value="">בחרו תאריך</option>'; return; }
  state.swapCandidatesLoading=true; select.disabled=true; select.innerHTML='<option value="">טוען עובדים ביום חופשי…</option>'; hint.textContent='בודק מי נמצא ביום חופשי ואינו משובץ…';
  try {
    const result=await apiFetch('/api/requests',{method:'POST',body:{action:'swap_candidates',request_date:date}});
    state.swapCandidates=result.candidates||[];
    select.innerHTML=state.swapCandidates.length?`<option value="">בחרו עובד</option>${state.swapCandidates.map((item)=>`<option value="${item.id}">${escapeHtml(item.full_name)} — ${escapeHtml(item.job_title)}</option>`).join('')}`:'<option value="">לא נמצאו עובדים ביום חופשי</option>';
    hint.textContent=state.swapCandidates.length?`נמצאו ${state.swapCandidates.length} עובדים זמינים להחלפה.`:'אין עובד ביום חופשי שאינו משובץ בתאריך זה.';
  } catch(error){ select.innerHTML='<option value="">לא ניתן לטעון עובדים</option>'; hint.textContent=error.message; }
  finally { state.swapCandidatesLoading=false; select.disabled=false; }
}
function fileToDataUrl(file) { return new Promise((resolve,reject)=>{ const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=()=>reject(new Error('לא ניתן לקרוא את הקובץ')); reader.readAsDataURL(file); }); }
async function saveRequest(event) {
  event.preventDefault(); const form=event.currentTarget; const button=form.querySelector('button[value="default"]'); const data=formObject(form); data.request_type=selectedRequestType(); delete data.sick_certificate;
  if(!['leave','sick'].includes(data.request_type)) delete data.request_end_date;
  data.allow_schedule_on_day_off=data.request_type==='leave'&&String(data.allow_schedule_on_day_off)==='true';
  const file=form.elements.sick_certificate.files?.[0];
  if(file?.size>3*1024*1024)return showToast('אישור המחלה חייב להיות עד 3MB','error');
  setBusy(button,true,'שולח…');
  try {
    if(file){ data.attachment_data=await fileToDataUrl(file); data.attachment_name=file.name; }
    await apiFetch('/api/requests',{method:'POST',body:{action:'create',...data},timeout:20000});
    $('#requestDialog').close(); await refreshAll(); showToast(data.request_type==='swap'?'הבקשה נשלחה לאישור העובד שנבחר':'הבקשה נשלחה','success');
  } catch(error){ showToast(error.message,'error'); } finally { setBusy(button,false); }
}
function requestFlowHtml(request) {
  const steps=request.request_type==='swap'?['נשלח','הסכמת העובד','אישור מנהלה','הוזרם']:['נשלח','אישור','הוזרם'];
  let activeIndex=request.status==='pending'?0:request.status==='approved'?steps.length-2:request.status==='applied'?steps.length-1:0;
  if(request.request_type==='swap'&&request.status==='pending'&&request.target_approved)activeIndex=1;
  return `<div class="request-flow">${steps.map((step,index)=>`<span class="flow-step ${index<=activeIndex?'active':''}">${step}</span>`).join('<span>›</span>')}</div>`;
}
function renderRequests() {
  syncFilterChips('#requestStatusChips',state.requestStatusFilter);
  const counts={pending:0,approved:0,applied:0,closed:0}; state.requests.forEach((request)=>{ if(request.status==='pending')counts.pending+=1; else if(request.status==='approved')counts.approved+=1; else if(request.status==='applied')counts.applied+=1; else counts.closed+=1; });
  $('#requestSummary').innerHTML=`<div class="mini-stat"><strong>${counts.pending}</strong><span>ממתינים</span></div><div class="mini-stat"><strong>${counts.approved}</strong><span>אושרו</span></div><div class="mini-stat"><strong>${counts.applied}</strong><span>הוזרמו</span></div><div class="mini-stat"><strong>${counts.closed}</strong><span>סגורות</span></div>`;
  const term=state.requestSearch.trim().toLowerCase();
  const visible=state.requests.filter((request)=>{ const statusOk=state.requestStatusFilter==='all'||request.status===state.requestStatusFilter||(state.requestStatusFilter==='open'&&['pending','approved'].includes(request.status))||(state.requestStatusFilter==='closed'&&['rejected','applied','cancelled'].includes(request.status)); const requester=employeeById(request.requester_id); const target=employeeById(request.target_employee_id); const haystack=`${requester?.full_name||''} ${target?.full_name||''} ${request.reason||''} ${REQUEST_LABELS[request.request_type]||''}`.toLowerCase(); return statusOk&&(!term||haystack.includes(term)); });
  $('#requestsList').innerHTML=visible.length?visible.map((request)=>{
    const requester=employeeById(request.requester_id); const target=employeeById(request.target_employee_id); const statusClass=request.status==='rejected'||request.status==='cancelled'?'error':request.status==='applied'?'ok':'warn';
    const canApprove=isManager()&&request.status==='pending'&&(request.request_type!=='swap'||request.target_approved);
    return `<article class="request-card type-${request.request_type}"><div class="card-heading"><div class="request-title"><span class="request-avatar">${REQUEST_ICONS[request.request_type]||'●'}</span><div><h3>${REQUEST_LABELS[request.request_type]||'בקשה'}</h3><p class="muted">${escapeHtml(requester?.full_name||'')} · ${requestDateLabel(request)}</p></div></div><span class="status-chip ${statusClass}">${REQUEST_STATUS_LABELS[request.status]}</span></div>${requestFlowHtml(request)}<div class="meta-grid"><div class="meta-item"><small>פירוט</small>${escapeHtml(request.reason||'ללא פירוט')}</div><div class="meta-item"><small>שעות</small>${request.requested_start||request.requested_end?timeHtml(request.requested_start,request.requested_end):'לא רלוונטי'}</div><div class="meta-item"><small>החלפה עם</small>${escapeHtml(target?.full_name||'לא רלוונטי')}${request.request_type==='swap'?` · ${request.target_approved?'אושר על ידי העובד':'ממתין להסכמת העובד'}`:''}</div></div>${request.request_type==='leave'&&request.request_end_date&&Math.floor((parseDateValue(request.request_end_date)-parseDateValue(request.request_date))/86400000)+1>2?'<div class="notice warn"><strong>תזכורת:</strong> נדרשת גם בקשת חופשה ידנית.</div>':''}${request.request_type==='leave'?`<div class="day-off-choice-summary">שיבוץ ביום חופשי קבוע: <strong>${request.allow_schedule_on_day_off?'אפשרי לפי צורך':'לא'}</strong></div>`:''}${request.has_attachment?`<div class="attachment-row"><span>📎 צורף אישור מחלה</span><button class="ghost-btn" data-action="attachment_url" data-id="${request.id}">צפייה באישור</button></div>`:''}${request.manager_note?`<div class="notice"><strong>הערת מנהלה:</strong> ${escapeHtml(request.manager_note)}</div>`:''}<div class="card-actions">${request.request_type==='swap'&&request.target_employee_id===state.profile.id&&!request.target_approved&&request.status==='pending'?`<button class="secondary-btn" data-action="target_accept" data-id="${request.id}">אישור ההחלפה</button><button class="danger-btn" data-action="target_reject" data-id="${request.id}">דחיית ההחלפה</button>`:''}${request.requester_id===state.profile.id&&request.status==='pending'?`<button class="ghost-btn" data-action="cancel" data-id="${request.id}">ביטול הבקשה</button>`:''}${canApprove?`<button class="primary-btn" data-action="approve" data-id="${request.id}">אישור</button><button class="danger-btn" data-action="reject" data-id="${request.id}">דחייה</button>`:''}${isManager()&&request.status==='pending'&&request.request_type==='swap'&&!request.target_approved?'<span class="small-note">ממתין לאישור העובד שנבחר</span>':''}${isManager()&&request.status==='approved'?`<button class="publish-btn" data-action="apply" data-id="${request.id}">הזרמה לשיבוץ</button>`:''}</div></article>`;
  }).join(''):'<div class="empty-state">אין בקשות לפי הסינון שנבחר.</div>';
}
async function handleRequestClick(event) {
  const button=event.target.closest('[data-action]'); if(!button)return;
  if(button.dataset.action==='attachment_url'){
    try { const result=await apiFetch('/api/requests',{method:'POST',body:{action:'attachment_url',id:button.dataset.id}}); window.open(result.url,'_blank','noopener'); } catch(error){ showToast(error.message,'error'); } return;
  }
  let body={id:button.dataset.id,action:button.dataset.action};
  if(button.dataset.action==='approve'||button.dataset.action==='reject')body={...body,action:'decide',status:button.dataset.action==='approve'?'approved':'rejected',manager_note:prompt('הערה לעובד (אפשר להשאיר ריק):')||''};
  if(button.dataset.action==='apply'&&!confirm('להזרים את הבקשה לטיוטת השיבוץ?'))return;
  try { await apiFetch('/api/requests',{method:'POST',body}); await refreshAll(); showToast('הבקשה עודכנה','success'); } catch(error){ showToast(error.message,'error'); }
}

const DAILY_OPERATION_LABELS={sick:'מחלה',absent:'היעדרות',late:'איחור',early_release:'שחרור מוקדם',other:'אחר'};
const DAILY_STATUS_TONES={scheduled:'neutral',present:'ok',replacement:'ok',late:'warn',left_early:'warn',absent:'error',sick:'error'};
function operationForShift(shiftId){return state.dailyOperations.find((row)=>row.shift_id===shiftId);}
function dailyAttendanceForShift(shiftId){return state.dailyAttendance.find((row)=>row.shift_id===shiftId);}
function invalidateDailyCache(date=state.dailyDate){state.dailyCache.delete(date);state.dailyInflight.delete(date);}
async function loadDailyOperations(date=state.dailyDate,{force=false}={}){
  if(!isManager())return;
  const target=date||dateISO(new Date());state.dailyDate=target;$('#dailyDate').value=target;
  const cached=state.dailyCache.get(target);
  const cacheIsFresh=cached&&Date.now()-Number(cached.fetchedAt||0)<30000;
  if(cached&&!force){
    state.dailyOperations=cached.operations;state.dailyShifts=cached.shifts;state.dailyAttendance=cached.attendance;renderDailyOperations();
    if(cacheIsFresh)return;
  }
  if(!cached)$('#dailyClasses').innerHTML='<div class="schedule-loading"><span></span><span></span><span></span><p>טוען תמונת מצב יומית…</p></div>';
  const requestId=++state.dailyRequestId;
  let request=force?null:state.dailyInflight.get(target);
  if(!request){request=apiFetch(`/api/daily-operations?date=${encodeURIComponent(target)}`);state.dailyInflight.set(target,request);}
  try{
    const data=await request;if(requestId!==state.dailyRequestId||target!==state.dailyDate)return;
    const snapshot={operations:data.operations||[],shifts:data.shifts||[],attendance:data.attendance||[],fetchedAt:Date.now()};
    state.dailyCache.set(target,snapshot);state.dailyOperations=snapshot.operations;state.dailyShifts=snapshot.shifts;state.dailyAttendance=snapshot.attendance;renderDailyOperations();
  }catch(error){if(requestId===state.dailyRequestId){$('#dailyClasses').innerHTML=`<div class="empty-state">${escapeHtml(error.message)}</div>`;showToast(error.message,'error');}}
  finally{if(state.dailyInflight.get(target)===request)state.dailyInflight.delete(target);}
}
function dailyOperationRange(operation,shift){
  if(!operation)return '';
  if(['sick','absent'].includes(operation.operation_type))return `${trimTime(shift.start_time)}–${trimTime(shift.end_time)}`;
  if(operation.operation_type==='late')return `${trimTime(shift.start_time)}–${trimTime(operation.start_time)}`;
  if(operation.operation_type==='early_release')return `${trimTime(operation.end_time)}–${trimTime(shift.end_time)}`;
  return `${trimTime(operation.start_time)}–${trimTime(operation.end_time)}`;
}
function dailyAffectedRange(operation,shift){
  if(!operation||!shift)return {start:null,end:null};
  if(['sick','absent'].includes(operation.operation_type))return {start:trimTime(shift.start_time),end:trimTime(shift.end_time)};
  if(operation.operation_type==='late')return {start:trimTime(shift.start_time),end:trimTime(operation.start_time||shift.end_time)};
  if(operation.operation_type==='early_release')return {start:trimTime(operation.end_time||shift.start_time),end:trimTime(shift.end_time)};
  return {start:trimTime(operation.start_time||shift.start_time),end:trimTime(operation.end_time||shift.end_time)};
}
function dailyCoverageForClass(classId){
  const date=state.dailyDate,open=timeToMinutes(state.settings.opening_time||'07:30'),close=timeToMinutes(closingTimeForDate(date));
  const slot=Math.max(15,Number(state.settings.validation_slot_minutes||30)),closingWindow=Math.max(0,Number(state.settings.closing_window_minutes||30));
  const requireLeader=state.settings.require_leader!==false;let ok=true,leader=true,closing=Infinity,minCount=Infinity;
  const base=state.dailyShifts.filter((row)=>row.class_id===classId);
  for(let minute=open;minute<close;minute+=slot){
    const slotStart=minutesLabel(minute),slotEnd=minutesLabel(Math.min(minute+slot,close));const active=new Map();
    for(const shift of base.filter((row)=>overlaps(row.start_time,row.end_time,slotStart,slotEnd)))active.set(shift.employee_id,{employeeId:shift.employee_id,leader:['teacher','lead'].includes(shift.shift_role)});
    for(const operation of state.dailyOperations){
      const original=state.dailyShifts.find((row)=>row.id===operation.shift_id);if(!original)continue;
      const range=dailyAffectedRange(operation,original);if(!range.start||!range.end||!overlaps(range.start,range.end,slotStart,slotEnd))continue;
      if(operation.class_id===classId)active.delete(operation.employee_id);
      if(operation.status==='resolved'&&operation.replacement_employee_id&&operation.class_id===classId){const replacement=employeeById(operation.replacement_employee_id);active.set(operation.replacement_employee_id,{employeeId:operation.replacement_employee_id,leader:Boolean(replacement?.can_lead||['גננת','סייעת מובילה'].includes(replacement?.job_title))});}
      if(operation.status==='resolved'&&operation.replacement_type==='transfer'&&operation.replacement_from_class_id===classId)active.delete(operation.replacement_employee_id);
    }
    const count=active.size;minCount=Math.min(minCount,count);if(minute>=close-closingWindow)closing=Math.min(closing,count);
    const required=minute>=close-closingWindow?Number(state.settings.closing_required_staff||3):Number(state.settings.required_staff||4);if(count<required)ok=false;
    if(requireLeader&&![...active.values()].some((item)=>item.leader)){leader=false;ok=false;}
  }
  if(!Number.isFinite(closing))closing=0;if(!Number.isFinite(minCount))minCount=0;return {ok,leader,closing,minCount,count:new Set(base.map((row)=>row.employee_id)).size};
}
function dailyFilterMatches(shift){
  const operation=operationForShift(shift.id),attendance=dailyAttendanceForShift(shift.id),status=attendance?.status||'scheduled';
  if(state.dailyStatusFilter==='attention')return operation?.status==='open'||['late','left_early','absent','sick'].includes(status);
  if(state.dailyStatusFilter==='unreported')return !attendance||status==='scheduled';
  if(state.dailyStatusFilter==='resolved')return operation?.status==='resolved';
  return true;
}
function setDailyFilter(value){state.dailyStatusFilter=value;syncFilterChips('#dailyStatusChips',value);renderDailyOperations();}
function handleDailyFilterClick(event){const button=event.target.closest('[data-value]');if(button)setDailyFilter(button.dataset.value);}
function dailyAttendanceStatusHtml(attendance){const status=attendance?.status||'scheduled';return `<span class="attendance-state ${DAILY_STATUS_TONES[status]||'neutral'}"><span>${status==='present'?'✓':status==='scheduled'?'…':status==='late'?'◷':status==='left_early'?'◴':status==='sick'?'✚':'×'}</span>${ATTENDANCE_LABELS[status]||status}</span>`;}
function dailyWorkerCard(shift){
  const employee=employeeById(shift.employee_id),operation=operationForShift(shift.id),attendance=dailyAttendanceForShift(shift.id),replacement=employeeById(operation?.replacement_employee_id),source=classById(operation?.replacement_from_class_id);
  const attendanceActual=attendance&&(attendance.actual_start||attendance.actual_end)?timeHtml(attendance.actual_start,attendance.actual_end):'';
  const sourceLabel=operation?.source==='attendance'?'נוצר אוטומטית מנוכחות':'דיווח תפעולי';
  let operationHtml='';
  if(operation){
    operationHtml=`<div class="daily-event-strip ${operation.status==='resolved'?'resolved':'open'}"><div><span>${DAILY_OPERATION_LABELS[operation.operation_type]||'שינוי'}</span><strong>${dailyOperationRange(operation,shift)}</strong></div><small>${sourceLabel}${operation.note?` · ${escapeHtml(operation.note)}`:''}</small></div>`;
    if(operation.status==='resolved')operationHtml+=`<div class="daily-resolution"><strong>${operation.replacement_employee_id?`${operation.replacement_type==='transfer'?'מעבר חירום':'כיסוי'}: ${escapeHtml(replacement?.full_name||'')}`:'נסגר ללא צורך בכיסוי'}</strong><small>${source?`מכיתת ${escapeHtml(source.name)} · `:''}${operation.replacement_start?timeHtml(operation.replacement_start,operation.replacement_end):''}</small></div>`;
  }
  const actionHtml=operation?.status==='open'
    ? `<button class="primary-btn" data-daily-action="suggestions" data-id="${operation.id}">מציאת כיסוי</button><button class="ghost-btn" data-daily-action="edit-report" data-id="${operation.id}">עריכת דיווח</button><button class="ghost-btn" data-daily-action="resolve" data-id="${operation.id}">סגירה ללא כיסוי</button>${operation.source==='manual'?`<button class="danger-btn" data-daily-action="delete-operation" data-id="${operation.id}">מחיקה</button>`:''}`
    : operation?.status==='resolved'
      ? `<button class="ghost-btn" data-daily-action="reopen" data-id="${operation.id}">פתיחה מחדש</button>`
      : `<button class="secondary-btn" data-daily-action="report" data-shift-id="${shift.id}">דיווח שינוי</button>`;
  return `<article class="daily-worker-card ${operation?'has-operation':''} ${operation?.status==='resolved'?'is-resolved':''}" data-shift-id="${shift.id}"><div class="daily-worker-header"><div class="daily-worker-main"><span class="employee-avatar small">${escapeHtml(initials(employee?.full_name))}</span><div><strong>${escapeHtml(employee?.full_name||'עובד')}</strong><small>${timeHtml(shift.start_time,shift.end_time)} · ${SHIFT_ROLE_LABELS[shift.shift_role]||''}</small></div></div>${dailyAttendanceStatusHtml(attendance)}</div>${attendanceActual?`<div class="actual-time-line">נוכחות בפועל: <strong>${attendanceActual}</strong>${attendance?.note?` · ${escapeHtml(attendance.note)}`:''}</div>`:''}${operationHtml}<div class="daily-card-actions"><button class="attendance-btn" data-daily-action="attendance" data-shift-id="${shift.id}">עדכון נוכחות</button>${actionHtml}</div></article>`;
}
function renderDailyOperations(){
  if(!isManager())return;
  const scheduled=state.dailyShifts.length,reported=state.dailyAttendance.filter((row)=>row.status&&row.status!=='scheduled').length,unreported=Math.max(0,scheduled-reported),open=state.dailyOperations.filter((row)=>row.status==='open').length,resolved=state.dailyOperations.filter((row)=>row.status==='resolved').length;
  $('#dailySummary').innerHTML=`<button type="button" class="daily-stat is-open" data-daily-summary-filter="attention"><span>דורש טיפול</span><strong>${open}</strong><small>חוסרים ושינויים פתוחים</small></button><button type="button" class="daily-stat is-unreported" data-daily-summary-filter="unreported"><span>טרם דווחה נוכחות</span><strong>${unreported}</strong><small>מתוך ${scheduled} שיבוצים</small></button><button type="button" class="daily-stat is-resolved" data-daily-summary-filter="resolved"><span>טופל</span><strong>${resolved}</strong><small>כיסויים והעברות</small></button><div class="daily-date-summary"><strong>${formatDate(state.dailyDate,{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</strong><small>${reported} דיווחי נוכחות · סיום היום ${closingTimeForDate(state.dailyDate)}</small></div>`;
  $$('[data-daily-summary-filter]','#dailySummary').forEach((button)=>button.addEventListener('click',()=>setDailyFilter(button.dataset.dailySummaryFilter)));
  const classes=state.classes.filter((item)=>item.active);
  $('#dailyClasses').innerHTML=classes.map((classItem,index)=>{
    const allShifts=state.dailyShifts.filter((row)=>row.class_id===classItem.id),shifts=allShifts.filter(dailyFilterMatches),result=dailyCoverageForClass(classItem.id),classOpen=allShifts.filter((row)=>operationForShift(row.id)?.status==='open').length;
    const cards=shifts.map(dailyWorkerCard).join('');
    return `<section class="daily-class-card class-tone-${index%4}"><header><div><span class="class-symbol">${['☁','✿','☀','★'][index%4]}</span><div><h3>${escapeHtml(classItem.name)}</h3><small>${allShifts.length} עובדים מתוכננים${classOpen?` · ${classOpen} דורשים טיפול`:''}</small></div></div><span class="status-chip ${result.ok?'ok':'error'}">${result.ok?'הכיתה מכוסה':'נדרש טיפול'}</span></header><div class="daily-coverage-meter"><span style="--coverage:${Math.min(100,(result.minCount/Math.max(1,Number(state.settings.required_staff||4)))*100)}%"></span><small>מינימום ${result.minCount} במהלך היום · ${result.closing} בסגירה · ${result.leader?'אחראי/ת כיתה קיים/ת':'חסר/ה אחראי/ת כיתה'}</small></div><div class="daily-worker-list">${cards||'<div class="empty-state compact">אין עובדים לפי הסינון שנבחר בכיתה זו.</div>'}</div></section>`;
  }).join('')||'<div class="empty-state">אין כיתות פעילות.</div>';
}
function openDailyReportDialog(shift,operation=null){
  const form=$('#dailyReportForm');form.reset();form.elements.shift_id.value=shift.id;form.dataset.operationId=operation?.id||'';form.dataset.shiftStart=trimTime(shift.start_time);form.dataset.shiftEnd=trimTime(shift.end_time);
  $('#dailyReportEmployee').innerHTML=`${escapeHtml(employeeById(shift.employee_id)?.full_name||'')} · ${escapeHtml(classById(shift.class_id)?.name||'')} · ${timeHtml(shift.start_time,shift.end_time)}`;
  if(operation){const radio=form.querySelector(`input[name="operation_type"][value="${operation.operation_type}"]`);if(radio)radio.checked=true;form.elements.start_time.value=trimTime(operation.start_time)||'';form.elements.end_time.value=trimTime(operation.end_time)||'';form.elements.note.value=operation.note||'';}
  syncDailyReportFields();$('#dailyReportDialog').showModal();
}
function syncDailyReportFields(){
  const form=$('#dailyReportForm'),type=form.querySelector('input[name="operation_type"]:checked')?.value||'sick';
  $('#dailyStartField').classList.toggle('hidden',!['late','other'].includes(type));$('#dailyEndField').classList.toggle('hidden',!['early_release','other'].includes(type));
  form.elements.start_time.required=['late','other'].includes(type);form.elements.end_time.required=['early_release','other'].includes(type);
  if(type==='late'&&!form.elements.start_time.value)form.elements.start_time.value=form.dataset.shiftStart||'';if(type==='early_release'&&!form.elements.end_time.value)form.elements.end_time.value=form.dataset.shiftEnd||'';
}
async function saveDailyReport(event){
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[value="default"]'),data=formObject(form),operationId=form.dataset.operationId;data.action=operationId?'update_report':'report';if(operationId)data.id=operationId;setBusy(button,true);
  try{const result=await apiFetch('/api/daily-operations',{method:'POST',body:data});$('#dailyReportDialog').close();invalidateDailyCache();await loadDailyOperations(state.dailyDate,{force:true});showToast(operationId?'הדיווח עודכן':'הדיווח נשמר','success');if(result.operation?.id&&!operationId)await loadDailySuggestions(result.operation.id);}catch(error){showToast(error.message,'error');}finally{setBusy(button,false);}
}
function dailyRecommendationLabel(item){if(item.score>=80)return 'התאמה מצוינת';if(item.score>=60)return 'התאמה טובה';return 'אפשרות נוספת';}
async function loadDailySuggestions(id){
  state.dailySuggestionsContext={id};$('#dailySuggestionsList').innerHTML='<div class="schedule-loading"><span></span><span></span><span></span><p>בודק זמינות, העדפות ותקינה…</p></div>';$('#dailySuggestionsDialog').showModal();
  try{const data=await apiFetch('/api/daily-operations',{method:'POST',body:{action:'suggestions',id}});$('#dailySuggestionsList').innerHTML=data.suggestions?.length?data.suggestions.map((item,index)=>`<article class="daily-suggestion-card ${item.replacement_type}"><div class="suggestion-rank">${index+1}</div><div class="card-heading"><div><h3>${escapeHtml(item.full_name)}</h3><p>${escapeHtml(item.job_title)} · ${timeHtml(item.start_time,item.end_time)}</p></div><span class="score-chip">${dailyRecommendationLabel(item)} · ${item.score}</span></div><ul class="reason-list">${item.reasons.map((reason)=>`<li>${escapeHtml(reason)}</li>`).join('')}</ul>${item.from_class_id?`<div class="notice">העברת חירום מכיתת <strong>${escapeHtml(classById(item.from_class_id)?.name||'')}</strong> בלי לפגוע בתקן המקור.</div>`:''}<button class="primary-btn full-width" data-daily-suggestion="assign" data-employee-id="${item.employee_id}" data-replacement-type="${item.replacement_type}">${item.replacement_type==='transfer'?'ביצוע מעבר חירום':'שיבוץ ככיסוי'}</button></article>`).join(''):'<div class="empty-state">לא נמצאה כרגע אפשרות כיסוי בטוחה. אפשר לשנות את טווח השעות, לבדוק מחדש או לסגור ללא כיסוי.</div>';}catch(error){$('#dailySuggestionsList').innerHTML=`<div class="empty-state">${escapeHtml(error.message)}</div>`;}
}
function openDailyAttendanceDialog(shift){
  const form=$('#dailyAttendanceForm'),row=dailyAttendanceForShift(shift.id);form.reset();form.elements.shift_id.value=shift.id;form.dataset.shiftStart=trimTime(shift.start_time);form.dataset.shiftEnd=trimTime(shift.end_time);
  const status=row?.status&&row.status!=='scheduled'&&row.status!=='replacement'?row.status:'present',radio=form.querySelector(`input[name="status"][value="${status}"]`);if(radio)radio.checked=true;
  form.elements.actual_start.value=trimTime(row?.actual_start)||trimTime(shift.start_time);form.elements.actual_end.value=trimTime(row?.actual_end)||trimTime(shift.end_time);form.elements.note.value=row?.note||'';
  $('#dailyAttendanceEmployee').innerHTML=`${escapeHtml(employeeById(shift.employee_id)?.full_name||'')} · ${escapeHtml(classById(shift.class_id)?.name||'')} · תוכנן ${timeHtml(shift.start_time,shift.end_time)}`;syncDailyAttendanceFields();$('#dailyAttendanceDialog').showModal();
}
function syncDailyAttendanceFields(){
  const form=$('#dailyAttendanceForm'),status=form.querySelector('input[name="status"]:checked')?.value||'present',start=form.elements.actual_start,end=form.elements.actual_end;
  start.disabled=['absent','sick'].includes(status);end.disabled=['absent','sick'].includes(status);start.required=status==='late';end.required=status==='left_early';
  if(status==='present'){start.value=form.dataset.shiftStart||'';end.value=form.dataset.shiftEnd||'';}
  if(status==='late'&&(!start.value||start.value===form.dataset.shiftStart))start.value='';
  if(status==='left_early'&&(!end.value||end.value===form.dataset.shiftEnd))end.value='';
  if(['absent','sick'].includes(status)){start.value='';end.value='';}
}
async function saveDailyAttendance(event){
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[value="default"]'),data=formObject(form);setBusy(button,true);
  try{const result=await apiFetch('/api/attendance',{method:'POST',body:data});$('#dailyAttendanceDialog').close();invalidateDailyCache();await loadDailyOperations(state.dailyDate,{force:true});showToast(result.operation?.status==='open'?'הנוכחות נשמרה ונוצר חוסר לטיפול':'הנוכחות נשמרה','success');if(result.operation?.status==='open')await loadDailySuggestions(result.operation.id);}catch(error){showToast(error.message,'error');}finally{setBusy(button,false);}
}
async function markAllPresent(){
  const button=$('#markAllPresentBtn');if(!confirm('לסמן כנוכחים את כל העובדים המשובצים שטרם עודכנו היום?'))return;setBusy(button,true,'מעדכן…');
  try{const result=await apiFetch('/api/attendance',{method:'POST',body:{action:'mark_all_present',date:state.dailyDate}});invalidateDailyCache();await loadDailyOperations(state.dailyDate,{force:true});showToast(`${result.count||0} עובדים סומנו כנוכחים`,'success');}catch(error){showToast(error.message,'error');}finally{setBusy(button,false);}
}
async function handleDailyClick(event){
  const button=event.target.closest('[data-daily-action]');if(!button)return;const action=button.dataset.dailyAction,shift=state.dailyShifts.find((row)=>row.id===button.dataset.shiftId),operation=state.dailyOperations.find((row)=>row.id===button.dataset.id);
  if(action==='attendance'&&shift)return openDailyAttendanceDialog(shift);
  if(action==='report'&&shift)return openDailyReportDialog(shift);
  if(action==='edit-report'&&operation){const linked=state.dailyShifts.find((row)=>row.id===operation.shift_id);if(linked)return openDailyReportDialog(linked,operation);}
  if(action==='suggestions')return loadDailySuggestions(button.dataset.id);
  if(action==='reopen'||action==='resolve'||action==='delete-operation'){
    if(action==='resolve'&&!confirm('לסגור את האירוע ללא שיבוץ מחליף?'))return;if(action==='delete-operation'&&!confirm('למחוק את הדיווח התפעולי?'))return;
    const apiAction=action==='resolve'?'resolve_without_replacement':action==='delete-operation'?'delete':'reopen';setBusy(button,true);
    try{await apiFetch('/api/daily-operations',{method:'POST',body:{action:apiAction,id:button.dataset.id}});invalidateDailyCache();await loadDailyOperations(state.dailyDate,{force:true});showToast(action==='reopen'?'האירוע נפתח מחדש':action==='resolve'?'האירוע נסגר':'הדיווח נמחק','success');}catch(error){showToast(error.message,'error');}finally{setBusy(button,false);}
  }
}
async function handleDailySuggestionClick(event){
  const button=event.target.closest('[data-daily-suggestion="assign"]');if(!button||!state.dailySuggestionsContext)return;setBusy(button,true,'משבץ…');
  try{await apiFetch('/api/daily-operations',{method:'POST',body:{action:'assign',id:state.dailySuggestionsContext.id,employee_id:button.dataset.employeeId,replacement_type:button.dataset.replacementType}});$('#dailySuggestionsDialog').close();invalidateDailyCache();await loadDailyOperations(state.dailyDate,{force:true});showToast('הכיסוי נשמר בתפעול היומי','success');}catch(error){showToast(error.message,'error');}finally{setBusy(button,false);}
}

function renderAttendance(){
  const shifts=state.shifts.filter((shift)=>shift.shift_date===state.attendanceDate&&(isManager()||shift.employee_id===state.profile.id));
  $('#attendanceList').innerHTML=shifts.length?shifts.map((shift)=>{const row=state.attendance.find((attendance)=>attendance.shift_id===shift.id);return `<article class="attendance-card" data-shift-id="${shift.id}"><div class="card-heading"><div><h3>${escapeHtml(employeeById(shift.employee_id)?.full_name||'')}</h3><p class="muted">${escapeHtml(classById(shift.class_id)?.name||'')} · ${timeHtml(shift.start_time,shift.end_time)}</p></div>${dailyAttendanceStatusHtml(row)}</div>${isManager()?`<div class="form-grid"><label>מצב<select class="attendance-status">${Object.entries(ATTENDANCE_LABELS).filter(([value])=>!['scheduled','replacement'].includes(value)).map(([value,label])=>`<option value="${value}" ${(row?.status||'present')===value?'selected':''}>${label}</option>`).join('')}</select></label><label>התחלה בפועל<input class="attendance-start" type="time" value="${trimTime(row?.actual_start)||trimTime(shift.start_time)}"/></label><label>סיום בפועל<input class="attendance-end" type="time" value="${trimTime(row?.actual_end)||trimTime(shift.end_time)}"/></label><label>הערה<input class="attendance-note" value="${escapeHtml(row?.note||'')}"/></label></div><button class="primary-btn" data-action="save-attendance">שמירת נוכחות</button>`:`<div class="meta-grid"><div class="meta-item"><small>מצב</small>${ATTENDANCE_LABELS[row?.status||'scheduled']}</div><div class="meta-item"><small>בפועל</small>${timeHtml(row?.actual_start,row?.actual_end)}</div></div>`}</article>`;}).join(''):`<div class="empty-state">אין שיבוצים בתאריך ${formatDate(state.attendanceDate)}.</div>`;
}
async function handleAttendanceClick(event){
  const button=event.target.closest('[data-action="save-attendance"]');if(!button)return;const card=button.closest('[data-shift-id]');setBusy(button,true);
  try{const result=await apiFetch('/api/attendance',{method:'POST',body:{shift_id:card.dataset.shiftId,status:$('.attendance-status',card).value,actual_start:$('.attendance-start',card).value,actual_end:$('.attendance-end',card).value,note:$('.attendance-note',card).value}});const index=state.attendance.findIndex((row)=>row.shift_id===card.dataset.shiftId);if(result.attendance){if(index>=0)state.attendance[index]=result.attendance;else state.attendance.push(result.attendance);}renderAttendance();invalidateDailyCache(state.attendanceDate);if(state.activeTab==='daily'&&state.dailyDate===state.attendanceDate)await loadDailyOperations(state.dailyDate,{force:true});showToast('הנוכחות נשמרה','success');}catch(error){showToast(error.message,'error');}finally{setBusy(button,false);}
}

function selectedCheckboxValues(container, name) { return $$(`input[name="${name}"]:checked`, container).map((input) => input.value); }
function openAnnouncementDialog() { const form = $('#announcementForm'); form.reset(); $('input[name="audience_type"][value="all"]', form).checked = true; $('#announcementEmployeesField').innerHTML = employeePickerHtml('announcement_employee_ids'); updateAnnouncementAudience(); $('#announcementDialog').showModal(); }
function updateAnnouncementAudience() { const type = $('#announcementForm input[name="audience_type"]:checked')?.value || 'all'; $('#announcementClassField').classList.toggle('hidden', type !== 'class'); $('#announcementEmployeesField').classList.toggle('hidden', type !== 'employees'); }
function audienceText(item, kind = 'announcement') {
  const type = kind === 'task' ? item.target_type : item.audience_type;
  if (type === 'class') return `כיתת ${classById(kind === 'task' ? item.target_id : item.class_id)?.name || ''}`;
  if (type === 'employees' || type === 'employee') {
    const count = kind === 'task' ? state.taskAssignees.filter((row) => row.task_id === item.id).length : state.announcementRecipients.filter((row) => row.announcement_id === item.id).length;
    return `${count} עובדים נבחרים`;
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

async function setCalendarMonth(date, { force = false } = {}) {
  const target = monthStart(date); const key = monthParam(target); const requestId = ++state.calendarRequestId;
  state.calendarMonth = target;
  const cached = state.calendarCache.get(key);
  let request = null;
  if (cached) { state.calendarEvents = cached.events; renderCalendar(); }
  $('#calendarMonthLabel').textContent = `${formatDate(target, { month: 'long', year: 'numeric' })}${cached ? '' : ' · טוען…'}`;
  try {
    request = !force ? state.calendarInflight.get(key) : null;
    if (!request) { request = apiFetch(`/api/calendar?month=${key}`, { timeout: 8000 }); state.calendarInflight.set(key, request); }
    const result = await request;
    state.calendarCache.set(key, { events: result.events || [], fetchedAt: Date.now() });
    if (requestId === state.calendarRequestId && key === monthParam(state.calendarMonth)) { state.calendarEvents = result.events || []; renderCalendar(); }
    prefetchCalendarMonths();
  } catch (error) { if (!cached) showToast(error.message, 'error'); }
  finally { if (state.calendarInflight.get(key) === request) state.calendarInflight.delete(key); }
}
function changeCalendarMonth(delta) { return setCalendarMonth(addMonths(state.calendarMonth, delta)); }
function prefetchCalendarMonths() {
  const months = [addMonths(state.calendarMonth, -1), addMonths(state.calendarMonth, 1)];
  const run = () => months.forEach((date) => {
    const key = monthParam(date);
    if (state.calendarCache.has(key) || state.calendarInflight.has(key)) return;
    let request;
    request = apiFetch(`/api/calendar?month=${key}`, { timeout: 8000 })
      .then((result) => state.calendarCache.set(key, { events: result.events || [], fetchedAt: Date.now() }))
      .finally(() => { if (state.calendarInflight.get(key) === request) state.calendarInflight.delete(key); });
    state.calendarInflight.set(key, request);
  });
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 1200 }); else setTimeout(run, 180);
}
function calendarCells() { const first = monthStart(state.calendarMonth); const gridStart = addDays(first, -first.getDay()); return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index)); }
function renderCalendar() {
  $('#calendarMonthLabel').textContent = formatDate(state.calendarMonth, { month: 'long', year: 'numeric' });
  const weekdays = DAY_NAMES.map((name) => `<div class="calendar-weekday">${name}</div>`).join('');
  const today = dateISO(new Date());
  const cells = calendarCells().map((date) => {
    const iso = dateISO(date); const events = state.calendarEvents.filter((event) => event.event_date === iso); const outside = date.getMonth() !== state.calendarMonth.getMonth();
    const shown = events.slice(0, 3).map((event) => `<button class="calendar-event ${event.event_type}" data-event-id="${event.id}" title="${escapeHtml(event.title)}">${EVENT_ICONS[event.event_type]} ${escapeHtml(event.title)}</button>`).join('');
    return `<div class="calendar-day ${outside ? 'outside' : ''} ${iso === today ? 'today' : ''} ${canCreateContent() ? 'selectable' : ''}" data-calendar-date="${iso}" ${canCreateContent() ? 'role="button" tabindex="0" aria-label="יצירת אירוע בתאריך ' + escapeHtml(formatDate(iso)) + '"' : ''}><div class="calendar-day-number"><span>${date.getDate()}</span><span class="calendar-day-tools">${events.length ? `<small>${events.length}</small>` : ''}${canCreateContent() ? '<i aria-hidden="true">＋</i>' : ''}</span></div><div class="calendar-events">${shown}${events.length > 3 ? `<span class="calendar-more">ועוד ${events.length - 3}</span>` : ''}</div></div>`;
  }).join('');
  $('#calendarGrid').innerHTML = `<div class="calendar-weekdays">${weekdays}</div><div class="calendar-grid">${cells}</div>`;
}
function openCalendarDialog(event = {}) { const form = $('#calendarForm'); form.reset(); form.elements.event_date.value = event.event_date || dateISO(new Date()); form.elements.visibility.value = event.visibility || 'all'; form.elements.event_type.value = event.event_type || 'meeting'; $('#calendarDialog').showModal(); }
function openCalendarEvent(event) {
  $('#calendarEventTitle').textContent = event.title;
  $('#calendarEventDetails').innerHTML = `<div class="event-hero"><strong>${EVENT_ICONS[event.event_type]} ${EVENT_LABELS[event.event_type]}</strong><p>${formatDate(event.event_date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${event.start_time ? ` · ${timeHtml(event.start_time, event.end_time)}` : ''}</p></div><div class="event-detail-row"><strong>נראות</strong><span>${event.visibility === 'all' ? 'כל העובדים' : event.visibility === 'managers' ? 'לינור ואילנית בלבד' : `כיתת ${classById(event.class_id)?.name || ''}`}</span></div>${event.description ? `<div class="event-detail-row"><strong>פירוט</strong><span>${escapeHtml(event.description).replaceAll('\n', '<br>')}</span></div>` : ''}`;
  const canManage = isManager() || event.created_by === state.profile.id;
  $('#calendarEventActions').innerHTML = canManage ? `<button class="danger-btn" data-action="delete-event" data-id="${event.id}">מחיקת אירוע</button>` : '<button type="button" class="ghost-btn close-dialog-inline">סגירה</button>';
  $('#calendarEventDialog').showModal();
}
async function saveCalendarEvent(event) { event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[value="default"]'); const data = formObject(form); setBusy(button, true); try { await apiFetch('/api/calendar', { method: 'POST', body: data }); $('#calendarDialog').close(); await setCalendarMonth(state.calendarMonth); showToast('האירוע נשמר', 'success'); } catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); } }
function handleCalendarClick(event) {
  const eventButton = event.target.closest('[data-event-id]');
  if (eventButton) {
    const item = state.calendarEvents.find((calendarEvent) => calendarEvent.id === eventButton.dataset.eventId);
    if (item) openCalendarEvent(item);
    return;
  }
  const day = event.target.closest('[data-calendar-date]');
  if (day && canCreateContent()) openCalendarDialog({ event_date: day.dataset.calendarDate });
}
function handleCalendarKeydown(event) {
  if (!['Enter', ' '].includes(event.key)) return;
  const day = event.target.closest('[data-calendar-date]');
  if (!day || !canCreateContent()) return;
  event.preventDefault();
  openCalendarDialog({ event_date: day.dataset.calendarDate });
}
async function handleCalendarEventAction(event) { const button = event.target.closest('[data-action],.close-dialog-inline'); if (!button) return; if (button.classList.contains('close-dialog-inline')) return $('#calendarEventDialog').close(); if (button.dataset.action === 'delete-event') { if (!confirm('למחוק את האירוע?')) return; try { await apiFetch('/api/calendar', { method: 'DELETE', body: { id: button.dataset.id } }); $('#calendarEventDialog').close(); await setCalendarMonth(state.calendarMonth); showToast('האירוע נמחק', 'success'); } catch (error) { showToast(error.message, 'error'); } } }

async function showSuggestions(date, classId, shift = null) {
  const start = trimTime(shift?.start_time) || trimTime(state.settings.opening_time) || '07:30'; const end = trimTime(shift?.end_time) || trimTime(state.settings.closing_time) || '15:30'; const dayRows = state.shifts.filter((row) => row.shift_date === date && row.class_id === classId); const role = shift?.shift_role || (!dayRows.some((row) => ['teacher', 'lead'].includes(row.shift_role)) ? 'teacher' : 'staff'); const original = shift ? employeeById(shift.employee_id) : null;
  state.suggestionsContext = { date, classId, start, end, role, shiftId: shift?.id || null, originalName: original?.full_name || '', originalNote: shift?.public_note || '' };
  $('#suggestionsList').innerHTML = `<div class="empty-state">מחפש עובדים פנויים ל-${start}–${end}…</div>`; $('#suggestionsDialog').showModal();
  try { const params = new URLSearchParams({ date, class_id: classId, start_time: start, end_time: end, shift_role: role }); if(shift?.id)params.set('exclude_shift_id',shift.id); const result = await apiFetch(`/api/suggestions?${params}`); $('#suggestionsList').innerHTML = result.candidates.length ? result.candidates.map((candidate) => `<article class="suggestion-card"><div class="card-heading"><div><h3>${escapeHtml(candidate.full_name)}</h3><p class="muted">${escapeHtml(candidate.job_title)} · ${timeHtml(start, end)}</p></div><span class="score-chip">התאמה ${candidate.score}</span></div><ul class="reason-list">${candidate.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul><button class="primary-btn" data-action="use-suggestion" data-id="${candidate.employee_id}" data-role="${candidate.suggested_role}">${shift ? 'החלפת העובד בשיבוץ' : 'שיבוץ העובד'}</button></article>`).join('') : '<div class="empty-state">לא נמצא מחליף זמין בשעות אלה.</div>'; }
  catch (error) { $('#suggestionsList').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
}
async function handleSuggestionClick(event) { const button = event.target.closest('[data-action="use-suggestion"]'); if (!button) return; const context = state.suggestionsContext; const wasPublished=isPublishedWeekDate(context.date); try { if (context.shiftId) { const replacementNote = [context.originalNote, context.originalName ? `מחליף/ה במקום ${context.originalName}` : 'שובץ כמחליף/ה'].filter(Boolean).join(' · '); await apiFetch('/api/shifts', { method: 'PATCH', body: { id: context.shiftId, employee_id: button.dataset.id, shift_role: button.dataset.role, public_note: replacementNote } }); } else { await apiFetch('/api/shifts', { method: 'POST', body: { shift_date: context.date, class_id: context.classId, employee_id: button.dataset.id, start_time: context.start, end_time: context.end, shift_role: button.dataset.role, public_note: 'שובץ כהחלפה' } }); } $('#suggestionsDialog').close(); state.shiftSuggestionCache.clear(); await refreshScheduleWeek({ force: true }); showToast(context.shiftId ? 'העובד הוחלף בטיוטה' : 'המחליף/ה שובץ בטיוטה', 'success'); if(wasPublished)showPostPublishChangePrompt({title:'החלפה בוצעה בשבוע שכבר פורסם',message:'ההחלפה נשמרה בטיוטה. יש לפרסם אותה כדי שהצוות יראה את השינוי.'}); } catch (error) { showToast(error.message, 'error'); } }

function minuteText(total) {
  const safe = Math.max(0, Number(total) || 0);
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}
function renderSettingsPreview() {
  const form = $('#settingsForm'); if (!form || !$('#settingsPreview')) return;
  const opening = trimTime(form.elements.opening_time.value) || '07:30';
  const closing = trimTime(form.elements.closing_time.value) || '15:30';
  const fridayClosing = trimTime(form.elements.friday_closing_time.value) || '12:00';
  const required = Number(form.elements.required_staff.value || 0); const closingRequired = Number(form.elements.closing_required_staff.value || 0);
  const windowMinutes = Number(form.elements.closing_window_minutes.value || 0); const slot = Number(form.elements.validation_slot_minutes.value || 30);
  const requireLeader = form.elements.require_leader.checked;
  const closingStart = minuteText(timeToMinutes(closing) - windowMinutes); const fridayClosingStart=minuteText(timeToMinutes(fridayClosing)-windowMinutes);
  const invalid = timeToMinutes(closing) <= timeToMinutes(opening) || timeToMinutes(fridayClosing)<=timeToMinutes(opening) || timeToMinutes(fridayClosing)>720 || required < 1 || closingRequired < 1 || closingRequired > required || windowMinutes < 0 || windowMinutes > 180;
  if (invalid) { $('#settingsPreview').innerHTML = '<div class="notice error">יש לתקן את הערכים: שישי חייב להסתיים עד 12:00, תקן הסגירה אינו יכול להיות גבוה מהתקן הרגיל.</div>'; return; }
  const previous = state.settings;
  state.settings = { ...state.settings, opening_time: opening, closing_time: closing, friday_closing_time:fridayClosing, required_staff: required, closing_required_staff: closingRequired, closing_window_minutes: windowMinutes, validation_slot_minutes: slot, require_leader:requireLeader };
  const impact = validateScheduleClient(); state.settings = previous;
  $('#settingsPreview').innerHTML = `<div class="standards-preview-title"><span>תצוגה מקדימה</span><strong>א׳–ה׳ ${opening}–${closing} · שישי ${opening}–${fridayClosing}</strong></div><div class="standards-timeline"><div class="timeline-rule regular"><span>${opening}</span><strong>${required} אנשי צוות בכל כיתה</strong><small>בדיקה כל ${slot} דקות${requireLeader?' · חובה אחראי/ת כיתה':''}</small></div><div class="timeline-arrow">←</div><div class="timeline-rule closing"><span>${closingStart}</span><strong>${closingRequired} אנשי צוות בסגירה א׳–ה׳</strong><small>עד ${closing}</small></div><div class="timeline-rule friday"><span>${fridayClosingStart}</span><strong>${closingRequired} אנשי צוות בסגירת שישי</strong><small>עד ${fridayClosing}</small></div></div><div class="standards-impact ${impact.errors.length ? 'has-errors' : 'is-ok'}"><strong>${impact.errors.length}</strong><span>מוקדי תקינה בשבוע המוצג</span><small>${impact.warnings.length} התראות שעות אישיות</small></div>`;
}
function applyStandardsPreset(required, closingRequired, windowMinutes) {
  const form = $('#settingsForm');
  form.elements.opening_time.value = '07:30'; form.elements.closing_time.value = '15:30'; form.elements.friday_closing_time.value='12:00';
  form.elements.required_staff.value = String(required); form.elements.closing_required_staff.value = String(closingRequired);
  form.elements.closing_window_minutes.value = String(windowMinutes || 15); form.elements.validation_slot_minutes.value = '30'; form.elements.require_leader.checked=true;
  renderSettingsPreview();
}
function applyDefaultStandards() { applyStandardsPreset(4, 3, 30); }
function openSettings() {
  const form = $('#settingsForm');
  for (const name of ['opening_time', 'closing_time','friday_closing_time']) form.elements[name].value = trimTime(state.settings[name]) || (name==='friday_closing_time'?'12:00':'');
  for (const name of ['required_staff', 'closing_required_staff', 'closing_window_minutes', 'validation_slot_minutes']) form.elements[name].value = state.settings[name];
  form.elements.require_leader.checked=state.settings.require_leader!==false;
  renderSettingsPreview(); $('#settingsDialog').showModal();
}
async function saveSettings(event) {
  event.preventDefault();
  const form = event.currentTarget; const button = form.querySelector('button[value="default"]'); const data = formObject(form);
  for (const name of ['required_staff', 'closing_required_staff', 'closing_window_minutes', 'validation_slot_minutes']) data[name] = Number(data[name]);
  data.require_leader=form.elements.require_leader.checked;
  setBusy(button, true);
  try { await apiFetch('/api/settings', { method: 'PATCH', body: data }); state.settings = { ...state.settings, ...data }; state.weekCache.clear(); $('#settingsDialog').close(); await refreshScheduleWeek({ force: true }); showToast('הגדרות התקינה נשמרו', 'success'); }
  catch (error) { showToast(error.message, 'error'); } finally { setBusy(button, false); }
}
init();
