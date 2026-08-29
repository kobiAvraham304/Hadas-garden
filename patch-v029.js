/* מערכת ניהול שיבוצים מעון הדס — שכבת ממשק 0.29.0 */
(() => {
  const VERSION = '0.29.0';
  const PREVIOUS_PATCH = '/patch-v028.js?v=0290';

  function forceVersion() {
    const badge = document.querySelector('#appVersionBadge');
    if (badge) badge.textContent = `v${VERSION}`;
    const login = document.querySelector('#loginVersion');
    if (login) login.textContent = `גרסה ${VERSION}`;
    document.documentElement.dataset.hadasVersion = VERSION;
  }

  function loadPreviousPatch() {
    if (document.querySelector('script[data-v029-v028-loader]')) return;
    const script = document.createElement('script');
    script.src = PREVIOUS_PATCH;
    script.async = false;
    script.dataset.v029V028Loader = 'true';
    script.onload = waitForV028;
    script.onerror = () => console.error('Hadas v0.29: previous UI patch could not be loaded');
    document.head.append(script);
  }

  function waitForV028() {
    const started = Date.now();
    const timer = setInterval(() => {
      if (window.__hadasV028Installed) {
        clearInterval(timer);
        installV029();
      } else if (Date.now() - started > 7000) {
        clearInterval(timer);
        installV029();
      }
    }, 40);
  }

  function installAnnouncementPushOption() {
    const form = document.querySelector('#announcementForm');
    if (!form || form.elements.popup_on_login) return;
    const options = form.querySelector('.compose-options');
    if (!options) return;
    const label = document.createElement('label');
    label.className = 'toggle-field v029-push-toggle';
    label.innerHTML = '<input name="popup_on_login" type="checkbox" value="true" /><span><strong>Push בכניסה למערכת</strong><small>ההודעה תיפתח בחלון בולט לעובדים הרלוונטיים בפעם הבאה שייכנסו למערכת, עד שיאשרו שקראו.</small></span>';
    options.append(label);
  }

  function announcementIsForCurrentUser(item) {
    if (!item || !state?.profile?.id) return false;
    if (item.audience_type === 'all') return true;
    if (item.audience_type === 'class') return item.class_id === state.profile.primary_class_id;
    if (item.audience_type === 'employees') return state.announcementRecipients.some((row) => row.announcement_id === item.id && row.employee_id === state.profile.id);
    return false;
  }

  function pushWasRead(item) {
    return state.announcementReads.some((row) => row.announcement_id === item.id && row.employee_id === state.profile.id);
  }

  function sessionShownPushIds() {
    if (!state?.profile?.id) return new Set();
    try { return new Set(JSON.parse(sessionStorage.getItem(`hadas-v029-push:${state.profile.id}`) || '[]')); }
    catch { return new Set(); }
  }

  function rememberPushShown(id) {
    if (!state?.profile?.id || !id) return;
    const ids = sessionShownPushIds(); ids.add(id);
    try { sessionStorage.setItem(`hadas-v029-push:${state.profile.id}`, JSON.stringify([...ids].slice(-100))); } catch {}
  }

  function pendingLoginPushes() {
    const now = Date.now();
    const shown = sessionShownPushIds();
    return (state.announcements || []).filter((item) => {
      if (!item.popup_on_login || !item.active || shown.has(item.id) || pushWasRead(item) || !announcementIsForCurrentUser(item)) return false;
      const publishAt = Date.parse(item.published_at || 0);
      const expiresAt = item.expires_at ? Date.parse(item.expires_at) : null;
      if (Number.isFinite(publishAt) && publishAt > now) return false;
      if (expiresAt && Number.isFinite(expiresAt) && expiresAt < now) return false;
      return true;
    }).sort((a,b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));
  }

  function ensurePushDialog() {
    let dialog = document.querySelector('#v029PushDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'v029PushDialog';
    dialog.className = 'modal v029-push-dialog';
    dialog.innerHTML = '<div class="modal-card v029-push-card"><div class="v029-push-badge">עדכון לצוות</div><div class="modal-heading"><div><p class="eyebrow">הודעת Push</p><h3 id="v029PushTitle"></h3><p id="v029PushMeta" class="muted"></p></div><button type="button" class="icon-btn" data-v029-push-close aria-label="סגירה">×</button></div><div id="v029PushBody" class="v029-push-body"></div><div class="modal-actions"><button type="button" class="ghost-btn" data-v029-push-open>מעבר לכל ההודעות</button><button type="button" class="primary-btn" data-v029-push-read>הבנתי, קראתי</button></div></div>';
    document.body.append(dialog);
    dialog.addEventListener('click', async (event) => {
      const itemId = dialog.dataset.announcementId;
      if (event.target.closest('[data-v029-push-close]')) { dialog.close(); return; }
      if (event.target.closest('[data-v029-push-open]')) {
        dialog.close();
        try { switchTab('announcements'); } catch {}
        return;
      }
      const readButton = event.target.closest('[data-v029-push-read]');
      if (!readButton || !itemId) return;
      setBusy(readButton, true, 'מסמן…');
      try {
        await apiFetch('/api/announcements', { method:'POST', body:{ action:'read', id:itemId } });
        if (!state.announcementReads.some((row) => row.announcement_id === itemId && row.employee_id === state.profile.id)) state.announcementReads.push({ announcement_id:itemId, employee_id:state.profile.id, read_at:new Date().toISOString() });
        dialog.close();
        try { renderNavBadges(); renderAnnouncements(); } catch {}
        setTimeout(maybeShowLoginPush, 120);
      } catch (error) { showToast(error.message, 'error'); }
      finally { setBusy(readButton, false); }
    });
    return dialog;
  }

  function maybeShowLoginPush() {
    if (!state?.profile?.id || !Array.isArray(state.announcements) || document.querySelector('#loginScreen:not(.hidden)')) return;
    const dialog = ensurePushDialog();
    if (dialog.open) return;
    const item = pendingLoginPushes()[0];
    if (!item) return;
    rememberPushShown(item.id);
    dialog.dataset.announcementId = item.id;
    document.querySelector('#v029PushTitle').textContent = item.title || 'הודעה חדשה';
    document.querySelector('#v029PushMeta').textContent = `${item.announcement_type === 'urgent' ? 'דחוף' : item.announcement_type === 'important' ? 'חשוב' : 'מידע'} · ${typeof formatDate === 'function' ? formatDate(item.published_at, { day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' }) : ''}`;
    document.querySelector('#v029PushBody').innerHTML = escapeHtml(item.body || '').replaceAll('\n','<br>');
    dialog.showModal();
  }

  function installPushRenderHook() {
    if (window.__v029PushRenderHook) return;
    window.__v029PushRenderHook = true;
    const previousRenderAll = renderAll;
    renderAll = function v029RenderAll(...args) {
      const result = previousRenderAll(...args);
      requestAnimationFrame(() => { installAnnouncementPushOption(); maybeShowLoginPush(); forceVersion(); });
      return result;
    };
  }

  function calendarEventIsGeneral(item) {
    return Boolean(item?.is_general_day_off) || item?.visibility === 'all';
  }

  function calendarEventIsPersonal(item) {
    if (!item || calendarEventIsGeneral(item) || !state?.profile) return false;
    if (item.source === 'approved_leave') return item.employee_id === state.profile.id;
    if (item.created_by === state.profile.id) return true;
    if (item.visibility === 'class') return item.class_id === state.profile.primary_class_id;
    if (item.visibility === 'managers') return isManager();
    return false;
  }

  function filteredCalendarEvents() {
    const mode = state.v029CalendarFilter || 'combined';
    const rows = state.calendarEvents || [];
    if (mode === 'general') return rows.filter(calendarEventIsGeneral);
    if (mode === 'personal') return rows.filter(calendarEventIsPersonal);
    return rows;
  }

  function ensureCalendarScopeControls() {
    const panel = document.querySelector('#calendarPanel');
    if (!panel || document.querySelector('#v029CalendarScope')) return;
    const heading = panel.querySelector('.calendar-heading');
    const controls = document.createElement('section');
    controls.id = 'v029CalendarScope';
    controls.className = 'v029-calendar-scope';
    controls.innerHTML = '<div><strong>תצוגת לוח</strong><small>בחרו אם לראות אירועים אישיים, אירועים כלליים או את שניהם יחד.</small></div><div class="filter-chips" role="group" aria-label="סינון לוח שנה"><button type="button" class="filter-chip" data-v029-calendar-filter="personal">אישי</button><button type="button" class="filter-chip" data-v029-calendar-filter="general">כללי</button><button type="button" class="filter-chip active" data-v029-calendar-filter="combined">משולב</button></div>';
    heading?.insertAdjacentElement('afterend', controls);
    controls.addEventListener('click', (event) => {
      const button = event.target.closest('[data-v029-calendar-filter]');
      if (!button) return;
      state.v029CalendarFilter = button.dataset.v029CalendarFilter;
      controls.querySelectorAll('[data-v029-calendar-filter]').forEach((item) => item.classList.toggle('active', item === button));
      renderCalendar();
    });
  }

  function ensureCalendarDayDialog() {
    let dialog = document.querySelector('#v029CalendarDayDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'v029CalendarDayDialog';
    dialog.className = 'modal v029-calendar-day-dialog';
    dialog.innerHTML = '<div class="modal-card large-modal"><div class="modal-heading"><div><p class="eyebrow">אירועי היום</p><h3 id="v029CalendarDayTitle"></h3><p id="v029CalendarDaySummary" class="muted"></p></div><button type="button" class="icon-btn" data-v029-day-close aria-label="סגירה">×</button></div><div id="v029CalendarDayEvents" class="v029-calendar-day-events"></div><div class="modal-actions"><button type="button" class="ghost-btn" data-v029-day-close>סגירה</button><button type="button" class="primary-btn content-creator-only" data-v029-day-add><span>＋</span> אירוע חדש ביום זה</button></div></div>';
    document.body.append(dialog);
    dialog.addEventListener('click', (event) => {
      if (event.target.closest('[data-v029-day-close]')) { dialog.close(); return; }
      const eventButton = event.target.closest('[data-v029-day-event]');
      if (eventButton) {
        const item = state.calendarEvents.find((row) => String(row.id) === String(eventButton.dataset.v029DayEvent));
        if (item) { dialog.close(); openCalendarEvent(item); }
        return;
      }
      if (event.target.closest('[data-v029-day-add]')) {
        const date = dialog.dataset.calendarDate;
        dialog.close();
        openCalendarDialog({ event_date:date });
      }
    });
    return dialog;
  }

  function openCalendarDay(date) {
    const events = filteredCalendarEvents().filter((item) => item.event_date === date);
    if (!events.length) {
      if (canCreateContent()) openCalendarDialog({ event_date:date });
      return;
    }
    const dialog = ensureCalendarDayDialog();
    dialog.dataset.calendarDate = date;
    document.querySelector('#v029CalendarDayTitle').textContent = formatDate(date, { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    document.querySelector('#v029CalendarDaySummary').textContent = `${events.length} ${events.length === 1 ? 'אירוע' : 'אירועים'} בתצוגה הנוכחית`;
    document.querySelector('#v029CalendarDayEvents').innerHTML = events.sort((a,b)=>String(a.start_time||'').localeCompare(String(b.start_time||''))).map((item) => `<button type="button" class="v029-day-event ${item.event_type || 'other'}" data-v029-day-event="${item.id}"><span>${calendarEventIcon(item)}</span><div><strong>${escapeHtml(item.title || calendarEventLabel(item))}</strong><small>${item.start_time ? `${trimTime(item.start_time)}${item.end_time ? `–${trimTime(item.end_time)}` : ''}` : 'ללא שעה'}${calendarEventIsGeneral(item) ? ' · כללי' : ' · אישי'}</small></div><i>›</i></button>`).join('');
    const add = dialog.querySelector('[data-v029-day-add]');
    if (add) add.classList.toggle('hidden', !canCreateContent());
    dialog.showModal();
  }

  function decorateCalendarDays() {
    const description = document.querySelector('#calendarPanel .calendar-heading .muted');
    if (description) description.textContent = 'בתאריך עם אירועים לחיצה מציגה את אירועי היום. בתאריך ריק לחיצה יוצרת אירוע חדש למורשים.';
    const rows = filteredCalendarEvents();
    document.querySelectorAll('#calendarGrid [data-calendar-date]').forEach((day) => {
      const date = day.dataset.calendarDate;
      const events = rows.filter((item) => item.event_date === date);
      day.classList.toggle('v029-has-visible-events', events.length > 0);
      day.querySelector('[data-v029-add-day]')?.remove();
      if (events.length && canCreateContent()) {
        const tools = day.querySelector('.calendar-day-tools');
        if (tools) tools.insertAdjacentHTML('beforeend', `<button type="button" class="v029-calendar-add-day" data-v029-add-day="${date}" aria-label="יצירת אירוע נוסף ב-${escapeHtml(formatDate(date))}">＋</button>`);
      }
    });
  }

  function installCalendarRenderHook() {
    if (window.__v029CalendarRenderHook) return;
    window.__v029CalendarRenderHook = true;
    state.v029CalendarFilter = state.v029CalendarFilter || 'combined';
    const previousRenderCalendar = renderCalendar;
    renderCalendar = function v029RenderCalendar(...args) {
      ensureCalendarScopeControls();
      const allEvents = state.calendarEvents;
      state.calendarEvents = filteredCalendarEvents();
      let result;
      try { result = previousRenderCalendar(...args); }
      finally { state.calendarEvents = allEvents; }
      const controls = document.querySelector('#v029CalendarScope');
      controls?.querySelectorAll('[data-v029-calendar-filter]').forEach((item) => item.classList.toggle('active', item.dataset.v029CalendarFilter === state.v029CalendarFilter));
      decorateCalendarDays();
      return result;
    };
  }

  function installCalendarClickBehavior() {
    const grid = document.querySelector('#calendarGrid');
    if (!grid || grid.dataset.v029ClickInstalled) return;
    grid.dataset.v029ClickInstalled = 'true';
    grid.addEventListener('click', (event) => {
      const addButton = event.target.closest('[data-v029-add-day]');
      if (addButton) {
        event.preventDefault(); event.stopImmediatePropagation();
        openCalendarDialog({ event_date:addButton.dataset.v029AddDay });
        return;
      }
      if (event.target.closest('[data-event-id]')) return;
      const day = event.target.closest('[data-calendar-date]');
      if (!day) return;
      const events = filteredCalendarEvents().filter((item) => item.event_date === day.dataset.calendarDate);
      if (!events.length) return;
      event.preventDefault(); event.stopImmediatePropagation();
      openCalendarDay(day.dataset.calendarDate);
    }, true);
    grid.addEventListener('keydown', (event) => {
      if (!['Enter',' '].includes(event.key) || event.target.closest('[data-event-id]')) return;
      const day = event.target.closest('[data-calendar-date]');
      if (!day) return;
      const events = filteredCalendarEvents().filter((item) => item.event_date === day.dataset.calendarDate);
      if (!events.length) return;
      event.preventDefault(); event.stopImmediatePropagation();
      openCalendarDay(day.dataset.calendarDate);
    }, true);
  }

  function installV029() {
    if (window.__hadasV029Installed) { forceVersion(); return; }
    window.__hadasV029Installed = true;
    forceVersion();
    installAnnouncementPushOption();
    installPushRenderHook();
    ensureCalendarScopeControls();
    ensureCalendarDayDialog();
    installCalendarRenderHook();
    installCalendarClickBehavior();
    requestAnimationFrame(() => {
      forceVersion();
      try { renderCalendar(); } catch {}
      maybeShowLoginPush();
    });
    setTimeout(() => { forceVersion(); installAnnouncementPushOption(); ensureCalendarScopeControls(); installCalendarClickBehavior(); maybeShowLoginPush(); }, 900);
  }

  forceVersion();
  loadPreviousPatch();
})();
