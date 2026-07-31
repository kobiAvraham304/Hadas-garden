/* מערכת השיבוצים של מעון הדס — גרסה 0.1.0 */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const ROLE_LABELS = { admin: 'מנהלת מעון', scheduler: 'אחראית שיבוץ', employee: 'עובדת' };
const SHIFT_ROLE_LABELS = { teacher: 'גננת', lead: 'מובילה', staff: 'אשת צוות', replacement: 'מחליפה' };
const SHIFT_STATUS_LABELS = { draft: 'טיוטה', temporary: 'זמני', final: 'סופי' };
const REQUEST_LABELS = {
  leave: 'חופשה', day_off: 'יום חופשי', late_start: 'התחלה מאוחרת',
  early_finish: 'סיום מוקדם', sick: 'מחלה', swap: 'החלפת שיבוץ', other: 'אחר',
};
const REQUEST_STATUS_LABELS = {
  pending: 'ממתינה', approved: 'אושרה', rejected: 'נדחתה', applied: 'הוזרמה לשיבוץ', cancelled: 'בוטלה',
};
const ATTENDANCE_LABELS = {
  scheduled: 'טרם עודכן', present: 'נכחה', late: 'איחרה', left_early: 'יצאה מוקדם',
  absent: 'נעדרה', sick: 'מחלה', replacement: 'החליפה עובדת',
};

const state = {
  client: null,
  session: null,
  profile: null,
  classes: [],
  profiles: [],
  constraints: [],
  privateRows: [],
  settings: { opening_time: '07:30:00', closing_time: '15:30:00', required_staff: 4, closing_required_staff: 3 },
  weekStart: startOfWeek(new Date()),
  shifts: [],
  requests: [],
  attendance: [],
  todayShifts: [],
  attendanceDateShifts: [],
  attendanceDateRows: [],
  realtimeChannel: null,
  reloadTimer: null,
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function dateISO(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value) {
  return new Date(`${value}T12:00:00`);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfWeek(date) {
  const result = new Date(date);
  result.setHours(12, 0, 0, 0);
  result.setDate(result.getDate() - result.getDay());
  return result;
}

function formatDate(value, options = { day: '2-digit', month: '2-digit', year: 'numeric' }) {
  return new Intl.DateTimeFormat('he-IL', options).format(typeof value === 'string' ? parseLocalDate(value) : value);
}

function trimTime(value) {
  return value ? String(value).slice(0, 5) : '';
}

function timeToMinutes(value) {
  if (!value) return 0;
  const [hours, minutes] = String(value).slice(0, 5).split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesBetween(start, end) {
  return Math.max(0, timeToMinutes(end) - timeToMinutes(start));
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(aEnd) > timeToMinutes(bStart);
}

function normalizePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.startsWith('972')) return `+${digits}`;
  if (digits.startsWith('0')) return `+972${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith('5')) return `+972${digits}`;
  return String(input || '').trim();
}

function isManager() {
  return ['admin', 'scheduler'].includes(state.profile?.role);
}

function profileById(id) {
  return state.profiles.find((profile) => profile.id === id);
}

function classById(id) {
  return state.classes.find((item) => item.id === id);
}

function hasApprovedAbsence(employeeId, date) {
  return state.requests.some((request) =>
    request.requester_id === employeeId
    && request.request_date === date
    && ['leave', 'day_off', 'sick'].includes(request.request_type)
    && ['approved', 'applied'].includes(request.status)
  );
}

function showToast(message, type = '') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.className = `toast ${type}`.trim();
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 3600);
}

function setScreen(screen) {
  for (const id of ['loadingScreen', 'loginScreen', 'passwordScreen', 'appShell']) {
    $(`#${id}`).classList.toggle('hidden', id !== screen);
  }
}

function setBusy(button, busy, busyText = 'שומר…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = busyText;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

async function init() {
  bindStaticEvents();
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || 'לא ניתן לטעון את הגדרות המערכת');
    if (!window.supabase) throw new Error('ספריית Supabase לא נטענה');

    state.client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

    state.client.auth.onAuthStateChange((_event, session) => {
      state.session = session;
    });

    const { data, error } = await state.client.auth.getSession();
    if (error) throw error;
    state.session = data.session;
    if (!state.session) return setScreen('loginScreen');
    await enterApp();
  } catch (error) {
    console.error(error);
    setScreen('loginScreen');
    showToast(error.message, 'error');
  }
}

function bindStaticEvents() {
  $('#loginForm').addEventListener('submit', handleLogin);
  $('#passwordForm').addEventListener('submit', handlePasswordChange);
  $('#logoutBtn').addEventListener('click', logout);

  $$('.nav-btn').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  $('#prevWeekBtn').addEventListener('click', () => changeWeek(-7));
  $('#nextWeekBtn').addEventListener('click', () => changeWeek(7));
  $('#todayWeekBtn').addEventListener('click', () => setWeek(startOfWeek(new Date())));
  $('#addShiftBtn').addEventListener('click', () => openShiftDialog());
  $('#publishTemporaryBtn').addEventListener('click', () => publishWeek('temporary'));
  $('#publishFinalBtn').addEventListener('click', () => publishWeek('final'));
  $('#ackScheduleBtn').addEventListener('click', acknowledgeSchedule);
  $('#printBtn').addEventListener('click', () => window.print());
  $('#imageBtn').addEventListener('click', downloadScheduleImage);
  $('#newEmployeeBtn').addEventListener('click', () => openEmployeeDialog());
  $('#newRequestBtn').addEventListener('click', openRequestDialog);
  $('#attendanceDate').addEventListener('change', () => loadAttendanceDate($('#attendanceDate').value));

  $('#shiftForm').addEventListener('submit', saveShift);
  $('#employeeForm').addEventListener('submit', saveEmployee);
  $('#requestForm').addEventListener('submit', saveRequest);
  $('#requestForm [name="request_type"]').addEventListener('change', updateRequestFormFields);
  $('#requestForm [name="target_employee_id"]').addEventListener('change', populateTargetShifts);

  $$('.close-dialog').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));

  $('#scheduleExport').addEventListener('click', handleScheduleClick);
  $('#employeesList').addEventListener('click', handleEmployeeClick);
  $('#requestsList').addEventListener('click', handleRequestClick);
  $('#attendanceList').addEventListener('click', handleAttendanceClick);
  $('#suggestionsList').addEventListener('click', handleSuggestionClick);
}

