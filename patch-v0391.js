/* מעון הדס — תיקוני ממשק ויציבות 0.39.1 */
(() => {
  if (window.__hadasV0391Ready) return;

  const VERSION = '0.39.3';

  function generalDaysOffRows() {
    const rows = [];
    const seen = new Set();
    for (const source of [state?.generalDaysOff || [], state?.calendarEvents || []]) {
      for (const row of source) {
        if (!row?.is_general_day_off && row?.event_type !== 'general_day_off') continue;
        const key = String(row.id || row.event_date || row.date || '');
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }
    }
    return rows;
  }

  function generalDayOffFor(dateValue) {
    const iso = typeof dateValue === 'string' ? dateValue : dateISO(dateValue);
    return generalDaysOffRows().find((row) => String(row.event_date || row.date || '') === iso) || null;
  }

  function closureMarkup(off) {
    const title = String(off?.title || 'יום חופשי').trim() || 'יום חופשי';
    const description = String(off?.description || '').trim();
    return '<div class="v0391-personal-general-off" role="note" aria-label="חופש כללי">' +
      '<span class="v0391-general-off-icon" aria-hidden="true">☀</span>' +
      '<div><strong>חופש כללי</strong><b>' + escapeHtml(title) + '</b>' +
      (description ? '<small>' + escapeHtml(description) + '</small>' : '') +
      '</div></div>';
  }

  function enhancePersonalScheduleRoot(root) {
    if (!root) return;
    const cards = [...root.querySelectorAll('.v033-personal-day')];
    if (!cards.length) return;
    const dates = Array.from({ length:6 }, (_, index) => addDays(state.weekStart, index));

    cards.slice(0, 6).forEach((card, index) => {
      const iso = dateISO(dates[index]);
      const off = generalDayOffFor(iso);
      card.querySelectorAll('.v0391-personal-general-off').forEach((item) => item.remove());
      card.classList.toggle('v0391-personal-general-day', Boolean(off));
      card.dataset.v0391ClosureDate = off ? iso : '';

      if (!off) return;
      card.querySelector('.v033-personal-empty')?.remove();
      const header = card.querySelector('header');
      if (header) header.insertAdjacentHTML('afterend', closureMarkup(off));
      else card.insertAdjacentHTML('afterbegin', closureMarkup(off));
    });
  }

  function enhancePersonalSchedules() {
    enhancePersonalScheduleRoot(document.querySelector('#scheduleExport'));
    enhancePersonalScheduleRoot(document.querySelector('#v033DashboardWeek'));
  }

  function removeDuplicateAutoWeekSummary() {
    document.querySelectorAll('#autoScheduleDialog .v032-auto-week-selected').forEach((item) => item.remove());
  }

  function ensureFeedbackCredit() {
    const modal = document.querySelector('#feedbackDialog .feedback-modal');
    if (!modal || modal.querySelector('.v0391-feedback-credit')) return;
    const credit = document.createElement('small');
    credit.className = 'v0391-feedback-credit';
    credit.textContent = 'פיתוח: קובי אברהם';
    modal.append(credit);
  }

  function applyUiFixes() {
    enhancePersonalSchedules();
    removeDuplicateAutoWeekSummary();
    ensureFeedbackCredit();
  }

  if (typeof renderSchedule === 'function' && !window.__hadasV0391RenderScheduleWrapped) {
    const previous = renderSchedule;
    renderSchedule = function v0391RenderSchedule(...args) {
      const result = previous.apply(this, args);
      requestAnimationFrame(enhancePersonalSchedules);
      return result;
    };
    window.__hadasV0391RenderScheduleWrapped = true;
  }

  if (typeof renderAll === 'function' && !window.__hadasV0391RenderAllWrapped) {
    const previous = renderAll;
    renderAll = function v0391RenderAll(...args) {
      const result = previous.apply(this, args);
      requestAnimationFrame(applyUiFixes);
      return result;
    };
    window.__hadasV0391RenderAllWrapped = true;
  }

  if (typeof openAutoScheduleDialog === 'function' && !window.__hadasV0391AutoDialogWrapped) {
    const previous = openAutoScheduleDialog;
    openAutoScheduleDialog = function v0391OpenAutoScheduleDialog(...args) {
      const result = previous.apply(this, args);
      requestAnimationFrame(removeDuplicateAutoWeekSummary);
      return result;
    };
    window.__hadasV0391AutoDialogWrapped = true;
  }

  if (typeof openFeedbackDialog === 'function' && !window.__hadasV0391FeedbackWrapped) {
    const previous = openFeedbackDialog;
    openFeedbackDialog = async function v0391OpenFeedbackDialog(...args) {
      ensureFeedbackCredit();
      return previous.apply(this, args);
    };
    window.__hadasV0391FeedbackWrapped = true;
  }

  const autoDialog = document.querySelector('#autoScheduleDialog');
  if (autoDialog && !autoDialog.dataset.v0391Cleanup) {
    autoDialog.dataset.v0391Cleanup = 'true';
    const scheduleCleanup = () => requestAnimationFrame(removeDuplicateAutoWeekSummary);
    autoDialog.addEventListener('click', scheduleCleanup, true);
    autoDialog.addEventListener('change', scheduleCleanup, true);
  }

  function forceVersion() {
    window.__HADAS_RELEASE_VERSION = VERSION;
    document.documentElement.dataset.hadasVersion = VERSION;
    const badge = document.querySelector('#appVersionBadge');
    if (badge) {
      badge.textContent = 'v' + VERSION;
      badge.title = 'גרסת מערכת ' + VERSION;
    }
    const login = document.querySelector('#loginVersion');
    if (login) login.textContent = 'גרסה ' + VERSION;
  }

  forceVersion();
  applyUiFixes();
  window.__hadasV0391Ready = true;
})();
