/* מערכת ניהול שיבוצים מעון הדס — הרשאות וחוויית משתמש 0.33.1 */
(() => {
  const VERSION = '0.33.1';
  const PREVIOUS = '/patch-v032.js?v=0321';

  function pinVersion() {
    window.__HADAS_RELEASE_VERSION = VERSION;
    document.documentElement.dataset.hadasVersion = VERSION;
    const badge = document.querySelector('#appVersionBadge');
    const login = document.querySelector('#loginVersion');
    if (badge) {
      badge.textContent = 'v' + VERSION;
      badge.title = 'גרסת מערכת ' + VERSION;
    }
    if (login) login.textContent = 'גרסה ' + VERSION;
  }

  function installVersionGuard() {
    for (const key of ['__hadasV031VersionObservers', '__hadasV032VersionObservers', '__hadasV033VersionObservers']) {
      (window[key] || []).forEach((observer) => {
        try { observer?.disconnect(); } catch {}
      });
      window[key] = [];
    }
    const observers = [];
    for (const [node, text] of [
      [document.querySelector('#appVersionBadge'), 'v' + VERSION],
      [document.querySelector('#loginVersion'), 'גרסה ' + VERSION],
    ]) {
      if (!node) continue;
      const observer = new MutationObserver(() => {
        if (node.textContent !== text) node.textContent = text;
      });
      observer.observe(node, { subtree:true, childList:true, characterData:true });
      observers.push(observer);
    }
    window.__hadasV033VersionObservers = observers;
    pinVersion();
  }

  function loadPrevious() {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-hadas-v033="previous"]');
      if (existing) {
        if (existing.dataset.loaded === 'true') return resolve();
        existing.addEventListener('load', resolve, { once:true });
        existing.addEventListener('error', reject, { once:true });
        return;
      }
      const script = document.createElement('script');
      script.src = PREVIOUS;
      script.async = false;
      script.dataset.hadasV033 = 'previous';
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once:true });
      script.addEventListener('error', () => reject(new Error('לא ניתן לטעון את ממשק 0.32.1')), { once:true });
      document.head.append(script);
    });
  }

  function releaseBootstrap() {
    if (window.__hadasCurrentBootstrapReady) return;
    window.__hadasCurrentBootstrapReady = true;
    window.dispatchEvent(new CustomEvent('hadas:bootstrap-ready', { detail:{ version:VERSION } }));
  }

  function roleKind() {
    if (!state || !state.profile) return 'guest';
    if (isManager()) return 'manager';
    const title = String(state.profile.job_title || '').trim();
    if (/גנ(?:נ|ן)/.test(title)) return 'teacher';
    if (state.profile.schedule_scope === 'class' || /סייעת\s+מובילה/.test(title)) return 'lead';
    if (state.profile.schedule_scope === 'full' || state.profile.can_view_full_schedule) return 'full';
    return 'regular';
  }

  function setHidden(target, hidden) {
    const element = typeof target === 'string' ? document.querySelector(target) : target;
    if (element) element.classList.toggle('hidden', Boolean(hidden));
  }

  function ownWeekRows() {
    if (!state.profile) return [];
    return (state.shifts || []).filter((row) => row.employee_id === state.profile.id);
  }

  function personalWeekMarkup(rows, compact) {
    const dates = Array.from({ length:6 }, (_, index) => addDays(state.weekStart, index));
    const cards = dates.map((date) => {
      const iso = dateISO(date);
      const dayRows = sortScheduleRows(rows.filter((row) => row.shift_date === iso));
      const shifts = dayRows.length
        ? dayRows.map((row) => {
            const className = classById(row.class_id)?.name || 'ללא כיתה';
            const role = SHIFT_ROLE_LABELS[row.shift_role] || 'צוות';
            return '<div class="v033-personal-shift"><strong>' + escapeHtml(className) + '</strong><b>' + trimTime(row.start_time) + '–' + trimTime(row.end_time) + '</b><small>' + escapeHtml(role) + '</small></div>';
          }).join('')
        : '<div class="v033-personal-empty">אין שיבוץ</div>';
      return '<article class="v033-personal-day"><header><strong>' + escapeHtml(DAY_NAMES[date.getDay()]) + '</strong><span>' + escapeHtml(formatDate(iso, { day:'numeric', month:'numeric' })) + '</span></header>' + shifts + '</article>';
    }).join('');
    return '<div class="v033-week-scroll-shell"><div class="v033-week-swipe-hint"><span>השבוע מוצג לרוחב · החליקו לצדדים</span><span class="v033-week-scroll-actions"><button type="button" data-v033-week-scroll="right" aria-label="הצגת הימים הקודמים">›</button><button type="button" data-v033-week-scroll="left" aria-label="הצגת הימים הבאים">‹</button></span></div><div class="v033-personal-week ' + (compact ? 'compact' : '') + '" role="region" tabindex="0" aria-label="השיבוץ האישי השבועי, ניתן לגלול לרוחב">' + cards + '</div></div>';
  }

  function renderRegularHorizontalSchedule() {
    const target = document.querySelector('#scheduleExport');
    if (!target || roleKind() !== 'regular') return;
    const rows = ownWeekRows();
    const renderKey = dateISO(state.weekStart) + ':' + rows.map((row) => [row.id, row.shift_date, row.start_time, row.end_time, row.class_id].join('-')).join('|');
    if (target.dataset.v033PersonalKey === renderKey && target.querySelector('.v033-personal-week')) return;
    target.className = 'schedule-wrap v033-personal-schedule-wrap';
    target.dataset.v033PersonalKey = renderKey;
    target.innerHTML = personalWeekMarkup(rows, false);
  }

  function enhanceDashboard() {
    const panel = document.querySelector('#dashboardPanel');
    if (!panel || roleKind() === 'manager' || roleKind() === 'guest') return;
    const taskShortcut = panel.querySelector('[data-dashboard-tab="tasks"]');
    if (taskShortcut) {
      taskShortcut.dataset.dashboardTab = 'calendar';
      const icon = taskShortcut.querySelector('span');
      const title = taskShortcut.querySelector('strong');
      const note = taskShortcut.querySelector('small');
      if (icon) icon.textContent = '◫';
      if (title) title.textContent = 'לוח השנה שלי';
      if (note) note.textContent = 'אירועים פרטיים ואירועי כיתה';
    }
    panel.querySelectorAll('.dashboard-section,.class-grid').forEach((element) => element.remove());
    panel.querySelector('#v033DashboardWeek')?.remove();
    const section = document.createElement('section');
    section.id = 'v033DashboardWeek';
    section.className = 'v033-dashboard-week';
    section.innerHTML = '<div class="section-heading dashboard-section"><div><p class="eyebrow">השבוע שלי</p><h2>השיבוץ האישי שלי</h2><p class="muted">רק השיבוצים שלך מוצגים במסך הראשי.</p></div></div>' + personalWeekMarkup(ownWeekRows(), true);
    panel.append(section);
  }

  function applyRoleUi() {
    if (!state?.profile) return;
    const kind = roleKind();
    const fullViewer = kind === 'manager' || kind === 'teacher' || kind === 'full';

    document.documentElement.dataset.hadasRole = kind;
    document.documentElement.dataset.hadasCanCreate = canCreateContent() ? 'true' : 'false';

    document.querySelectorAll('[data-tab="tasks"],[data-more-tab="tasks"],#tasksPanel,#taskDialog,#newTaskBtn').forEach((element) => element.classList.add('hidden'));
    setHidden('#newCalendarBtn', false);
    document.querySelector('#newCalendarBtn')?.classList.remove('content-creator-only');

    setHidden('#schedulePublicationState', kind !== 'manager');
    setHidden('#scheduleAbsences', !fullViewer);
    setHidden('#scheduleMode', kind === 'regular');
    setHidden('#scheduleDayField', kind === 'regular');
    setHidden('#v028ScheduleEmployeeSearch', kind === 'regular');
    setHidden('#publishScheduleBtn', kind !== 'manager');
    setHidden('#scheduleIssuesToggle', kind !== 'manager');
    setHidden('#scheduleMode [data-mode="mine"]', kind === 'lead');
    setHidden('#printBtn', kind === 'regular' || kind === 'lead');
    setHidden('#imageBtn', kind === 'regular');
    setHidden('#monthImageBtn', kind === 'regular' || kind === 'lead');
    setHidden('#v031PrintBtn', kind === 'regular');
    setHidden('#v027AbsencePdfBtn', !fullViewer);

    const tools = document.querySelector('.schedule-tools-menu');
    if (tools) {
      const visible = kind !== 'regular';
      tools.classList.toggle('hidden', !visible);
      if (visible) tools.open = true;
    }
    if (kind === 'regular') {
      state.scheduleMode = 'mine';
      renderRegularHorizontalSchedule();
    } else if (kind === 'lead' && state.scheduleMode === 'mine') {
      state.scheduleMode = 'week';
    }
    pinVersion();
    if (kind === 'lead') installLeadExports();
    installScheduleAcknowledgementViewer();
  }

  function scheduleAcknowledgementRecipients() {
    const ids = new Set((state.shifts || []).map((row) => row.employee_id).filter(Boolean));
    return (state.employees || []).filter((employee) => ids.has(employee.id) && employee.active !== false && !['admin', 'scheduler'].includes(employee.role));
  }

  function ensureScheduleAcknowledgementDialog() {
    let dialog = document.querySelector('#v033ScheduleAckDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'v033ScheduleAckDialog';
    dialog.className = 'modal v033-schedule-ack-dialog';
    dialog.innerHTML = '<section class="modal-card"><div class="modal-heading"><div><p class="eyebrow">מעקב קריאת שיבוץ</p><h3 id="v033ScheduleAckTitle">אישורי קריאה</h3><p id="v033ScheduleAckSummary" class="muted"></p></div><button type="button" class="icon-btn close-dialog" aria-label="סגירה">×</button></div><div id="v033ScheduleAckList" class="v033-schedule-ack-list"></div><div class="modal-actions"><button type="button" class="ghost-btn close-dialog">סגירה</button></div></section>';
    document.body.append(dialog);
    dialog.querySelectorAll('.close-dialog').forEach((button) => button.addEventListener('click', () => dialog.close()));
    return dialog;
  }

  function openScheduleAcknowledgementViewer() {
    if (!isManager()) return;
    const dialog = ensureScheduleAcknowledgementDialog();
    const recipients = scheduleAcknowledgementRecipients();
    const acknowledgements = new Map((state.acknowledgements || []).map((row) => [row.employee_id, row]));
    const acknowledgedCount = recipients.filter((employee) => acknowledgements.has(employee.id)).length;
    const weekText = formatDate(state.weekStart, { day:'2-digit', month:'2-digit', year:'numeric' }) + '–' + formatDate(addDays(state.weekStart, 5), { day:'2-digit', month:'2-digit', year:'numeric' });
    const revisionText = state.publication?.revision ? ' · גרסת פרסום ' + state.publication.revision : '';
    document.querySelector('#v033ScheduleAckTitle').textContent = 'אישורי קריאה · ' + weekText;
    document.querySelector('#v033ScheduleAckSummary').textContent = acknowledgedCount + ' מתוך ' + recipients.length + ' עובדים משובצים אישרו' + revisionText;
    document.querySelector('#v033ScheduleAckList').innerHTML = recipients.length
      ? recipients.map((employee) => {
          const row = acknowledgements.get(employee.id);
          const status = row?.acknowledged_at
            ? 'אושר ב־' + formatDate(row.acknowledged_at, { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
            : 'טרם אושר';
          return '<article class="tracking-row ' + (row ? 'done' : 'pending') + '"><span class="employee-avatar small">' + escapeHtml(initials(employee.full_name)) + '</span><div><strong>' + escapeHtml(employee.full_name || '') + '</strong><small>' + escapeHtml(status) + '<br>שיבוץ שבוע ' + escapeHtml(weekText) + escapeHtml(revisionText) + '</small></div><b>' + (row ? '✓' : '…') + '</b></article>';
        }).join('')
      : '<div class="empty-state">אין עובדים משובצים בשבוע הזה.</div>';
    dialog.showModal();
  }

  function installScheduleAcknowledgementViewer() {
    const health = document.querySelector('.schedule-health-row');
    if (!health) return;
    let button = document.querySelector('#v033ScheduleAckViewerBtn');
    if (!button) {
      button = document.createElement('button');
      button.id = 'v033ScheduleAckViewerBtn';
      button.type = 'button';
      button.className = 'secondary-btn';
      button.addEventListener('click', openScheduleAcknowledgementViewer);
      health.prepend(button);
    }
    const recipients = scheduleAcknowledgementRecipients();
    const acknowledged = new Set((state.acknowledgements || []).map((row) => row.employee_id));
    const count = recipients.filter((employee) => acknowledged.has(employee.id)).length;
    const label = 'אישורי קריאה · ' + count + '/' + recipients.length;
    if (button.textContent !== label) button.textContent = label;
    button.classList.toggle('hidden', !isManager());
  }

  function configureCalendarVisibility(selected) {
    const form = document.querySelector('#calendarForm');
    if (!form) return;
    const select = form.elements.visibility;
    const classSelect = form.elements.class_id;
    const kind = roleKind();
    let options;
    if (kind === 'manager') {
      options = [
        ['all', 'כל העובדים'],
        ['class', 'כיתה'],
        ['managers', 'הנהלה בלבד'],
        ['private', 'פרטי — רק אני'],
      ];
    } else if (kind === 'lead' || kind === 'teacher') {
      options = [
        ['private', 'פרטי — רק אני'],
        ['class', 'הכיתה שלי'],
      ];
    } else {
      options = [['private', 'פרטי — רק אני']];
    }
    select.innerHTML = options.map((entry) => '<option value="' + entry[0] + '">' + entry[1] + '</option>').join('');
    const wanted = options.some((entry) => entry[0] === selected) ? selected : options[0][0];
    select.value = wanted;
    if (kind !== 'manager' && classSelect) {
      const classItem = classById(state.profile.primary_class_id);
      classSelect.innerHTML = classItem ? '<option value="' + classItem.id + '">' + escapeHtml(classItem.name) + '</option>' : '<option value="">לא הוגדרה כיתה</option>';
      classSelect.value = state.profile.primary_class_id || '';
    }
    syncCalendarVisibility();
  }

  function visibilityText(item) {
    if (item.source === 'approved_leave') return 'חופשה מאושרת ממערכת הבקשות';
    if (item.visibility === 'private') return 'פרטי — רק אני';
    if (item.visibility === 'all') return 'כל העובדים';
    if (item.visibility === 'managers') return 'הנהלה בלבד';
    return 'כיתת ' + (classById(item.class_id)?.name || '');
  }

  function calendarTypeClass(item) {
    const type = String(item?.event_type || 'other');
    if (item?.source === 'approved_leave' || type === 'approved_leave') return 'approved_leave';
    if (item?.is_general_day_off || type === 'general_day_off') return 'holiday general_day_off';
    return ['meeting', 'training', 'holiday', 'birthday', 'activity', 'other'].includes(type) ? type : 'other';
  }

  function mobileCalendarMarkup(monthEvents) {
    if (!monthEvents.length) return '<div class="v033-calendar-empty"><span>◫</span><strong>אין אירועים בחודש הזה</strong><small>אפשר ליצור אירוע חדש מהכפתור למעלה.</small></div>';
    const grouped = new Map();
    for (const item of monthEvents) {
      if (!grouped.has(item.event_date)) grouped.set(item.event_date, []);
      grouped.get(item.event_date).push(item);
    }
    return '<div class="v033-calendar-mobile-list" aria-label="אירועי לוח השנה">' + [...grouped.entries()].map(([date, items]) => {
      const day = parseDateValue(date);
      const cards = items.map((item) => {
        const classes = calendarTypeClass(item);
        const time = item.start_time ? trimTime(item.start_time) + (item.end_time ? '–' + trimTime(item.end_time) : '') : 'כל היום';
        return '<button type="button" class="v033-mobile-calendar-event ' + escapeHtml(classes) + '" data-event-id="' + escapeHtml(item.id) + '"><span class="v033-event-icon">' + calendarEventIcon(item) + '</span><span><strong>' + escapeHtml(item.title || calendarEventLabel(item)) + '</strong><small>' + escapeHtml(calendarEventLabel(item)) + ' · ' + escapeHtml(time) + '</small></span><i aria-hidden="true">‹</i></button>';
      }).join('');
      return '<section class="v033-calendar-date-group"><header><span>' + day.getDate() + '</span><div><strong>' + escapeHtml(DAY_NAMES[day.getDay()]) + '</strong><small>' + escapeHtml(formatDate(date, { day:'numeric', month:'long' })) + '</small></div><button type="button" data-calendar-date="' + escapeHtml(date) + '" aria-label="הוספת אירוע בתאריך ' + escapeHtml(formatDate(date)) + '">＋</button></header><div>' + cards + '</div></section>';
    }).join('') + '</div>';
  }

  function renderCalendarV033() {
    const label = document.querySelector('#calendarMonthLabel');
    if (label) label.textContent = formatDate(state.calendarMonth, { month:'long', year:'numeric' });
    const monthPrefix = monthParam(state.calendarMonth);
    const monthEvents = (state.calendarEvents || []).filter((item) => String(item.event_date || '').startsWith(monthPrefix)).sort((a, b) => String(a.event_date + '-' + (a.start_time || '')).localeCompare(String(b.event_date + '-' + (b.start_time || ''))));
    const grid = document.querySelector('#calendarGrid');
    if (!grid) return;
    if (matchMedia('(max-width:760px)').matches) {
      grid.classList.add('v033-calendar-list-shell');
      grid.innerHTML = mobileCalendarMarkup(monthEvents);
      return;
    }
    grid.classList.remove('v033-calendar-list-shell');
    const weekdays = DAY_NAMES.map((name) => '<div class="calendar-weekday">' + escapeHtml(name) + '</div>').join('');
    const today = dateISO(new Date());
    const cells = calendarCells().map((date) => {
      const iso = dateISO(date);
      const events = state.calendarEvents.filter((item) => item.event_date === iso);
      const outside = date.getMonth() !== state.calendarMonth.getMonth();
      const shown = events.slice(0, 4).map((item) => '<button class="calendar-event ' + escapeHtml(calendarTypeClass(item)) + '" data-event-type="' + escapeHtml(item.event_type || 'other') + '" data-event-id="' + escapeHtml(item.id) + '" title="' + escapeHtml(item.title || calendarEventLabel(item)) + '"><span>' + calendarEventIcon(item) + '</span><b>' + escapeHtml(item.title || calendarEventLabel(item)) + '</b>' + (item.start_time ? '<small>' + trimTime(item.start_time) + '</small>' : '') + '</button>').join('');
      return '<div class="calendar-day selectable ' + (outside ? 'outside ' : '') + (iso === today ? 'today ' : '') + (events.length ? 'has-events' : '') + '" data-calendar-date="' + iso + '" role="button" tabindex="0" aria-label="יצירת אירוע בתאריך ' + escapeHtml(formatDate(iso)) + '"><div class="calendar-day-number"><span>' + date.getDate() + '</span><span class="calendar-day-tools">' + (events.length ? '<small>' + events.length + '</small>' : '') + '<i aria-hidden="true">＋</i></span></div><div class="calendar-events">' + shown + (events.length > 4 ? '<span class="calendar-more">ועוד ' + (events.length - 4) + '</span>' : '') + '</div></div>';
    }).join('');
    grid.innerHTML = '<div class="calendar-weekdays">' + weekdays + '</div><div class="calendar-grid">' + cells + '</div>';
  }

  function openCalendarDialogV033(item) {
    const value = item || {};
    const form = document.querySelector('#calendarForm');
    if (!form) return;
    form.reset();
    let id = form.elements.id;
    if (!id) {
      id = document.createElement('input');
      id.type = 'hidden';
      id.name = 'id';
      form.prepend(id);
    }
    id.value = value.id || '';
    form.elements.title.value = value.title || '';
    form.elements.event_date.value = value.event_date || dateISO(new Date());
    form.elements.start_time.value = trimTime(value.start_time) || '';
    form.elements.end_time.value = trimTime(value.end_time) || '';
    form.elements.description.value = value.description || '';
    const type = value.is_general_day_off ? 'general_day_off' : (value.event_type || 'meeting');
    const radio = form.querySelector('input[name="event_type"][value="' + type + '"]') || form.querySelector('input[name="event_type"][value="other"]');
    if (radio) radio.checked = true;
    configureCalendarVisibility(value.visibility || (roleKind() === 'manager' ? 'all' : 'private'));
    if (form.elements.class_id && value.class_id && roleKind() === 'manager') form.elements.class_id.value = value.class_id;
    const heading = form.querySelector('.modal-heading h3');
    const submit = form.querySelector('button[value="default"]');
    if (heading) heading.textContent = value.id ? 'עריכת אירוע' : 'אירוע חדש';
    if (submit) submit.textContent = value.id ? 'שמירת השינויים' : 'שמירת האירוע';
    document.querySelector('#calendarDialog')?.showModal();
  }

  function openCalendarEventV033(item) {
    document.querySelector('#calendarEventTitle').textContent = item.title || calendarEventLabel(item);
    document.querySelector('#calendarEventDetails').innerHTML = '<div class="event-hero"><strong>' + calendarEventIcon(item) + ' ' + escapeHtml(calendarEventLabel(item)) + '</strong><p>' + formatDate(item.event_date, { weekday:'long', day:'numeric', month:'long', year:'numeric' }) + (item.start_time ? ' · ' + timeHtml(item.start_time, item.end_time) : '') + '</p></div><div class="event-detail-row"><strong>נראות</strong><span>' + escapeHtml(visibilityText(item)) + '</span></div>' + (item.description ? '<div class="event-detail-row"><strong>פירוט</strong><span>' + escapeHtml(item.description).replaceAll('\n', '<br>') + '</span></div>' : '');
    const canManage = !item.read_only && (isManager() || item.created_by === state.profile.id);
    document.querySelector('#calendarEventActions').innerHTML = canManage
      ? '<button class="secondary-btn" data-action="edit-event" data-id="' + item.id + '">עריכת אירוע</button><button class="danger-btn" data-action="delete-event" data-id="' + item.id + '">מחיקת אירוע</button>'
      : '<button type="button" class="ghost-btn close-dialog-inline">סגירה</button>';
    document.querySelector('#calendarEventDialog')?.showModal();
  }

  async function saveCalendarEventV033(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[value="default"]');
    const data = formObject(form);
    data.event_type = form.querySelector('input[name="event_type"]:checked')?.value || 'other';
    if (roleKind() !== 'manager') {
      data.visibility = form.elements.visibility.value;
      data.class_id = data.visibility === 'class' ? state.profile.primary_class_id : null;
    }
    const editing = Boolean(data.id);
    setBusy(button, true, editing ? 'מעדכן…' : 'שומר…');
    try {
      const result = await apiFetch('/api/calendar', { method:editing ? 'PATCH' : 'POST', body:data });
      const item = result.item || { ...data, id:data.id || ('pending-' + Date.now()), created_by:state.profile.id };
      const index = state.calendarEvents.findIndex((row) => String(row.id) === String(item.id));
      if (index >= 0) state.calendarEvents[index] = item; else state.calendarEvents.push(item);
      state.calendarCache.delete(monthParam(state.calendarMonth));
      document.querySelector('#calendarDialog')?.close();
      renderCalendarV033();
      showToast(editing ? 'האירוע עודכן' : 'האירוע נשמר', 'success');
      if (data.event_type === 'general_day_off') refreshAll().catch(() => {});
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setBusy(button, false);
    }
  }

  function handleCalendarClickV033(event) {
    const eventButton = event.target.closest('[data-event-id]');
    if (eventButton) {
      const item = state.calendarEvents.find((row) => String(row.id) === String(eventButton.dataset.eventId));
      if (item) openCalendarEventV033(item);
      return;
    }
    const day = event.target.closest('[data-calendar-date]');
    if (day) openCalendarDialogV033({ event_date:day.dataset.calendarDate });
  }

  function handleCalendarKeydownV033(event) {
    if (!['Enter', ' '].includes(event.key)) return;
    const day = event.target.closest('[data-calendar-date]');
    if (!day) return;
    event.preventDefault();
    openCalendarDialogV033({ event_date:day.dataset.calendarDate });
  }

  async function handleCalendarEventActionV033(event) {
    const button = event.target.closest('[data-action],.close-dialog-inline');
    if (!button) return;
    if (button.classList.contains('close-dialog-inline')) return document.querySelector('#calendarEventDialog')?.close();
    const item = state.calendarEvents.find((row) => String(row.id) === String(button.dataset.id));
    if (button.dataset.action === 'edit-event' && item) {
      document.querySelector('#calendarEventDialog')?.close();
      return openCalendarDialogV033(item);
    }
    if (button.dataset.action !== 'delete-event' || !item || !confirm('למחוק את האירוע?')) return;
    setBusy(button, true, 'מוחק…');
    try {
      await apiFetch('/api/calendar', { method:'DELETE', body:{ id:item.id } });
      state.calendarEvents = state.calendarEvents.filter((row) => String(row.id) !== String(item.id));
      state.calendarCache.delete(monthParam(state.calendarMonth));
      document.querySelector('#calendarEventDialog')?.close();
      renderCalendarV033();
      showToast('האירוע נמחק', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setBusy(button, false);
    }
  }

  function lockTeacherAnnouncementAudience() {
    if (roleKind() !== 'teacher') return false;
    const form = document.querySelector('#announcementForm');
    const classRadio = form?.querySelector('input[name="audience_type"][value="class"]');
    if (classRadio) classRadio.checked = true;
    form?.querySelectorAll('input[name="audience_type"]').forEach((input) => {
      input.disabled = input.value !== 'class';
      input.closest('label')?.classList.toggle('hidden', input.value !== 'class');
    });
    const select = form?.elements.class_id;
    if (select) {
      const item = classById(state.profile.primary_class_id);
      select.innerHTML = item ? '<option value="' + item.id + '">' + escapeHtml(item.name) + '</option>' : '<option value="">לא הוגדרה כיתה</option>';
      select.value = state.profile.primary_class_id || '';
      select.disabled = true;
    }
    setHidden('#announcementClassField', false);
    setHidden('#announcementEmployeesField', true);
    return true;
  }

  function openAnnouncementDialogV033() {
    const form = document.querySelector('#announcementForm');
    form.reset();
    const defaultAudience = roleKind() === 'teacher' ? 'class' : 'all';
    const audience = form.querySelector('input[name="audience_type"][value="' + defaultAudience + '"]');
    const type = form.querySelector('input[name="announcement_type"][value="info"]');
    if (audience) audience.checked = true;
    if (type) type.checked = true;
    form.elements.published_at.value = localDateTimeValue();
    form.elements.requires_acknowledgement.checked = true;
    document.querySelector('#announcementEmployeesField').innerHTML = employeePickerHtml('announcement_employee_ids');
    if (!lockTeacherAnnouncementAudience()) updateAnnouncementAudience();
    document.querySelector('#announcementDialog')?.showModal();
  }

  function updateAnnouncementAudienceV033() {
    if (lockTeacherAnnouncementAudience()) return;
    const type = document.querySelector('#announcementForm input[name="audience_type"]:checked')?.value || 'all';
    setHidden('#announcementClassField', type !== 'class');
    setHidden('#announcementEmployeesField', type !== 'employees');
  }

  async function saveAnnouncementV033(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[value="default"]');
    const data = formObject(form);
    data.audience_type = roleKind() === 'teacher' ? 'class' : (form.querySelector('input[name="audience_type"]:checked')?.value || 'all');
    data.class_id = roleKind() === 'teacher' ? state.profile.primary_class_id : data.class_id;
    data.announcement_type = form.querySelector('input[name="announcement_type"]:checked')?.value || 'info';
    data.employee_ids = selectedCheckboxValues(form, 'announcement_employee_ids');
    data.published_at = toIsoDateTime(data.published_at) || new Date().toISOString();
    data.expires_at = toIsoDateTime(data.expires_at);
    data.is_pinned = form.elements.is_pinned.checked;
    data.requires_acknowledgement = form.elements.requires_acknowledgement.checked;
    data.popup_on_login = Boolean(form.elements.popup_on_login?.checked);
    setBusy(button, true, 'מפרסם…');
    try {
      const result = await apiFetch('/api/announcements', { method:'POST', body:data });
      if (result.item) state.announcements.unshift(result.item);
      if (data.audience_type === 'employees' && result.item) {
        state.announcementRecipients.push(...data.employee_ids.map((id) => ({ announcement_id:result.item.id, employee_id:id })));
      }
      document.querySelector('#announcementDialog')?.close();
      renderAnnouncements();
      renderNavBadges();
      showToast('ההודעה פורסמה', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setBusy(button, false);
    }
  }

  function announcementRecipientIds(item) {
    if (item.audience_type === 'employees') return state.announcementRecipients.filter((row) => row.announcement_id === item.id).map((row) => row.employee_id);
    return state.employees.filter((employee) => employee.active && (item.audience_type === 'all' || employee.primary_class_id === item.class_id)).map((employee) => employee.id);
  }

  function openAnnouncementTracking(item) {
    const recipients = announcementRecipientIds(item);
    const reads = new Map(state.announcementReads.filter((row) => row.announcement_id === item.id).map((row) => [row.employee_id, row]));
    document.querySelector('#taskTrackingTitle').textContent = 'קריאת הודעה: ' + (item.title || '');
    document.querySelector('#taskTrackingSummary').textContent = reads.size + ' מתוך ' + recipients.length + ' קראו';
    document.querySelector('#taskTrackingList').innerHTML = recipients.map((id) => {
      const employee = employeeById(id);
      const read = reads.get(id);
      const status = read?.read_at ? 'נקרא ב־' + formatDate(read.read_at, { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : 'טרם נקראה';
      return '<article class="tracking-row ' + (read ? 'done' : 'pending') + '"><span class="employee-avatar small">' + escapeHtml(initials(employee?.full_name)) + '</span><div><strong>' + escapeHtml(employee?.full_name || '') + '</strong><small>' + escapeHtml(status) + '</small></div><b>' + (read ? '✓' : '…') + '</b></article>';
    }).join('');
    document.querySelector('#taskTrackingDialog')?.showModal();
  }

  async function handleAnnouncementClickV033(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const item = state.announcements.find((row) => String(row.id) === String(button.dataset.id));
    if (!item) return;
    if (action === 'announcement_tracking') return openAnnouncementTracking(item);
    if (action === 'delete' && !confirm('להסיר את ההודעה?')) return;
    setBusy(button, true, action === 'read' ? 'מסמן…' : 'מעדכן…');
    try {
      if (action === 'read') {
        await apiFetch('/api/announcements', { method:'POST', body:{ action:'read', id:item.id } });
        const now = new Date().toISOString();
        const existing = state.announcementReads.find((row) => row.announcement_id === item.id && row.employee_id === state.profile.id);
        if (existing) existing.read_at = now; else state.announcementReads.push({ announcement_id:item.id, employee_id:state.profile.id, read_at:now });
      } else if (action === 'pin' || action === 'unpin') {
        await apiFetch('/api/announcements', { method:'PATCH', body:{ id:item.id, is_pinned:action === 'pin' } });
        item.is_pinned = action === 'pin';
      } else if (action === 'delete') {
        await apiFetch('/api/announcements', { method:'DELETE', body:{ id:item.id } });
        state.announcements = state.announcements.filter((row) => row.id !== item.id);
      }
      renderAnnouncements();
      renderNavBadges();
      renderDashboard();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setBusy(button, false);
    }
  }

  function addEmployeeTourButtons() {
    if (!isManager()) return;
    document.querySelectorAll('[data-employee-card]').forEach((card) => {
      if (card.querySelector('[data-action="restart-onboarding"]')) return;
      const id = card.dataset.employeeCard;
      const employee = employeeById(id);
      const actions = card.querySelector('.card-actions');
      if (!actions || !employee) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ghost-btn v033-tour-reset';
      button.dataset.action = 'restart-onboarding';
      button.dataset.id = id;
      button.textContent = employee.onboarding_completed ? 'הפעלת סיור בכניסה הבאה' : 'הסיור יופעל בכניסה הבאה';
      button.disabled = !employee.onboarding_completed;
      actions.append(button);
    });
  }

  function installEmployeeTourAction() {
    const list = document.querySelector('#employeesList');
    if (!list || list.dataset.v033TourAction === 'true') return;
    list.dataset.v033TourAction = 'true';
    list.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action="restart-onboarding"]');
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const employee = employeeById(button.dataset.id);
      if (!employee) return;
      setBusy(button, true, 'מגדיר…');
      try {
        await apiFetch('/api/employees', { method:'PATCH', body:{ id:employee.id, restart_onboarding:true } });
        employee.onboarding_completed = false;
        renderEmployees();
        showToast('הסיור יוצג פעם אחת בכניסה הבאה של ' + employee.full_name, 'success');
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        setBusy(button, false);
      }
    }, true);
  }

  function tourSteps() {
    const manager = roleKind() === 'manager';
    return [
      { tab:'dashboard', target:'#v033DashboardWeek,#dashboardPanel .summary-grid,#dashboardPanel', icon:'⌂', title:'המסך הראשי', text:'המסגרת הסגולה מסמנת את האזור שמסבירים עכשיו. כאן מופיעים השיבוץ האישי והפעולות החשובות עבורך.' },
      { tab:'schedule', target:'#scheduleExport,.schedule-heading', icon:'▦', title:'השיבוץ השבועי', text:manager ? 'כאן בונים, בודקים ומפרסמים את השיבוץ. החצים והמסגרת מסמנים את אזור העבודה.' : 'כאן רואים את כל ימי השבוע לרוחב, ורק את השיבוץ שמותר לתפקיד שלך לראות.' },
      { tab:'requests', target:'#newRequestBtn', icon:'↔', title:'הגשת בקשה', text:'לחצו על “בקשה חדשה”, בחרו חופשה, מחלה, שעות או החלפה ושלחו למעקב.' },
      { tab:'announcements', target:'#announcementsList,.content-toolbar,#announcementsPanel', icon:'◉', title:'הודעות ועדכונים', text:'כאן קוראים הודעות ומאשרים קריאה. בעלי הרשאה יכולים לפרסם לקהל המורשה.' },
      { tab:'calendar', target:'#newCalendarBtn', icon:'◫', title:'לוח השנה', text:'לחצו על יום או על “אירוע חדש” כדי ליצור אירוע פרטי או אירוע כיתה לפי התפקיד.' },
    ];
  }

  function clearTourFocus() {
    document.querySelectorAll('.v033-tour-focus').forEach((element) => element.classList.remove('v033-tour-focus'));
    const spotlight = document.querySelector('#v033TourSpotlight');
    if (spotlight) spotlight.hidden = true;
  }

  function ensureTourSpotlight() {
    let spotlight = document.querySelector('#v033TourSpotlight');
    if (spotlight) return spotlight;
    spotlight = document.createElement('div');
    spotlight.id = 'v033TourSpotlight';
    spotlight.className = 'v033-tour-spotlight';
    spotlight.hidden = true;
    spotlight.innerHTML = '<i class="arrow top" aria-hidden="true">↓</i><i class="arrow right" aria-hidden="true">←</i><i class="arrow bottom" aria-hidden="true">↑</i><i class="arrow left" aria-hidden="true">→</i><span>כאן</span>';
    document.body.append(spotlight);
    return spotlight;
  }

  function positionTourSpotlight(target, dialog) {
    if (!target) return;
    const spotlight = ensureTourSpotlight();
    const rect = target.getBoundingClientRect();
    const margin = 7;
    const top = Math.max(margin, rect.top - margin);
    const left = Math.max(margin, rect.left - margin);
    const width = Math.min(window.innerWidth - left - margin, Math.max(48, rect.width + margin * 2));
    const height = Math.min(window.innerHeight - top - margin, Math.max(48, rect.height + margin * 2));
    spotlight.style.top = top + 'px';
    spotlight.style.left = left + 'px';
    spotlight.style.width = width + 'px';
    spotlight.style.height = height + 'px';
    spotlight.classList.toggle('is-round', width < 120 && height < 120);
    spotlight.hidden = false;
    dialog.classList.toggle('place-top', rect.bottom > window.innerHeight * .62);
  }

  async function finishTour() {
    const dialog = document.querySelector('#v033TourDialog');
    try {
      const result = await apiFetch('/api/auth-me', { method:'PATCH', body:{ action:'complete_onboarding' }, timeout:8000 });
      if (result.profile) state.profile = { ...state.profile, ...result.profile };
      state.profile.onboarding_completed = true;
      state.profile.onboarding_required = false;
      clearTourFocus();
      dialog?.close();
    } catch (error) {
      showToast('לא ניתן היה לשמור את סיום הסיור. נסו שוב.', 'error');
    }
  }

  function ensureTourDialog() {
    let dialog = document.querySelector('#v033TourDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'v033TourDialog';
    dialog.className = 'v033-tour-dialog';
    dialog.setAttribute('aria-labelledby', 'v033TourTitle');
    dialog.innerHTML = '<section class="v033-tour-card"><div class="v033-tour-active"><i></i> סיור מודרך פעיל</div><button type="button" class="v033-tour-close" data-v033-tour-finish aria-label="סגירת הסיור">×</button><div class="v033-tour-heading"><span id="v033TourIcon">⌂</span><div><small id="v033TourCounter"></small><h3 id="v033TourTitle"></h3></div></div><p id="v033TourText"></p><div id="v033TourDots" class="v033-tour-dots"></div><div class="v033-tour-actions"><button type="button" class="ghost-btn" data-v033-tour-finish>דלג על הסיור</button><button type="button" class="primary-btn" data-v033-tour-next>הבא</button></div></section>';
    document.body.append(dialog);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finishTour();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target.closest('[data-v033-tour-finish]')) return finishTour();
      if (!event.target.closest('[data-v033-tour-next]')) return;
      const index = Number(dialog.dataset.step || 0);
      if (index >= tourSteps().length - 1) return finishTour();
      showTourStep(index + 1);
    });
    return dialog;
  }

  function showTourStep(index) {
    const steps = tourSteps();
    const step = steps[Math.max(0, Math.min(index, steps.length - 1))];
    const dialog = ensureTourDialog();
    dialog.dataset.step = String(index);
    clearTourFocus();
    switchTab(step.tab);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const target = document.querySelector(step.target);
      target?.classList.add('v033-tour-focus');
      target?.scrollIntoView({ block:'center', inline:'nearest', behavior:'auto' });
      requestAnimationFrame(() => positionTourSpotlight(target, dialog));
    }));
    document.querySelector('#v033TourIcon').textContent = step.icon;
    document.querySelector('#v033TourCounter').textContent = (index + 1) + ' מתוך ' + steps.length;
    document.querySelector('#v033TourTitle').textContent = step.title;
    document.querySelector('#v033TourText').textContent = step.text;
    document.querySelector('#v033TourDots').innerHTML = steps.map((_, dot) => '<i class="' + (dot === index ? 'active' : '') + '"></i>').join('');
    dialog.querySelector('[data-v033-tour-next]').textContent = index === steps.length - 1 ? 'סיום' : 'הבא';
    if (!dialog.open) dialog.show();
    dialog.focus({ preventScroll:true });
  }

  function maybeStartTour() {
    const profile = state?.profile;
    if (!profile || profile.onboarding_required !== true || !document.querySelector('#appShell:not(.hidden)')) return;
    const dialog = ensureTourDialog();
    if (dialog.open || dialog.dataset.started === 'true') return;
    dialog.dataset.started = 'true';
    setTimeout(() => {
      if (state?.profile?.onboarding_required === true && document.querySelector('#appShell:not(.hidden)')) showTourStep(0);
    }, 500);
  }

  function installPasswordReveal() {
    if (!window.__hadasV033PasswordRevealInstalled) {
      window.__hadasV033PasswordRevealInstalled = true;
      document.addEventListener('click', (event) => {
        const button = event.target.closest?.('.v033-password-toggle');
        if (!button) return;
        event.preventDefault();
        const input = button.closest('.v033-password-field')?.querySelector('input');
        if (!input) return;
        const reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        button.textContent = reveal ? '◉̸' : '◉';
        button.setAttribute('aria-label', reveal ? 'הסתרת הסיסמה' : 'הצגת הסיסמה');
      }, true);
    }
    document.querySelectorAll('#loginForm input[type="password"],#passwordForm input[type="password"]').forEach((input) => {
      if (input.closest('.v033-password-field')) return;
      const wrap = document.createElement('span');
      wrap.className = 'v033-password-field';
      const label = input.closest('label');
      if (label) {
        const group = document.createElement('div');
        group.className = 'v033-password-group';
        input.id ||= (input.form?.id || 'password') + '-' + (input.name || 'field');
        label.htmlFor = input.id;
        label.before(group);
        group.append(label, wrap);
      } else input.before(wrap);
      wrap.append(input);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'v033-password-toggle';
      button.setAttribute('aria-label', 'הצגת הסיסמה');
      button.textContent = '◉';
      wrap.append(button);
    });
  }

  function drawLeadSchedule() {
    const classItem = classById(state.profile.primary_class_id);
    const dates = Array.from({ length:6 }, (_, index) => addDays(state.weekStart, index));
    const width = 1680;
    const margin = 42;
    const header = 120;
    const dayWidth = (width - margin * 2) / 6;
    let maxRows = 1;
    dates.forEach((date) => {
      maxRows = Math.max(maxRows, state.shifts.filter((row) => row.shift_date === dateISO(date)).length);
    });
    const height = header + 92 + maxRows * 58 + 70;
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.direction = 'rtl';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#f1efff';
    ctx.fillRect(margin, margin, width - margin * 2, 76);
    ctx.fillStyle = '#34364b';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = '900 28px Arial';
    ctx.fillText('שיבוץ שבועי · ' + (classItem?.name || 'הכיתה שלי'), width - margin - 24, margin + 29);
    ctx.font = '700 15px Arial';
    ctx.fillStyle = '#6e7187';
    ctx.fillText(formatDate(state.weekStart, { day:'numeric', month:'numeric', year:'numeric' }) + '–' + formatDate(addDays(state.weekStart, 5), { day:'numeric', month:'numeric', year:'numeric' }), width - margin - 24, margin + 56);
    dates.forEach((date, index) => {
      const right = width - margin - index * dayWidth;
      const left = right - dayWidth;
      const iso = dateISO(date);
      const rows = sortScheduleRows(state.shifts.filter((row) => row.shift_date === iso));
      ctx.fillStyle = index % 2 ? '#fbfbff' : '#fff';
      ctx.fillRect(left, header, dayWidth, height - header - margin);
      ctx.strokeStyle = '#dedfea';
      ctx.strokeRect(left, header, dayWidth, height - header - margin);
      ctx.fillStyle = '#5b5fc3';
      ctx.textAlign = 'center';
      ctx.font = '900 18px Arial';
      ctx.fillText(DAY_NAMES[date.getDay()], left + dayWidth / 2, header + 26);
      ctx.font = '700 13px Arial';
      ctx.fillStyle = '#777a90';
      ctx.fillText(formatDate(iso, { day:'numeric', month:'numeric' }), left + dayWidth / 2, header + 51);
      if (!rows.length) {
        ctx.fillStyle = '#9a9cad';
        ctx.font = '700 14px Arial';
        ctx.fillText('אין שיבוצים', left + dayWidth / 2, header + 105);
      }
      rows.forEach((row, rowIndex) => {
        const employee = employeeById(row.employee_id);
        const y = header + 74 + rowIndex * 58;
        ctx.fillStyle = '#f5f4ff';
        ctx.fillRect(left + 10, y, dayWidth - 20, 48);
        ctx.fillStyle = '#37394d';
        ctx.textAlign = 'right';
        ctx.font = '900 14px Arial';
        ctx.fillText(String(employee?.full_name || 'עובד').slice(0, 24), right - 18, y + 16);
        ctx.font = '700 12px Arial';
        ctx.fillStyle = '#676a80';
        ctx.fillText(trimTime(row.start_time) + '–' + trimTime(row.end_time), right - 18, y + 35);
      });
    });
    return canvas;
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('לא ניתן להכין את הקובץ')), 'image/png'));
  }

  async function exportLeadImage(event) {
    const button = event.currentTarget;
    setBusy(button, true, 'מכין תמונה…');
    try {
      await document.fonts?.ready;
      const blob = await canvasBlob(drawLeadSchedule());
      const filename = 'שיבוץ-' + (classById(state.profile.primary_class_id)?.name || 'כיתה') + '-' + dateISO(state.weekStart) + '.png';
      const file = new File([blob], filename, { type:'image/png', lastModified:Date.now() });
      if (navigator.share && navigator.canShare?.({ files:[file] })) {
        try {
          await navigator.share({ files:[file], title:'שיבוץ הכיתה השבועי' });
          return;
        } catch (error) {
          if (error?.name === 'AbortError') return;
        }
      }
      downloadBlob(blob, filename);
      showToast('תמונת שיבוץ הכיתה נשמרה', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setBusy(button, false);
    }
  }

  async function printLeadA4(event) {
    const button = event.currentTarget;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return showToast('הדפדפן חסם את חלון ההדפסה', 'error');
    setBusy(button, true, 'מכין להדפסה…');
    try {
      await document.fonts?.ready;
      const image = drawLeadSchedule().toDataURL('image/png', 1);
      printWindow.document.open();
      printWindow.document.write('<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>שיבוץ הכיתה</title><style>@page{size:A4 landscape;margin:7mm}html,body{margin:0;background:#fff}.sheet{width:283mm;height:196mm;display:flex;align-items:center;justify-content:center}.sheet img{max-width:100%;max-height:100%}</style></head><body><div class="sheet"><img src="' + image + '" alt="שיבוץ הכיתה"></div><script>document.querySelector("img").onload=function(){setTimeout(function(){window.print()},180)}<\/script></body></html>');
      printWindow.document.close();
    } catch (error) {
      printWindow.close();
      showToast(error.message, 'error');
    } finally {
      setBusy(button, false);
    }
  }

  function replaceLeadButton(id, handler, label) {
    const old = document.querySelector('#' + id);
    if (!old || old.dataset.v033Lead === 'true') return;
    const button = old.cloneNode(true);
    button.dataset.v033Lead = 'true';
    button.textContent = label;
    old.replaceWith(button);
    button.addEventListener('click', handler);
  }

  function installLeadExports() {
    if (roleKind() !== 'lead') return;
    replaceLeadButton('imageBtn', exportLeadImage, '📷 שבוע כתמונה');
    replaceLeadButton('v031PrintBtn', printLeadA4, '🖨️ הדפסה A4');
  }

  function handleV033UtilityClick(event) {
    const scrollButton = event.target.closest?.('[data-v033-week-scroll]');
    if (!scrollButton) return;
    const week = scrollButton.closest('.v033-week-scroll-shell')?.querySelector('.v033-personal-week');
    const cards = [...(week?.querySelectorAll('.v033-personal-day') || [])];
    if (!week || !cards.length) return;
    event.preventDefault();
    let index = Number(week.dataset.focusedDay || 0);
    index += scrollButton.dataset.v033WeekScroll === 'left' ? 1 : -1;
    index = Math.max(0, Math.min(cards.length - 1, index));
    week.dataset.focusedDay = String(index);
    cards[index].scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });
  }

  function installRoleGuard() {
    if (window.__hadasV033RoleGuardInstalled) return;
    const panel = document.querySelector('#schedulePanel');
    if (!panel) return;
    window.__hadasV033RoleGuardInstalled = true;
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (state?.profile) applyRoleUi();
      });
    });
    observer.observe(panel, { childList:true, subtree:true });
    window.__hadasV033RoleObserver = observer;
  }

  function refreshTourSpotlight() {
    const dialog = document.querySelector('#v033TourDialog');
    if (!dialog?.open) return;
    const step = tourSteps()[Number(dialog.dataset.step || 0)];
    const target = step ? document.querySelector(step.target) : null;
    positionTourSpotlight(target, dialog);
  }

  function installOverrides() {
    if (window.__hadasV033Installed) return;
    window.__hadasV033Installed = true;

    const nativeShowModal = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function v033ShowModal() {
      if (this.id === 'v031TourDialog') return undefined;
      return nativeShowModal.apply(this, arguments);
    };

    const baseApplyPermissions = applyPermissions;
    applyPermissions = function v033ApplyPermissions() {
      const result = baseApplyPermissions.apply(this, arguments);
      applyRoleUi();
      return result;
    };

    const baseSwitchTab = switchTab;
    switchTab = function v033SwitchTab(tab) {
      return baseSwitchTab.call(this, tab === 'tasks' ? 'announcements' : tab);
    };

    const baseRenderSchedule = renderSchedule;
    renderSchedule = function v033RenderSchedule() {
      const result = baseRenderSchedule.apply(this, arguments);
      if (roleKind() === 'regular') renderRegularHorizontalSchedule();
      requestAnimationFrame(applyRoleUi);
      return result;
    };

    const baseRenderDashboard = renderDashboard;
    renderDashboard = function v033RenderDashboard() {
      const result = baseRenderDashboard.apply(this, arguments);
      enhanceDashboard();
      return result;
    };

    const baseRenderEmployees = renderEmployees;
    renderEmployees = function v033RenderEmployees() {
      const result = baseRenderEmployees.apply(this, arguments);
      addEmployeeTourButtons();
      return result;
    };

    syncCalendarVisibility = function v033SyncCalendarVisibility() {
      const form = document.querySelector('#calendarForm');
      if (!form) return;
      const visible = form.elements.visibility.value === 'class';
      setHidden('#calendarClassField', !visible);
      form.elements.class_id.required = visible;
    };
    renderCalendar = renderCalendarV033;
    openCalendarDialog = openCalendarDialogV033;
    openCalendarEvent = openCalendarEventV033;
    saveCalendarEvent = saveCalendarEventV033;
    handleCalendarClick = handleCalendarClickV033;
    handleCalendarKeydown = handleCalendarKeydownV033;
    handleCalendarEventAction = handleCalendarEventActionV033;
    openAnnouncementDialog = openAnnouncementDialogV033;
    updateAnnouncementAudience = updateAnnouncementAudienceV033;
    saveAnnouncement = saveAnnouncementV033;
    handleAnnouncementClick = handleAnnouncementClickV033;

    const baseRenderAll = renderAll;
    renderAll = function v033RenderAll() {
      const result = baseRenderAll.apply(this, arguments);
      applyRoleUi();
      addEmployeeTourButtons();
      requestAnimationFrame(maybeStartTour);
      return result;
    };

    installEmployeeTourAction();
    installRoleGuard();
    installPasswordReveal();
    installVersionGuard();
    document.addEventListener('click', handleV033UtilityClick);
    window.addEventListener('resize', debounce(refreshTourSpotlight, 80), { passive:true });
    window.addEventListener('scroll', debounce(refreshTourSpotlight, 40), { passive:true, capture:true });
    const calendarMedia = matchMedia('(max-width:760px)');
    calendarMedia.addEventListener?.('change', () => {
      if (state?.profile && state.activeTab === 'calendar') renderCalendarV033();
    });
  }

  async function boot() {
    try {
      await loadPrevious();
      if (window.__hadasV032BootstrapPromise) {
        const ready = await window.__hadasV032BootstrapPromise;
        if (!ready) throw new Error('שכבת הממשק הקודמת לא הושלמה');
      }
      installOverrides();
      pinVersion();
      return true;
    } catch (error) {
      console.error('Hadas v0.33.1 bootstrap failed', error);
      return false;
    } finally {
      releaseBootstrap();
    }
  }

  pinVersion();
  window.__hadasV033BootstrapPromise = boot();
})();