async function handleLogin(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  setBusy(button, true, 'מתחברת…');
  try {
    const form = new FormData(event.currentTarget);
    const phone = normalizePhone(form.get('phone'));
    const enteredPassword = String(form.get('password') || '');
    const password = enteredPassword === 'hadas' ? 'hadas1' : enteredPassword;
    const { data, error } = await state.client.auth.signInWithPassword({ phone, password });
    if (error) throw error;
    state.session = data.session;
    await enterApp();
  } catch (error) {
    showToast(authErrorMessage(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

function authErrorMessage(error) {
  const text = String(error?.message || '');
  if (/invalid login credentials/i.test(text)) return 'מספר הטלפון או הסיסמה שגויים';
  if (/phone provider is not enabled/i.test(text)) return 'יש להפעיל Phone provider בהגדרות Supabase Auth';
  return text || 'ההתחברות נכשלה';
}

async function enterApp() {
  setScreen('loadingScreen');
  const { data, error } = await state.client.from('hadas_profiles').select('*').eq('id', state.session.user.id).maybeSingle();
  if (error) throw error;
  if (!data || !data.active) {
    await state.client.auth.signOut();
    throw new Error('המשתמשת אינה פעילה במערכת');
  }
  state.profile = data;
  if (data.must_change_password) return setScreen('passwordScreen');

  setScreen('appShell');
  applyPermissions();
  $('#attendanceDate').value = dateISO(new Date());
  await refreshAll();
  subscribeRealtime();
}

async function handlePasswordChange(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const password = String(form.get('password') || '');
  const confirmPassword = String(form.get('confirmPassword') || '');
  if (password !== confirmPassword) return showToast('הסיסמאות אינן זהות', 'error');
  const button = event.currentTarget.querySelector('button');
  setBusy(button, true, 'שומרת…');
  try {
    const loginPhone = state.profile.phone;
    await apiFetch('/api/change-password', { method: 'POST', body: { password } });
    await state.client.auth.signOut({ scope: 'local' });
    const { data: loginData, error: loginError } = await state.client.auth.signInWithPassword({ phone: loginPhone, password });
    if (loginError) throw loginError;
    state.session = loginData.session;
    state.profile.must_change_password = false;
    event.currentTarget.reset();
    setScreen('appShell');
    applyPermissions();
    $('#attendanceDate').value = dateISO(new Date());
    await refreshAll();
    subscribeRealtime();
    showToast('הסיסמה נשמרה בהצלחה', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

async function logout() {
  if (state.realtimeChannel) await state.client.removeChannel(state.realtimeChannel);
  state.realtimeChannel = null;
  await state.client.auth.signOut();
  state.session = null;
  state.profile = null;
  setScreen('loginScreen');
}

function applyPermissions() {
  $$('.manager-only').forEach((element) => element.classList.toggle('hidden', !isManager()));
  $('#userName').textContent = state.profile.full_name;
  $('#userRole').textContent = `${ROLE_LABELS[state.profile.role] || state.profile.role} · ${state.profile.job_title}`;
  if (!isManager() && $('.nav-btn[data-tab="employees"]').classList.contains('active')) switchTab('dashboard');
}

function switchTab(tab) {
  $$('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  $$('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === `${tab}Panel`));
  if (tab === 'attendance') loadAttendanceDate($('#attendanceDate').value || dateISO(new Date()));
}

async function apiFetch(url, options = {}) {
  const { data } = await state.client.auth.getSession();
  state.session = data.session;
  if (!state.session) throw new Error('ההתחברות פגה. יש להתחבר מחדש');
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.session.access_token}`,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'הפעולה נכשלה');
  return result;
}

async function refreshAll() {
  try {
    await loadCoreData();
    await Promise.all([loadWeekData(), loadTodayData(), loadRequests(), loadAttendanceDate($('#attendanceDate').value || dateISO(new Date()))]);
    renderAll();
  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
  }
}

async function loadCoreData() {
  const queries = [
    state.client.from('hadas_classes').select('*').eq('active', true).order('sort_order'),
    state.client.from('hadas_profiles').select('*').order('full_name'),
    state.client.from('hadas_app_settings').select('*').eq('id', 1).maybeSingle(),
  ];
  if (isManager()) {
    queries.push(state.client.from('hadas_employee_class_constraints').select('*'));
    queries.push(state.client.from('hadas_employee_private').select('*'));
  }
  const results = await Promise.all(queries);
  for (const result of results) if (result.error) throw result.error;
  state.classes = results[0].data || [];
  state.profiles = results[1].data || [];
  state.settings = results[2].data || state.settings;
  state.constraints = isManager() ? (results[3].data || []) : [];
  state.privateRows = isManager() ? (results[4].data || []) : [];
}

async function loadWeekData() {
  const start = dateISO(state.weekStart);
  const end = dateISO(addDays(state.weekStart, 5));
  const [shiftResult, hadas_attendanceResult] = await Promise.all([
    state.client.from('hadas_shifts').select('*').gte('shift_date', start).lte('shift_date', end).order('shift_date').order('start_time'),
    state.client.from('hadas_attendance').select('*').gte('attendance_date', start).lte('attendance_date', end),
  ]);
  if (shiftResult.error) throw shiftResult.error;
  if (hadas_attendanceResult.error) throw hadas_attendanceResult.error;
  state.shifts = shiftResult.data || [];
  state.attendance = hadas_attendanceResult.data || [];
}

async function loadTodayData() {
  const today = dateISO(new Date());
  const { data, error } = await state.client.from('hadas_shifts').select('*').eq('shift_date', today).order('start_time');
  if (error) throw error;
  state.todayShifts = data || [];
}

async function loadRequests() {
  const { data, error } = await state.client.from('hadas_requests').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  state.requests = data || [];
}

async function loadAttendanceDate(date) {
  if (!state.client || !date) return;
  const [shiftResult, hadas_attendanceResult] = await Promise.all([
    state.client.from('hadas_shifts').select('*').eq('shift_date', date).order('start_time'),
    state.client.from('hadas_attendance').select('*').eq('attendance_date', date),
  ]);
  if (shiftResult.error) return showToast(shiftResult.error.message, 'error');
  if (hadas_attendanceResult.error) return showToast(hadas_attendanceResult.error.message, 'error');
  state.attendanceDateShifts = shiftResult.data || [];
  state.attendanceDateRows = hadas_attendanceResult.data || [];
  renderAttendance();
}

function subscribeRealtime() {
  if (state.realtimeChannel) state.client.removeChannel(state.realtimeChannel);
  const tables = ['hadas_profiles', 'hadas_shifts', 'hadas_attendance', 'hadas_requests', 'hadas_schedule_acknowledgements'];
  let channel = state.client.channel(`hadas-live-${state.profile.id}`);
  for (const table of tables) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleRealtimeReload);
  }
  state.realtimeChannel = channel.subscribe((status) => {
    const live = $('#liveStatus');
    if (status === 'SUBSCRIBED') {
      live.innerHTML = '<span></span> מתעדכן בזמן אמת';
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      live.textContent = 'החיבור לעדכונים בזמן אמת נותק';
    }
  });
}

function scheduleRealtimeReload() {
  clearTimeout(state.reloadTimer);
  state.reloadTimer = setTimeout(async () => {
    await refreshAll();
    showToast('המערכת התעדכנה', 'success');
  }, 450);
}

function renderAll() {
  renderDashboard();
  renderSchedule();
  renderEmployees();
  renderRequests();
  renderAttendance();
  populateCommonSelects();
}

function populateCommonSelects() {
  const classOptions = state.classes.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
  const profileOptions = state.profiles.filter((item) => item.active).map((item) => `<option value="${item.id}">${escapeHtml(item.full_name)} — ${escapeHtml(item.job_title)}</option>`).join('');
  $('#shiftForm [name="class_id"]').innerHTML = classOptions;
  $('#shiftForm [name="employee_id"]').innerHTML = profileOptions;
  $('#employeeForm [name="primary_class_id"]').innerHTML = `<option value="">ללא כיתה קבועה</option>${classOptions}`;
  $('#requestForm [name="target_employee_id"]').innerHTML = `<option value="">בחרי עובדת</option>${state.profiles.filter((item) => item.active && item.id !== state.profile.id).map((item) => `<option value="${item.id}">${escapeHtml(item.full_name)}</option>`).join('')}`;
}

function renderDashboard() {
  const today = dateISO(new Date());
  const myShifts = state.todayShifts.filter((shift) => shift.employee_id === state.profile.id);
  const staffedEmployees = new Set(state.todayShifts.map((shift) => shift.employee_id));
  const activeEmployees = state.profiles.filter((profile) => profile.active);
  const unassigned = activeEmployees.filter((profile) => !staffedEmployees.has(profile.id) && profile.fixed_day_off !== new Date().getDay() && !hasApprovedAbsence(profile.id, today));
  const classCards = state.classes.map((classItem) => {
    const hadas_shifts = state.todayShifts.filter((shift) => shift.class_id === classItem.id);
    const unique = new Set(hadas_shifts.map((shift) => shift.employee_id)).size;
    const closing = new Set(hadas_shifts.filter((shift) => timeToMinutes(shift.end_time) >= timeToMinutes(state.settings.closing_time)).map((shift) => shift.employee_id)).size;
    const hasLeader = hadas_shifts.some((shift) => ['teacher', 'lead'].includes(shift.shift_role));
    const ok = unique >= state.settings.required_staff && closing >= state.settings.closing_required_staff && hasLeader;
    return `
      <article class="class-card">
        <div class="card-heading"><h3>${escapeHtml(classItem.name)}</h3><span class="status-chip ${ok ? 'ok' : 'error'}">${ok ? 'תקין' : 'דורש טיפול'}</span></div>
        ${hadas_shifts.length ? hadas_shifts.map(shiftLineHtml).join('') : '<div class="empty-state">אין שיבוץ להיום</div>'}
        <p class="small-note">${unique} נשות צוות · ${closing} עד הסגירה · ${hasLeader ? 'יש גננת/מובילה' : 'חסרה גננת/מובילה'}</p>
      </article>`;
  }).join('');

  $('#dashboardPanel').innerHTML = `
    <div class="section-heading"><div><h2>שלום ${escapeHtml(state.profile.full_name)}</h2><p class="muted">${formatDate(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div></div>
    <div class="dashboard-grid">
      <article class="summary-card"><span class="caption">השיבוץ שלי היום</span><span class="metric">${myShifts.length || '—'}</span><small>${myShifts.length ? myShifts.map((s) => `${classById(s.class_id)?.name || ''} ${trimTime(s.start_time)}–${trimTime(s.end_time)}`).join(' · ') : 'לא קיים שיבוץ'}</small></article>
      <article class="summary-card"><span class="caption">עובדות משובצות היום</span><span class="metric">${staffedEmployees.size}</span><small>בכל כיתות המעון</small></article>
      <article class="summary-card"><span class="caption">בקשות ממתינות</span><span class="metric">${state.requests.filter((request) => request.status === 'pending').length}</span><small>בקשות שטרם טופלו</small></article>
      <article class="summary-card"><span class="caption">עובדות ללא שיבוץ</span><span class="metric">${unassigned.length}</span><small>${isManager() ? unassigned.slice(0, 4).map((p) => p.full_name).join(', ') || 'אין' : 'מוצג לאחראיות השיבוץ'}</small></article>
    </div>
    <div class="section-heading" style="margin-top:24px"><div><h2>מצב הכיתות היום</h2><p class="muted">כוח אדם לפי השיבוץ שפורסם.</p></div></div>
    <div class="dashboard-grid">${classCards}</div>
  `;
}

function shiftLineHtml(shift) {
  const profile = profileById(shift.employee_id);
  return `<div class="employee-line"><span><strong>${escapeHtml(profile?.full_name || 'עובדת')}</strong><small>${SHIFT_ROLE_LABELS[shift.shift_role]}${shift.public_note ? ` · ${escapeHtml(shift.public_note)}` : ''}</small></span><span>${trimTime(shift.start_time)}–${trimTime(shift.end_time)}</span></div>`;
}

function weekDates() {
  return Array.from({ length: 6 }, (_, index) => addDays(state.weekStart, index));
}

function validateSchedule() {
  const warnings = [];
  const cellStatus = new Map();
  for (const date of weekDates()) {
    const iso = dateISO(date);
    for (const classItem of state.classes) {
      const key = `${iso}:${classItem.id}`;
      const hadas_shifts = state.shifts.filter((shift) => shift.shift_date === iso && shift.class_id === classItem.id);
      const unique = new Set(hadas_shifts.map((shift) => shift.employee_id)).size;
      const closing = new Set(hadas_shifts.filter((shift) => timeToMinutes(shift.end_time) >= timeToMinutes(state.settings.closing_time)).map((shift) => shift.employee_id)).size;
      const hasLeader = hadas_shifts.some((shift) => ['teacher', 'lead'].includes(shift.shift_role));
      const problems = [];
      if (unique < Number(state.settings.required_staff)) problems.push(`רק ${unique} מתוך ${state.settings.required_staff} נשות צוות`);
      if (closing < Number(state.settings.closing_required_staff)) problems.push(`רק ${closing} נשות צוות נשארות עד ${trimTime(state.settings.closing_time)}`);
      if (!hasLeader) problems.push('אין גננת או מובילה');

      for (const shift of hadas_shifts) {
        const profile = profileById(shift.employee_id);
        if (profile?.fixed_day_off === date.getDay()) problems.push(`${profile.full_name} משובצת ביום החופשי הקבוע שלה`);
        const forbidden = activeConstraint(shift.employee_id, classItem.id, iso, 'forbidden');
        if (forbidden) problems.push(`${profile?.full_name || 'עובדת'} מוגבלת משיבוץ בכיתה`);
      }

      const severity = problems.length ? 'error' : 'ok';
      cellStatus.set(key, { severity, problems, unique, closing, hasLeader });
      for (const problem of problems) warnings.push({ severity: 'error', text: `${DAY_NAMES[date.getDay()]} ${formatDate(date, { day: '2-digit', month: '2-digit' })} · ${classItem.name}: ${problem}` });
    }
  }

  for (const profile of state.profiles.filter((item) => item.active && item.weekly_hours)) {
    const assignedMinutes = state.shifts.filter((shift) => shift.employee_id === profile.id).reduce((sum, shift) => sum + minutesBetween(shift.start_time, shift.end_time), 0);
    const assignedHours = assignedMinutes / 60;
    if (assignedHours > Number(profile.weekly_hours) + 0.25) {
      warnings.push({ severity: 'warning', text: `${profile.full_name} שובצה ${assignedHours.toFixed(1)} שעות לעומת ${profile.weekly_hours} שעות שבועיות.` });
    }
  }

  return { warnings, cellStatus };
}

function renderSchedule() {
  const dates = weekDates();
  const { warnings, cellStatus } = validateSchedule();
  $('#weekLabel').textContent = `${formatDate(dates[0])}–${formatDate(dates[5])}`;
  $('#scheduleWarnings').innerHTML = warnings.length
    ? warnings.map((warning) => `<div class="warning-row ${warning.severity}">${escapeHtml(warning.text)}</div>`).join('')
    : '<div class="notice success">לא נמצאו חריגות בסיסיות בשיבוץ השבועי.</div>';

  const header = dates.map((date) => `<th>${DAY_NAMES[date.getDay()]}<br><small>${formatDate(date, { day: '2-digit', month: '2-digit' })}</small></th>`).join('');
  const rows = state.classes.map((classItem) => {
    const cells = dates.map((date) => {
      const iso = dateISO(date);
      const hadas_shifts = state.shifts.filter((shift) => shift.class_id === classItem.id && shift.shift_date === iso);
      const status = cellStatus.get(`${iso}:${classItem.id}`);
      const hadas_shiftsHtml = hadas_shifts.map((shift) => {
        const profile = profileById(shift.employee_id);
        return `<article class="shift-item" data-shift-id="${shift.id}">
          ${isManager() ? `<button class="delete-shift" data-action="delete-shift" data-id="${shift.id}" aria-label="מחיקה">×</button>` : ''}
          <strong>${escapeHtml(profile?.full_name || 'עובדת לא מוכרת')}</strong>
          <small>${SHIFT_ROLE_LABELS[shift.shift_role]} · ${trimTime(shift.start_time)}–${trimTime(shift.end_time)}</small>
          <small><span class="status-chip ${shift.status}">${SHIFT_STATUS_LABELS[shift.status]}</span>${shift.public_note ? ` · ${escapeHtml(shift.public_note)}` : ''}</small>
          ${isManager() ? `<button class="mini-btn edit-shift-btn" data-action="edit-shift" data-id="${shift.id}">עריכה</button>` : ''}
        </article>`;
      }).join('');
      return `<td><div class="schedule-cell">
        <div class="card-heading"><span class="status-chip ${status?.severity === 'ok' ? 'ok' : 'error'}">${status?.unique || 0} צוות</span><small>${status?.closing || 0} עד סגירה</small></div>
        ${hadas_shiftsHtml || '<p class="muted">אין שיבוץ</p>'}
        ${isManager() ? `<div class="cell-footer"><button class="mini-btn" data-action="add-cell" data-date="${iso}" data-class-id="${classItem.id}">+ שיבוץ</button><button class="mini-btn" data-action="suggest" data-date="${iso}" data-class-id="${classItem.id}">הצעי מחליפה</button></div>` : ''}
      </div></td>`;
    }).join('');
    return `<tr><td class="class-name">${escapeHtml(classItem.name)}</td>${cells}</tr>`;
  }).join('');

  $('#scheduleExport').innerHTML = `<table class="schedule-table"><thead><tr><th class="class-name">כיתה</th>${header}</tr></thead><tbody>${rows}</tbody></table>`;
}

function activeConstraint(employeeId, classId, date, type = null) {
  return state.constraints.find((item) => {
    if (item.employee_id !== employeeId || item.class_id !== classId) return false;
    if (type && item.constraint_type !== type) return false;
    if (item.valid_from && date < item.valid_from) return false;
    if (item.valid_to && date > item.valid_to) return false;
    return true;
  });
}

async function handleScheduleClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'add-cell') openShiftDialog({ date: button.dataset.date, classId: button.dataset.classId });
  if (action === 'edit-shift') openShiftDialog({ shiftId: button.dataset.id });
  if (action === 'suggest') showSuggestions(button.dataset.date, button.dataset.classId);
  if (action === 'delete-shift') await deleteShift(button.dataset.id);
}

function openShiftDialog(prefill = {}) {
  if (!isManager()) return;
  populateCommonSelects();
  const form = $('#shiftForm');
  const existing = prefill.shiftId ? state.shifts.find((shift) => shift.id === prefill.shiftId) : null;
  form.reset();
  form.elements.id.value = existing?.id || '';
  form.elements.shift_date.value = existing?.shift_date || prefill.date || dateISO(state.weekStart);
  form.elements.class_id.value = existing?.class_id || prefill.classId || state.classes[0]?.id || '';
  form.elements.employee_id.value = existing?.employee_id || prefill.employeeId || state.profiles.find((p) => p.active)?.id || '';
  const selectedProfile = profileById(existing?.employee_id || prefill.employeeId);
  form.elements.start_time.value = trimTime(existing?.start_time) || prefill.startTime || trimTime(selectedProfile?.default_start) || '07:30';
  form.elements.end_time.value = trimTime(existing?.end_time) || prefill.endTime || trimTime(selectedProfile?.default_end) || '15:30';
  form.elements.shift_role.value = existing?.shift_role || prefill.role || 'staff';
  form.elements.status.value = existing?.status || 'draft';
  form.elements.public_note.value = existing?.public_note || '';
  $('#shiftFormWarning').classList.add('hidden');
  $('#shiftDialog .modal-heading h3').textContent = existing ? 'עריכת שיבוץ' : 'הוספת שיבוץ';
  $('#shiftDialog').showModal();
}

async function saveShift(event) {
  event.preventDefault();
  if (!isManager()) return;
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const profile = profileById(data.employee_id);
  const date = parseLocalDate(data.shift_date);
  const warnings = [];
  if (profile?.fixed_day_off === date.getDay()) warnings.push('זהו היום החופשי הקבוע של העובדת.');
  const constraint = activeConstraint(data.employee_id, data.class_id, data.shift_date);
  if (constraint?.constraint_type === 'forbidden') return showToast('לא ניתן לשבץ: קיימת הגבלה חוסמת לכיתה זו', 'error');
  if (constraint?.constraint_type === 'avoid') warnings.push('קיימת העדפה להימנע משיבוץ העובדת בכיתה זו.');
  if (warnings.length && !window.confirm(`${warnings.join('\n')}\nהאם לשמור בכל זאת?`)) return;

  const button = form.querySelector('button[value="default"]');
  setBusy(button, true);
  try {
    const payload = {
      shift_date: data.shift_date,
      class_id: data.class_id,
      employee_id: data.employee_id,
      start_time: data.start_time,
      end_time: data.end_time,
      shift_role: data.shift_role,
      status: data.status,
      public_note: data.public_note || null,
      created_by: state.profile.id,
    };
    const query = data.id ? state.client.from('hadas_shifts').update(payload).eq('id', data.id) : state.client.from('hadas_shifts').insert(payload);
    const { error } = await query;
    if (error) throw error;
    $('#shiftDialog').close();
    await loadWeekData();
    await loadTodayData();
    renderSchedule();
    renderDashboard();
    showToast('השיבוץ נשמר', 'success');
  } catch (error) {
    showToast(error.message.includes('חופפות') ? 'העובדת כבר משובצת בשעות חופפות' : error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

async function deleteShift(id) {
  if (!isManager() || !window.confirm('למחוק את השיבוץ?')) return;
  const { error } = await state.client.from('hadas_shifts').delete().eq('id', id);
  if (error) return showToast(error.message, 'error');
  await loadWeekData();
  await loadTodayData();
  renderSchedule();
  renderDashboard();
  showToast('השיבוץ נמחק', 'success');
}

async function publishWeek(status) {
  if (!isManager()) return;
  const { warnings } = validateSchedule();
  const blocking = warnings.filter((item) => item.severity === 'error');
  if (blocking.length && status === 'final') {
    return showToast(`לא ניתן לפרסם שיבוץ סופי לפני טיפול ב-${blocking.length} חריגות`, 'error');
  }
  const start = dateISO(state.weekStart);
  const end = dateISO(addDays(state.weekStart, 5));
  const { error } = await state.client.from('hadas_shifts').update({ status }).gte('shift_date', start).lte('shift_date', end);
  if (error) return showToast(error.message, 'error');
  await loadWeekData();
  renderSchedule();
  showToast(status === 'final' ? 'השיבוץ פורסם כסופי' : 'השיבוץ פורסם כזמני', 'success');
}

async function acknowledgeSchedule() {
  const weekStart = dateISO(state.weekStart);
  const { error } = await state.client.from('hadas_schedule_acknowledgements').upsert({ employee_id: state.profile.id, week_start: weekStart }, { onConflict: 'employee_id,week_start' });
  if (error) return showToast(error.message, 'error');
  showToast('אישור הקריאה נשמר', 'success');
}

async function downloadScheduleImage() {
  if (!window.html2canvas) return showToast('רכיב שמירת התמונה לא נטען', 'error');
  const button = $('#imageBtn');
  setBusy(button, true, 'מכין תמונה…');
  try {
    const canvas = await window.html2canvas($('#scheduleExport'), { scale: 2, backgroundColor: '#ffffff' });
    const link = document.createElement('a');
    link.download = `שיבוץ-מעון-הדס-${dateISO(state.weekStart)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

function changeWeek(days) {
  setWeek(addDays(state.weekStart, days));
}

async function setWeek(date) {
  state.weekStart = startOfWeek(date);
  await loadWeekData();
  renderSchedule();
  updateRequestShiftOptions();
}

function showSuggestions(date, classId) {
  const classShifts = state.shifts.filter((shift) => shift.shift_date === date && shift.class_id === classId);
  const needsLead = !classShifts.some((shift) => ['teacher', 'lead'].includes(shift.shift_role));
  const weeklyMinutes = new Map();
  for (const shift of state.shifts) weeklyMinutes.set(shift.employee_id, (weeklyMinutes.get(shift.employee_id) || 0) + minutesBetween(shift.start_time, shift.end_time));

  const candidates = state.profiles
    .filter((profile) => profile.active)
    .filter((profile) => profile.fixed_day_off !== parseLocalDate(date).getDay())
    .filter((profile) => !hasApprovedAbsence(profile.id, date))
    .filter((profile) => !activeConstraint(profile.id, classId, date, 'forbidden'))
    .filter((profile) => !state.shifts.some((shift) => shift.employee_id === profile.id && shift.shift_date === date && overlaps(shift.start_time, shift.end_time, state.settings.opening_time, state.settings.closing_time)))
    .map((profile) => {
      const constraint = activeConstraint(profile.id, classId, date);
      let score = 100;
      if (profile.primary_class_id === classId) score += 35;
      if (needsLead && profile.can_lead) score += 25;
      if (constraint?.constraint_type === 'preferred') score += 20;
      if (constraint?.constraint_type === 'avoid') score -= 30;
      score -= (weeklyMinutes.get(profile.id) || 0) / 120;
      return { profile, score, hours: (weeklyMinutes.get(profile.id) || 0) / 60, constraint };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  $('#suggestionsList').innerHTML = candidates.length ? candidates.map(({ profile, hours, constraint }) => `
    <article class="suggestion-card">
      <div class="card-heading"><div><h3>${escapeHtml(profile.full_name)}</h3><p class="muted">${escapeHtml(profile.job_title)} · ${hours.toFixed(1)} שעות השבוע</p></div>${profile.can_lead ? '<span class="role-chip">יכולה להוביל</span>' : ''}</div>
      <p>${profile.primary_class_id === classId ? 'משויכת בדרך כלל לכיתה זו.' : 'פנויה באותו יום.'}${constraint?.constraint_type === 'avoid' ? ' קיימת העדפה להימנע מהכיתה.' : ''}</p>
      <button class="primary-btn" data-action="use-suggestion" data-employee-id="${profile.id}" data-date="${date}" data-class-id="${classId}" data-role="${needsLead && profile.can_lead ? 'lead' : 'replacement'}">שבצי עובדת</button>
    </article>`).join('') : '<div class="empty-state">לא נמצאה עובדת פנויה שעומדת בתנאים.</div>';
  $('#suggestionsDialog').showModal();
}

function handleSuggestionClick(event) {
  const button = event.target.closest('[data-action="use-suggestion"]');
  if (!button) return;
  $('#suggestionsDialog').close();
  openShiftDialog({ date: button.dataset.date, classId: button.dataset.classId, employeeId: button.dataset.employeeId, role: button.dataset.role });
}

function renderEmployees() {
  if (!isManager()) return;
  const rows = state.profiles.map((profile) => {
    const classItem = classById(profile.primary_class_id);
    return `<tr class="${profile.active ? '' : 'inactive-row'}">
      <td><strong>${escapeHtml(profile.full_name)}</strong><br><small>${escapeHtml(profile.phone)}</small></td>
      <td>${escapeHtml(profile.job_title)}</td>
      <td>${escapeHtml(classItem?.name || 'ללא')}</td>
      <td>${ROLE_LABELS[profile.role] || profile.role}</td>
      <td>${profile.weekly_hours ?? '—'}</td>
      <td>${profile.fixed_day_off === null || profile.fixed_day_off === undefined ? 'משתנה' : DAY_NAMES[profile.fixed_day_off]}</td>
      <td><span class="status-chip ${profile.active ? 'ok' : 'error'}">${profile.active ? 'פעילה' : 'מושבתת'}</span></td>
      <td><div class="row-actions">
        <button class="mini-btn" data-action="edit-employee" data-id="${profile.id}">עריכה</button>
        <button class="mini-btn" data-action="reset-password" data-id="${profile.id}">איפוס סיסמה</button>
        ${profile.active ? `<button class="mini-btn" data-action="deactivate-employee" data-id="${profile.id}">השבתה</button>` : `<button class="mini-btn" data-action="activate-employee" data-id="${profile.id}">הפעלה</button>`}
      </div></td>
    </tr>`;
  }).join('');
  $('#employeesList').innerHTML = `<table class="data-table"><thead><tr><th>עובדת</th><th>תפקיד</th><th>כיתה</th><th>הרשאה</th><th>שעות שבועיות</th><th>יום חופשי</th><th>מצב</th><th>פעולות</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderConstraintFields(employeeId = null) {
  $('#constraintsFields').innerHTML = state.classes.map((classItem) => {
    const constraint = state.constraints.find((item) => item.employee_id === employeeId && item.class_id === classItem.id);
    return `<div class="constraint-row" data-class-id="${classItem.id}">
      <label>כיתה<input value="${escapeHtml(classItem.name)}" disabled /></label>
      <label>סוג<select class="constraint-type"><option value="">ללא</option><option value="preferred" ${constraint?.constraint_type === 'preferred' ? 'selected' : ''}>עדיפות</option><option value="avoid" ${constraint?.constraint_type === 'avoid' ? 'selected' : ''}>עדיף להימנע</option><option value="forbidden" ${constraint?.constraint_type === 'forbidden' ? 'selected' : ''}>אסור לשבץ</option></select></label>
      <label>מתאריך<input class="constraint-from" type="date" value="${constraint?.valid_from || ''}" /></label>
      <label>עד תאריך<input class="constraint-to" type="date" value="${constraint?.valid_to || ''}" /></label>
      <label class="constraint-reason">סיבה<input class="constraint-reason-input" value="${escapeHtml(constraint?.reason || '')}" /></label>
    </div>`;
  }).join('');
}

function openEmployeeDialog(id = null) {
  if (!isManager()) return;
  populateCommonSelects();
  const form = $('#employeeForm');
  form.reset();
  const profile = id ? profileById(id) : null;
  form.elements.id.value = profile?.id || '';
  form.elements.full_name.value = profile?.full_name || '';
  form.elements.phone.value = profile?.phone || '';
  form.elements.job_title.value = profile?.job_title || 'אשת צוות';
  form.elements.role.value = profile?.role || 'employee';
  form.elements.primary_class_id.value = profile?.primary_class_id || '';
  form.elements.can_lead.value = String(Boolean(profile?.can_lead));
  form.elements.weekly_hours.value = profile?.weekly_hours ?? '';
  form.elements.fixed_day_off.value = profile?.fixed_day_off ?? '';
  form.elements.default_start.value = trimTime(profile?.default_start) || '07:30';
  form.elements.default_end.value = trimTime(profile?.default_end) || '15:30';
  form.elements.admin_notes.value = state.privateRows.find((row) => row.employee_id === id)?.admin_notes || '';
  renderConstraintFields(id);
  $('#employeeDialog').showModal();
}

function collectConstraints() {
  return $$('.constraint-row', $('#constraintsFields')).map((row) => ({
    class_id: row.dataset.classId,
    constraint_type: $('.constraint-type', row).value,
    valid_from: $('.constraint-from', row).value || null,
    valid_to: $('.constraint-to', row).value || null,
    reason: $('.constraint-reason-input', row).value || null,
  })).filter((item) => item.constraint_type);
}

async function saveEmployee(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const body = {
    id: data.id || undefined,
    full_name: data.full_name,
    phone: data.phone,
    job_title: data.job_title,
    role: data.role,
    primary_class_id: data.primary_class_id || null,
    can_lead: data.can_lead === 'true',
    weekly_hours: data.weekly_hours ? Number(data.weekly_hours) : null,
    fixed_day_off: data.fixed_day_off === '' ? null : Number(data.fixed_day_off),
    default_start: data.default_start,
    default_end: data.default_end,
    admin_notes: data.admin_notes,
    constraints: collectConstraints(),
  };
  const button = form.querySelector('button[value="default"]');
  setBusy(button, true);
  try {
    await apiFetch('/api/employees', { method: data.id ? 'PATCH' : 'POST', body });
    $('#employeeDialog').close();
    await loadCoreData();
    renderEmployees();
    populateCommonSelects();
    showToast(data.id ? 'פרטי העובדת עודכנו' : 'העובדת נוספה עם הסיסמה הראשונית hadas', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

async function handleEmployeeClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = button.dataset.id;
  const action = button.dataset.action;
  if (action === 'edit-employee') return openEmployeeDialog(id);
  try {
    if (action === 'reset-password') {
      if (!window.confirm('לאפס את הסיסמה של העובדת ל-hadas?')) return;
      await apiFetch('/api/employees', { method: 'PATCH', body: { id, reset_password: true } });
      return showToast('הסיסמה אופסה ל-hadas', 'success');
    }
    if (action === 'deactivate-employee') {
      if (!window.confirm('להשבית את העובדת? היסטוריית השיבוצים תישמר.')) return;
      await apiFetch('/api/employees', { method: 'DELETE', body: { id } });
    }
    if (action === 'activate-employee') {
      await apiFetch('/api/employees', { method: 'PATCH', body: { id, active: true } });
    }
    await loadCoreData();
    renderEmployees();
    showToast('מצב העובדת עודכן', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function openRequestDialog() {
  const form = $('#requestForm');
  form.reset();
  form.elements.request_date.value = dateISO(new Date());
  updateRequestShiftOptions();
  updateRequestFormFields();
  $('#requestDialog').showModal();
}

function updateRequestFormFields() {
  const type = $('#requestForm [name="request_type"]').value;
  $$('.request-time').forEach((element) => element.classList.add('hidden'));
  $$('.swap-field').forEach((element) => element.classList.toggle('hidden', type !== 'swap'));
  if (type === 'late_start') $('.start-field').classList.remove('hidden');
  if (type === 'early_finish') $('.end-field').classList.remove('hidden');
}

function updateRequestShiftOptions() {
  const myShifts = state.shifts.filter((shift) => shift.employee_id === state.profile?.id);
  $('#requestForm [name="shift_id"]').innerHTML = `<option value="">בחרי שיבוץ</option>${myShifts.map((shift) => `<option value="${shift.id}">${formatDate(shift.shift_date)} · ${escapeHtml(classById(shift.class_id)?.name || '')} · ${trimTime(shift.start_time)}–${trimTime(shift.end_time)}</option>`).join('')}`;
  populateTargetShifts();
}

function populateTargetShifts() {
  const targetId = $('#requestForm [name="target_employee_id"]').value;
  const hadas_shifts = state.shifts.filter((shift) => shift.employee_id === targetId);
  $('#requestForm [name="target_shift_id"]').innerHTML = `<option value="">בחרי שיבוץ</option>${hadas_shifts.map((shift) => `<option value="${shift.id}">${formatDate(shift.shift_date)} · ${escapeHtml(classById(shift.class_id)?.name || '')} · ${trimTime(shift.start_time)}–${trimTime(shift.end_time)}</option>`).join('')}`;
}

async function saveRequest(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  if (data.request_type === 'swap' && (!data.shift_id || !data.target_employee_id || !data.target_shift_id)) {
    return showToast('יש לבחור את שני השיבוצים ואת העובדת השנייה', 'error');
  }
  const payload = {
    requester_id: state.profile.id,
    request_type: data.request_type,
    request_date: data.request_date,
    requested_start: data.requested_start || null,
    requested_end: data.requested_end || null,
    shift_id: data.shift_id || null,
    target_employee_id: data.target_employee_id || null,
    target_shift_id: data.target_shift_id || null,
    reason: data.reason || null,
  };
  const button = form.querySelector('button[value="default"]');
  setBusy(button, true, 'שולחת…');
  try {
    const { error } = await state.client.from('hadas_requests').insert(payload);
    if (error) throw error;
    $('#requestDialog').close();
    await loadRequests();
    renderRequests();
    showToast('הבקשה נשלחה', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

function renderRequests() {
  $('#requestsList').innerHTML = state.requests.length ? state.requests.map((request) => {
    const requester = profileById(request.requester_id);
    const target = profileById(request.target_employee_id);
    const canTargetAccept = request.request_type === 'swap' && request.target_employee_id === state.profile.id && !request.target_approved && request.status === 'pending';
    const canCancel = request.requester_id === state.profile.id && request.status === 'pending';
    return `<article class="request-card">
      <div class="card-heading"><div><h3>${REQUEST_LABELS[request.request_type]}</h3><p class="muted">${escapeHtml(requester?.full_name || '')} · ${formatDate(request.request_date)}</p></div><span class="status-chip ${request.status === 'rejected' ? 'error' : request.status === 'applied' ? 'ok' : 'warn'}">${REQUEST_STATUS_LABELS[request.status]}</span></div>
      <div class="meta-grid">
        <div class="meta-item"><small>פירוט</small>${escapeHtml(request.reason || 'ללא פירוט')}</div>
        <div class="meta-item"><small>שעות מבוקשות</small>${request.requested_start || request.requested_end ? `${trimTime(request.requested_start) || '—'}–${trimTime(request.requested_end) || '—'}` : 'לא רלוונטי'}</div>
        <div class="meta-item"><small>החלפה עם</small>${escapeHtml(target?.full_name || 'לא רלוונטי')}${request.request_type === 'swap' ? ` · ${request.target_approved ? 'אישרה' : 'טרם אישרה'}` : ''}</div>
      </div>
      ${request.manager_note ? `<p><strong>הערת מנהלת:</strong> ${escapeHtml(request.manager_note)}</p>` : ''}
      <div class="card-actions">
        ${canTargetAccept ? `<button class="secondary-btn" data-action="target-accept" data-id="${request.id}">אני מסכימה להחלפה</button>` : ''}
        ${canCancel ? `<button class="ghost-btn" data-action="cancel-request" data-id="${request.id}">ביטול בקשה</button>` : ''}
        ${isManager() && request.status === 'pending' ? `<button class="primary-btn" data-action="approve-request" data-id="${request.id}">אישור</button><button class="danger-btn" data-action="reject-request" data-id="${request.id}">דחייה</button>` : ''}
        ${isManager() && request.status === 'approved' ? `<button class="primary-btn" data-action="apply-request" data-id="${request.id}">הזרמה לשיבוץ</button>` : ''}
      </div>
    </article>`;
  }).join('') : '<div class="empty-state">אין בקשות להצגה.</div>';
}

async function handleRequestClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = button.dataset.id;
  const action = button.dataset.action;
  try {
    if (action === 'cancel-request') {
      await apiFetch('/api/requests', { method: 'POST', body: { id, action: 'cancel' } });
    } else if (action === 'target-accept') {
      await apiFetch('/api/requests', { method: 'POST', body: { id, action: 'target_accept' } });
    } else if (action === 'approve-request' || action === 'reject-request') {
      const status = action === 'approve-request' ? 'approved' : 'rejected';
      const managerNote = window.prompt('הערה לעובדת (אפשר להשאיר ריק):') || '';
      await apiFetch('/api/requests', { method: 'POST', body: { id, action: 'decide', status, manager_note: managerNote } });
    } else if (action === 'apply-request') {
      if (!window.confirm('להזרים את הבקשה לשיבוץ בפועל?')) return;
      await apiFetch('/api/requests', { method: 'POST', body: { id, action: 'apply' } });
    }
    await Promise.all([loadRequests(), loadWeekData(), loadTodayData()]);
    renderRequests();
    renderSchedule();
    renderDashboard();
    showToast('הבקשה עודכנה', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderAttendance() {
  const date = $('#attendanceDate').value || dateISO(new Date());
  const hadas_shifts = isManager()
    ? state.attendanceDateShifts
    : state.attendanceDateShifts.filter((shift) => shift.employee_id === state.profile.id);
  $('#attendanceList').innerHTML = hadas_shifts.length ? hadas_shifts.map((shift) => {
    const profile = profileById(shift.employee_id);
    const classItem = classById(shift.class_id);
    const row = state.attendanceDateRows.find((item) => item.shift_id === shift.id);
    return `<article class="attendance-card" data-shift-id="${shift.id}">
      <div class="card-heading"><div><h3>${escapeHtml(profile?.full_name || '')}</h3><p class="muted">${escapeHtml(classItem?.name || '')} · מתוכנן ${trimTime(shift.start_time)}–${trimTime(shift.end_time)}</p></div><span class="role-chip">${SHIFT_ROLE_LABELS[shift.shift_role]}</span></div>
      ${isManager() ? `<div class="form-grid">
        <label>מצב<select class="attendance-status">${Object.entries(ATTENDANCE_LABELS).map(([value, label]) => `<option value="${value}" ${row?.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label>התחלה בפועל<input class="attendance-start" type="time" value="${trimTime(row?.actual_start) || trimTime(shift.start_time)}" /></label>
        <label>סיום בפועל<input class="attendance-end" type="time" value="${trimTime(row?.actual_end) || trimTime(shift.end_time)}" /></label>
        <label>הערה<input class="attendance-note" value="${escapeHtml(row?.note || '')}" /></label>
      </div><button class="primary-btn" data-action="save-attendance" data-shift-id="${shift.id}">שמירה</button>` : `<div class="meta-grid"><div class="meta-item"><small>מצב</small>${ATTENDANCE_LABELS[row?.status || 'scheduled']}</div><div class="meta-item"><small>בפועל</small>${trimTime(row?.actual_start) || '—'}–${trimTime(row?.actual_end) || '—'}</div><div class="meta-item"><small>הערה</small>${escapeHtml(row?.note || 'ללא')}</div></div>`}
    </article>`;
  }).join('') : `<div class="empty-state">אין שיבוצים בתאריך ${formatDate(date)}.</div>`;
}

async function handleAttendanceClick(event) {
  const button = event.target.closest('[data-action="save-attendance"]');
  if (!button || !isManager()) return;
  const card = button.closest('.attendance-card');
  const shift = state.attendanceDateShifts.find((item) => item.id === button.dataset.shiftId);
  const payload = {
    shift_id: shift.id,
    employee_id: shift.employee_id,
    attendance_date: shift.shift_date,
    status: $('.attendance-status', card).value,
    actual_start: $('.attendance-start', card).value || null,
    actual_end: $('.attendance-end', card).value || null,
    note: $('.attendance-note', card).value || null,
    updated_by: state.profile.id,
  };
  setBusy(button, true);
  const { error } = await state.client.from('hadas_attendance').upsert(payload, { onConflict: 'shift_id' });
  setBusy(button, false);
  if (error) return showToast(error.message, 'error');
  await loadAttendanceDate(shift.shift_date);
  showToast('הנוכחות נשמרה', 'success');
}

init();
