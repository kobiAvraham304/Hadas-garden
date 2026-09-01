/* מעון הדס — בדיקות תקינות ללא הבהוב שגוי בזמן סנכרון */
(() => {
  if (window.__hadasV0345ValidationSyncInstalled) return;
  window.__hadasV0345ValidationSyncInstalled = true;

  const previousValidateScheduleClient = typeof validateScheduleClient === 'function' ? validateScheduleClient : null;
  const previousRenderSchedule = typeof renderSchedule === 'function' ? renderSchedule : null;
  if (!previousValidateScheduleClient || !previousRenderSchedule) return;

  state.v0345ValidationPending = false;
  state.v0345ValidationPromise = null;

  function validationKey() {
    const week = dateISO(state.weekStart);
    const shifts = (state.shifts || []).map((row) =>
      `${row.id}:${row.updated_at || ''}:${row.shift_date}:${row.class_id}:${row.employee_id}:${trimTime(row.start_time)}:${trimTime(row.end_time)}`
    ).sort().join(';');
    return `${week}|${shifts}`;
  }

  function validationIsCurrent() {
    if (!isManager()) return true;
    return Boolean(
      state.v030Validation &&
      state.v030Validation.weekStart === dateISO(state.weekStart) &&
      state.v030ValidationKey === validationKey()
    );
  }

  function markValidationUiPending() {
    if (!isManager() || validationIsCurrent()) return;
    const toggle = document.querySelector('#scheduleIssuesToggle');
    const count = document.querySelector('#scheduleIssuesCount');
    const panel = document.querySelector('#scheduleWarnings');
    if (toggle) {
      toggle.classList.remove('has-errors', 'has-warnings', 'is-ok');
      toggle.classList.add('v0345-validation-syncing');
      const icon = toggle.querySelector('i');
      if (icon) icon.textContent = '↻';
    }
    if (count) count.textContent = 'מסנכרן בדיקות…';
    if (panel && state.scheduleIssuesOpen) {
      panel.classList.remove('hidden');
      panel.innerHTML = '<div class="v0345-validation-loading"><span></span><div><strong>מסנכרן את בדיקות התקינות</strong><small>האישורים שכבר נשמרו נטענים לפני הצגת תוצאות.</small></div></div>';
    }
  }

  function clearValidationUiPending() {
    document.querySelector('#scheduleIssuesToggle')?.classList.remove('v0345-validation-syncing');
  }

  validateScheduleClient = function v0345ValidateScheduleClient(...args) {
    /* Managers must never see raw client errors before server-side approvals are known. */
    if (isManager() && !validationIsCurrent()) return { errors: [], warnings: [], pending: true };
    return previousValidateScheduleClient.apply(this, args);
  };

  async function waitForLegacyValidation(timeout = 12500) {
    const started = Date.now();
    while (state.v030ValidationLoading && Date.now() - started < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
  }

  async function ensureValidationCurrent({ force = false } = {}) {
    if (!isManager() || validationIsCurrent()) return true;
    if (state.v0345ValidationPromise) return state.v0345ValidationPromise;

    state.v0345ValidationPending = true;
    markValidationUiPending();
    state.v0345ValidationPromise = (async () => {
      try {
        await waitForLegacyValidation();
        if (!force && validationIsCurrent()) return true;
        if (typeof window.__hadasV030RefreshValidation !== 'function') return false;
        await window.__hadasV030RefreshValidation({ force: true, rerender: false });
        await waitForLegacyValidation();
        return validationIsCurrent();
      } catch (error) {
        console.warn('Hadas validation sync failed', error);
        return false;
      } finally {
        state.v0345ValidationPending = false;
        state.v0345ValidationPromise = null;
      }
    })();
    return state.v0345ValidationPromise;
  }

  renderSchedule = function v0345RenderSchedule(...args) {
    const result = previousRenderSchedule.apply(this, args);
    requestAnimationFrame(() => {
      if (!validationIsCurrent()) markValidationUiPending();
      else clearValidationUiPending();
    });
    return result;
  };

  /*
   * v0.30 used to invalidate approvals on every weekly refresh and then render
   * the raw client validator before the server replied. Refresh the week first,
   * compare the deterministic validation key, and only revalidate when the
   * actual schedule changed. Rendering happens after the approval state is ready.
   */
  if (typeof refreshScheduleWeek === 'function' && typeof fetchScheduleWeek === 'function' && typeof applySchedulePayload === 'function') {
    refreshScheduleWeek = async function v0345RefreshScheduleWeek({ force = true } = {}) {
      const weekAtStart = dateISO(state.weekStart);
      const beforeKey = validationKey();
      const hadCurrentValidation = validationIsCurrent();
      state.scheduleLoading = true;
      document.body.classList.add('schedule-is-loading');
      try {
        const payload = await fetchScheduleWeek(state.weekStart, { force, apply: false });
        if (weekAtStart !== dateISO(state.weekStart)) return payload;
        applySchedulePayload(payload);

        const today = dateISO(new Date());
        if (currentWeekDates().some((date) => dateISO(date) === today)) {
          state.todayShifts = (state.shifts || []).filter((shift) => shift.shift_date === today);
        }

        const afterKey = validationKey();
        const scheduleUnchanged = beforeKey === afterKey;
        if (!(hadCurrentValidation && scheduleUnchanged)) {
          await ensureValidationCurrent({ force: true });
        }
        renderSchedule();
        return payload;
      } catch (error) {
        showToast(error.message || 'טעינת השיבוץ נכשלה', 'error');
        throw error;
      } finally {
        state.scheduleLoading = false;
        document.body.classList.remove('schedule-is-loading');
      }
    };
  }

  /* A tab revisit only needs a background check if the schedule itself changed. */
  window.__hadasV0345EnsureValidation = ensureValidationCurrent;

  const style = document.createElement('style');
  style.textContent = `
    #scheduleIssuesToggle.v0345-validation-syncing{border-color:#dfe1eb!important;background:#f7f8fb!important;color:#666c80!important;box-shadow:none!important}
    #scheduleIssuesToggle.v0345-validation-syncing i{animation:v0345-spin .8s linear infinite}
    .v0345-validation-loading{display:flex;align-items:center;gap:12px;padding:16px;border:1px solid #e0e2eb;border-radius:16px;background:#fafbfc;color:#62687a}
    .v0345-validation-loading>span{width:18px;height:18px;border:2px solid #d5d8e3;border-top-color:#7478e7;border-radius:50%;animation:v0345-spin .8s linear infinite;flex:0 0 auto}
    .v0345-validation-loading strong,.v0345-validation-loading small{display:block}.v0345-validation-loading small{margin-top:3px}
    @keyframes v0345-spin{to{transform:rotate(360deg)}}
  `;
  document.head.append(style);

  /* If a validation request from the older layer is already running at startup, never paint its temporary raw result. */
  if (isManager() && !validationIsCurrent()) {
    state.v0345ValidationPending = true;
    requestAnimationFrame(markValidationUiPending);
    ensureValidationCurrent({ force: false }).then(() => {
      if (state.activeTab === 'schedule') renderSchedule();
    });
  }
})();
