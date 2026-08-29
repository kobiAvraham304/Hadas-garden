/* מערכת ניהול שיבוצים מעון הדס — שכבת ממשק 0.28.0 */
(() => {
  const VERSION = '0.28.0';
  const PREVIOUS_PATCH = '/patch-v027.js?v=0280';

  function forceVersion() {
    const badge = document.querySelector('#appVersionBadge');
    if (badge) badge.textContent = `v${VERSION}`;
    const login = document.querySelector('#loginVersion');
    if (login) login.textContent = `גרסה ${VERSION}`;
    document.documentElement.dataset.hadasVersion = VERSION;
  }

  forceVersion();

  function loadPreviousPatch() {
    const existing = document.querySelector('script[data-v028-v027-loader]');
    if (existing) return;
    const script = document.createElement('script');
    script.src = PREVIOUS_PATCH;
    script.async = false;
    script.dataset.v028V027Loader = 'true';
    script.onload = installV028;
    script.onerror = () => {
      forceVersion();
      console.error('Hadas v0.28: previous UI patch could not be loaded');
    };
    document.head.append(script);
  }

  function minuteText(value) {
    const total = Math.max(0, Number(value) || 0);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  function installSettingsEnhancements() {
    const form = document.querySelector('#settingsForm');
    if (!form || form.dataset.v028Installed) return;
    form.dataset.v028Installed = 'true';

    const legacyClosing = form.elements.closing_window_minutes;
    const legacyLabel = legacyClosing?.closest('label');
    if (legacyLabel) legacyLabel.classList.add('v028-legacy-closing-hidden');

    if (!form.elements.closing_start_time) {
      const label = document.createElement('label');
      label.className = 'v028-closing-start-field';
      label.innerHTML = '<span>תחילת תקן סוף היום</span><input name="closing_start_time" type="time" /><small>בוחרים שעה מדויקת, כמו בתקינת הבוקר. ביום שישי אותו פרק זמן יחושב לפני 12:00.</small>';
      legacyLabel?.insertAdjacentElement('afterend', label);
    }

    const grid = form.querySelector('.staffing-stepper-grid');
    if (grid && !form.elements.max_daily_staff) {
      grid.classList.remove('three-zones');
      grid.classList.add('four-zones', 'v028-four-zones');
      const card = document.createElement('article');
      card.className = 'staffing-stepper-card v028-max-staff-card';
      card.innerHTML = '<span class="staffing-card-icon">⇧</span><div><strong>מקסימום תקינה יומית</strong><small>תקרת עובדים במקביל בכל כיתה. ריק = ללא תקרה.</small></div><div class="number-stepper"><button type="button" data-step-field="max_daily_staff" data-step="-1" aria-label="הפחתת מקסימום תקינה">−</button><input name="max_daily_staff" type="number" min="1" max="20" inputmode="numeric" placeholder="ללא" /><button type="button" data-step-field="max_daily_staff" data-step="1" aria-label="הגדלת מקסימום תקינה">＋</button></div>';
      grid.append(card);
    }

    const syncFromState = () => {
      const close = timeToMinutes(state.settings.closing_time || '15:30');
      const windowMinutes = Math.max(0, Number(state.settings.closing_window_minutes || 0));
      if (form.elements.closing_start_time) form.elements.closing_start_time.value = minuteText(close - windowMinutes);
      if (form.elements.max_daily_staff) form.elements.max_daily_staff.value = state.settings.max_daily_staff ?? '';
      syncClosingWindowOption();
      renderV028SettingsExtra();
    };

    function syncClosingWindowOption() {
      const close = timeToMinutes(form.elements.closing_time.value || state.settings.closing_time || '15:30');
      const start = timeToMinutes(form.elements.closing_start_time?.value || minuteText(close));
      const minutes = close - start;
      if (!legacyClosing) return minutes;
      let option = [...legacyClosing.options].find((item) => Number(item.value) === minutes);
      if (!option && minutes >= 0) {
        option = document.createElement('option');
        option.value = String(minutes);
        option.textContent = `${minutes} דקות לפני הסגירה`;
        option.dataset.v028Custom = 'true';
        legacyClosing.append(option);
      }
      if (option) legacyClosing.value = String(minutes);
      return minutes;
    }

    function renderV028SettingsExtra() {
      const preview = document.querySelector('#settingsPreview');
      if (!preview) return;
      preview.querySelector('.v028-settings-extra')?.remove();
      const maxValue = Number(form.elements.max_daily_staff?.value || 0);
      const closingStart = form.elements.closing_start_time?.value || '—';
      const close = form.elements.closing_time.value || '—';
      const extra = document.createElement('div');
      extra.className = 'v028-settings-extra';
      extra.innerHTML = `<div><small>תקן סוף יום</small><strong>${escapeHtml(closingStart)}–${escapeHtml(close)}</strong></div><div><small>מקסימום תקינה</small><strong>${maxValue > 0 ? `${maxValue} עובדים בכיתה` : 'ללא תקרה'}</strong></div>`;
      preview.append(extra);
    }

    function rerenderPreview() {
      const minutes = syncClosingWindowOption();
      const start = form.elements.closing_start_time?.value;
      const close = form.elements.closing_time.value;
      const morningEnd = form.elements.morning_end_time.value;
      if (start && close && (minutes < 0 || minutes > 180 || (minutes > 0 && minutes < 15) || timeToMinutes(start) < timeToMinutes(morningEnd))) {
        const preview = document.querySelector('#settingsPreview');
        if (preview) preview.innerHTML = '<div class="notice error"><strong>תחילת תקן סוף היום אינה תקינה.</strong><br />יש לבחור שעה אחרי תקן הבוקר ועד 3 שעות לפני הסגירה.</div>';
        renderV028SettingsExtra();
        return;
      }
      try { renderSettingsPreview(); } catch {}
      renderV028SettingsExtra();
    }

    document.querySelector('#settingsBtn')?.addEventListener('click', () => requestAnimationFrame(syncFromState));
    form.addEventListener('input', () => requestAnimationFrame(rerenderPreview));
    form.addEventListener('change', () => requestAnimationFrame(rerenderPreview));
    form.addEventListener('click', (event) => {
      if (event.target.closest('[data-step-field]')) setTimeout(rerenderPreview, 0);
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const button = form.querySelector('button[value="default"]');
      const close = timeToMinutes(form.elements.closing_time.value || '15:30');
      const closingStart = timeToMinutes(form.elements.closing_start_time.value || form.elements.closing_time.value || '15:30');
      const closingWindow = close - closingStart;
      const morningRequired = Number(form.elements.morning_required_staff.value || 0);
      const required = Number(form.elements.required_staff.value || 0);
      const closingRequired = Number(form.elements.closing_required_staff.value || 0);
      const maxRaw = String(form.elements.max_daily_staff?.value || '').trim();
      const maxDaily = maxRaw ? Number(maxRaw) : null;

      if (closingWindow < 0 || closingWindow > 180 || (closingWindow > 0 && closingWindow < 15)) return showToast('תחילת תקן סוף היום חייבת להיות בין 15 דקות ל-3 שעות לפני הסגירה, או בדיוק בשעת הסגירה.', 'error');
      if (timeToMinutes(form.elements.closing_start_time.value) < timeToMinutes(form.elements.morning_end_time.value)) return showToast('תחילת תקן סוף היום חייבת להיות אחרי סיום תקן הבוקר.', 'error');
      if (maxDaily !== null && (!Number.isInteger(maxDaily) || maxDaily < Math.max(morningRequired, required, closingRequired) || maxDaily > 20)) return showToast('מקסימום התקינה חייב להיות לפחות כמו התקן הנדרש ובטווח 1–20.', 'error');

      const data = formObject(form);
      delete data.closing_start_time;
      data.closing_window_minutes = closingWindow;
      data.max_daily_staff = maxDaily;
      for (const name of ['morning_required_staff','required_staff','closing_required_staff','validation_slot_minutes']) data[name] = Number(data[name]);
      data.require_leader = form.elements.require_leader.checked;

      setBusy(button, true, 'שומר תקינה…');
      try {
        const result = await apiFetch('/api/settings', { method:'PATCH', body:data });
        state.settings = { ...state.settings, ...(result.settings || data) };
        state.weekCache.clear();
        state.scheduleValidationCache = { key:'', value:null };
        document.querySelector('#settingsDialog')?.close();
        await refreshScheduleWeek({ force:true });
        showToast('הגדרות התקינה נשמרו', 'success');
      } catch (error) { showToast(error.message, 'error'); }
      finally { setBusy(button, false); }
    }, true);

    syncFromState();
  }

  function maxStaffIssues(rows = []) {
    const limit = Number(state.settings.max_daily_staff || 0);
    if (!Number.isInteger(limit) || limit <= 0) return [];
    const issues = [];
    const dates = [...new Set(rows.map((row) => row.shift_date).filter(Boolean))];
    const activeClasses = state.classes.filter((item) => item.active !== false);
    for (const date of dates) {
      for (const classItem of activeClasses) {
        const classRows = rows.filter((row) => row.shift_date === date && row.class_id === classItem.id);
        if (!classRows.length) continue;
        const points = [...new Set(classRows.flatMap((row) => [timeToMinutes(row.start_time), timeToMinutes(row.end_time)]))].sort((a,b)=>a-b);
        let peak = 0; let peakAt = null;
        for (const point of points.slice(0,-1)) {
          const active = new Set(classRows.filter((row) => timeToMinutes(row.start_time) <= point && timeToMinutes(row.end_time) > point).map((row) => row.employee_id));
          if (active.size > peak) { peak = active.size; peakAt = point; }
        }
        if (peak > limit) issues.push({
          id:`max-daily-${date}-${classItem.id}`,
          code:'max_daily_staff', date, classId:classItem.id, class_id:classItem.id,
          time:minuteText(peakAt), start_time:minuteText(peakAt),
          title:'חריגה ממקסימום התקינה',
          text:`${classItem.name}: ${peak} עובדים במקביל במקום מקסימום ${limit}`,
          message:`${classItem.name}: ${peak} עובדים במקביל בשעה ${minuteText(peakAt)} — המקסימום שהוגדר הוא ${limit}`,
        });
      }
    }
    return issues;
  }

  function installMaximumValidation() {
    if (window.__v028MaximumValidationInstalled) return;
    window.__v028MaximumValidationInstalled = true;
    const previousValidate = validateScheduleClient;
    validateScheduleClient = function v028ValidateScheduleClient() {
      const base = previousValidate();
      const errors = (base.errors || []).filter((item) => item.code !== 'max_daily_staff');
      errors.push(...maxStaffIssues(state.shifts));
      return { ...base, errors };
    };

    const previousRenderAuto = renderAutomaticSchedulePreview;
    renderAutomaticSchedulePreview = function v028RenderAutomaticSchedulePreview(preview) {
      if (preview?.validation) {
        const baseErrors = (preview.validation.errors || []).filter((item) => item.code !== 'max_daily_staff');
        preview.validation = { ...preview.validation, errors:[...baseErrors, ...maxStaffIssues(preview.finalRows || [])] };
      }
      return previousRenderAuto(preview);
    };
  }

  function installRequestFixes() {
    if (window.__v028RequestFixesInstalled) return;
    window.__v028RequestFixesInstalled = true;
    try {
      REQUEST_HELP.late_start = 'התחלה מאוחרת — בוחרים תאריך ושעת הגעה. המערכת מאתרת לבד את השיבוץ של העובד.';
      REQUEST_HELP.early_finish = 'סיום מוקדם — בוחרים תאריך ושעת יציאה. המערכת מאתרת לבד את השיבוץ של העובד.';
    } catch {}

    const previousUpdateFields = updateRequestFields;
    updateRequestFields = function v028UpdateRequestFields() {
      previousUpdateFields();
      const form = document.querySelector('#requestForm');
      const field = form?.querySelector('.shift-choice-field');
      if (field) field.classList.add('hidden', 'v028-auto-shift-field');
      if (form?.elements.shift_id) form.elements.shift_id.required = false;
    };

    const previousRenderRequests = renderRequests;
    renderRequests = function v028RenderRequests() {
      const result = previousRenderRequests();
      if (isManager()) {
        for (const request of state.requests.filter((item) => item.status === 'approved')) {
          const card = document.querySelector(`[data-request-id="${request.id}"]`);
          const zone = card?.querySelector('.request-action-zone');
          if (zone && !zone.querySelector('[data-v028-delete-approved]')) {
            zone.insertAdjacentHTML('afterbegin', `<button type="button" class="danger-btn v028-delete-approved" data-v028-delete-approved="${request.id}">מחיקת הבקשה</button>`);
          }
        }
      }
      return result;
    };

    document.querySelector('#requestsList')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-v028-delete-approved]');
      if (!button) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!confirm('למחוק את הבקשה שאושרה? החופשה/ההיעדרות תוסר גם מזמינות הצוות ומלוח השנה.')) return;
      setBusy(button, true, 'מוחק…');
      try {
        await apiFetch('/api/requests', { method:'POST', body:{ action:'delete_approved', id:button.dataset.v028DeleteApproved } });
        await refreshAll();
        showToast('הבקשה המאושרת נמחקה', 'success');
      } catch (error) { showToast(error.message, 'error'); }
      finally { setBusy(button, false); }
    }, true);

    updateRequestFields();
    renderRequests();
  }

  function scheduleEmployeeRows(employeeId) {
    return state.shifts.filter((row) => row.employee_id === employeeId);
  }

  function employeeFocusStats(employeeId) {
    const rows = scheduleEmployeeRows(employeeId);
    const minutes = rows.reduce((sum,row)=>sum+Math.max(0,timeToMinutes(row.end_time)-timeToMinutes(row.start_time)),0);
    return { shifts:rows.length, hours:Math.round(minutes/6)/10 };
  }

  function applyScheduleEmployeeFocus() {
    const employeeId = state.v028ScheduleEmployeeId || '';
    const root = document.querySelector('#scheduleExport');
    if (!root) return;
    root.querySelectorAll('.shift-item[data-shift-id]').forEach((card) => {
      const shift = state.shifts.find((row) => String(row.id) === String(card.dataset.shiftId));
      const match = Boolean(employeeId && shift?.employee_id === employeeId);
      card.classList.toggle('v028-employee-focus', match);
      card.classList.toggle('v028-employee-focus-other', Boolean(employeeId && !match));
    });
    const stats = document.querySelector('#v028ScheduleEmployeeStats');
    if (!stats) return;
    if (!employeeId) { stats.classList.add('hidden'); stats.innerHTML=''; return; }
    const employee = employeeById(employeeId); const summary = employeeFocusStats(employeeId);
    stats.classList.remove('hidden');
    stats.innerHTML = `<span><strong>${escapeHtml(employee?.full_name || 'עובד')}</strong><small>בשבוע הנבחר</small></span><b>${summary.shifts} משמרות</b><b>${summary.hours} שעות</b><button type="button" data-v028-clear-employee aria-label="ניקוי חיפוש">×</button>`;
  }

  function installScheduleEmployeeSearch() {
    const panel = document.querySelector('#schedulePanel');
    if (!panel) return;
    let box = document.querySelector('#v028ScheduleEmployeeSearch');
    if (!box) {
      box = document.createElement('section');
      box.id = 'v028ScheduleEmployeeSearch';
      box.className = 'v028-schedule-search';
      box.innerHTML = '<label><span>חיפוש עובד בשיבוץ</span><div><span aria-hidden="true">⌕</span><input id="v028ScheduleEmployeeInput" type="search" placeholder="הקלידו שם עובד" autocomplete="off" /></div></label><div id="v028ScheduleEmployeeResults" class="v028-schedule-search-results hidden"></div><div id="v028ScheduleEmployeeStats" class="v028-schedule-search-stats hidden"></div>';
      const health = panel.querySelector('.schedule-health-row');
      health?.insertAdjacentElement('beforebegin', box);

      const input = box.querySelector('#v028ScheduleEmployeeInput');
      const results = box.querySelector('#v028ScheduleEmployeeResults');
      const renderResults = () => {
        const term = input.value.trim().toLowerCase();
        state.v028ScheduleSearch = term;
        if (!term) {
          results.classList.add('hidden'); results.innerHTML='';
          state.v028ScheduleEmployeeId=''; applyScheduleEmployeeFocus(); return;
        }
        const rows = state.employees.filter((employee) => employee.active !== false && String(employee.full_name || '').toLowerCase().includes(term)).slice(0,8);
        results.innerHTML = rows.length ? rows.map((employee)=>`<button type="button" data-v028-employee="${employee.id}"><strong>${escapeHtml(employee.full_name)}</strong><small>${escapeHtml(employee.job_title || '')}${fixedClassLabel(employee.id)?` · ${escapeHtml(fixedClassLabel(employee.id))}`:''}</small></button>`).join('') : '<span>לא נמצא עובד</span>';
        results.classList.remove('hidden');
      };
      input.addEventListener('input', renderResults);
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        const first = results.querySelector('[data-v028-employee]');
        if (first) { event.preventDefault(); first.click(); }
      });
      box.addEventListener('click', (event) => {
        const employeeButton = event.target.closest('[data-v028-employee]');
        if (employeeButton) {
          state.v028ScheduleEmployeeId = employeeButton.dataset.v028Employee;
          input.value = employeeById(state.v028ScheduleEmployeeId)?.full_name || '';
          results.classList.add('hidden');
          applyScheduleEmployeeFocus();
          return;
        }
        if (event.target.closest('[data-v028-clear-employee]')) {
          state.v028ScheduleEmployeeId=''; input.value=''; results.classList.add('hidden'); applyScheduleEmployeeFocus(); input.focus();
        }
      });
    }
    applyScheduleEmployeeFocus();
  }

  function installScheduleRenderHook() {
    if (window.__v028ScheduleRenderHook) return;
    window.__v028ScheduleRenderHook = true;
    const previousRender = renderSchedule;
    renderSchedule = function v028RenderSchedule(...args) {
      const result = previousRender(...args);
      requestAnimationFrame(() => { installScheduleEmployeeSearch(); applyScheduleEmployeeFocus(); forceVersion(); });
      return result;
    };
  }

  function labelA4Exports() {
    const weekly = document.querySelector('#printBtn');
    if (weekly) { weekly.textContent = 'PDF שבועי A4'; weekly.title = 'קובץ PDF מוכן להדפסה על A4 לרוחב'; }
    const absences = document.querySelector('#v027AbsencePdfBtn');
    if (absences) { absences.textContent = 'PDF חופשות A4'; absences.title = 'קובץ PDF מוכן להדפסה על A4'; }
  }

  function installV028() {
    if (window.__hadasV028Installed) { forceVersion(); return; }
    window.__hadasV028Installed = true;
    forceVersion();
    installSettingsEnhancements();
    installMaximumValidation();
    installRequestFixes();
    installScheduleRenderHook();
    installScheduleEmployeeSearch();
    labelA4Exports();
    requestAnimationFrame(() => {
      forceVersion();
      try { renderSchedule(); } catch {}
      try { renderRequests(); } catch {}
      labelA4Exports();
    });
    setTimeout(() => { forceVersion(); installSettingsEnhancements(); installScheduleEmployeeSearch(); labelA4Exports(); }, 900);
  }

  loadPreviousPatch();
})();
