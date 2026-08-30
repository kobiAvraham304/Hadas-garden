/* Hadas v0.32 — startup/modal stability guard */
(() => {
  if (window.__hadasV032StabilityInstalled) return;
  window.__hadasV032StabilityInstalled = true;

  const currentProfile = () => (typeof state !== 'undefined' ? state?.profile : null);
  const shellVisible = () => Boolean(document.querySelector('#appShell:not(.hidden)'));

  function tourEligible() {
    const profile = currentProfile();
    return Boolean(
      profile &&
      profile.onboarding_completed === false &&
      shellVisible() &&
      !document.querySelector('#loginScreen:not(.hidden)') &&
      !document.querySelector('#passwordScreen:not(.hidden)')
    );
  }

  function announcementForCurrentUser(item) {
    const profile = currentProfile();
    if (!item || !profile?.id) return false;
    if (item.audience_type === 'all') return true;
    if (item.audience_type === 'class') return item.class_id === profile.primary_class_id;
    if (item.audience_type === 'employees') {
      return (state.announcementRecipients || []).some((row) => row.announcement_id === item.id && row.employee_id === profile.id);
    }
    return false;
  }

  function pushStillEligible(dialog) {
    const profile = currentProfile();
    const itemId = dialog?.dataset?.announcementId;
    if (!profile?.id || !itemId) return false;
    const item = (state.announcements || []).find((row) => String(row.id) === String(itemId));
    if (!item || !item.active || !item.popup_on_login || !announcementForCurrentUser(item)) return false;
    if ((state.announcementReads || []).some((row) => row.announcement_id === item.id && row.employee_id === profile.id)) return false;
    const now = Date.now();
    const publishAt = Date.parse(item.published_at || 0);
    const expiresAt = item.expires_at ? Date.parse(item.expires_at) : null;
    if (Number.isFinite(publishAt) && publishAt > now) return false;
    if (expiresAt && Number.isFinite(expiresAt) && expiresAt < now) return false;
    return shellVisible();
  }

  function closeDialog(dialog) {
    if (!dialog?.open) return;
    try { dialog.close(); } catch {}
  }

  function reconcileAutomaticDialogs() {
    const tour = document.querySelector('#v031TourDialog');
    if (tour && !tourEligible()) {
      closeDialog(tour);
      tour.dataset.started = '';
      document.querySelectorAll('.v031-tour-highlight').forEach((item) => item.classList.remove('v031-tour-highlight'));
    }
    const push = document.querySelector('#v029PushDialog');
    if (push?.open && !pushStillEligible(push)) closeDialog(push);
  }

  /*
   * v0.31 schedules the guided tour 450ms after eligibility is checked.
   * Re-check at the actual showModal() boundary so a profile/screen change
   * can never leave an ineligible modal in the top layer blocking the app.
   */
  if (typeof HTMLDialogElement !== 'undefined' && !window.__hadasV032DialogGateInstalled) {
    const nativeShowModal = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function hadasStableShowModal(...args) {
      if (this.id === 'v031TourDialog' && !tourEligible()) {
        closeDialog(this);
        this.dataset.started = '';
        return undefined;
      }
      if (this.id === 'v029PushDialog' && !pushStillEligible(this)) {
        closeDialog(this);
        return undefined;
      }
      return nativeShowModal.apply(this, args);
    };
    window.__hadasV032DialogGateInstalled = true;
  }

  if (typeof renderAll === 'function' && !window.__hadasV032StableRenderInstalled) {
    const baseRenderAll = renderAll;
    renderAll = function hadasStableRenderAll(...args) {
      const result = baseRenderAll(...args);
      queueMicrotask(reconcileAutomaticDialogs);
      return result;
    };
    window.__hadasV032StableRenderInstalled = true;
  }

  if (typeof refreshAll === 'function' && !window.__hadasV032StableRefreshInstalled) {
    const baseRefreshAll = refreshAll;
    let activeRefresh = null;
    refreshAll = async function hadasStableRefreshAll(...args) {
      if (activeRefresh) return activeRefresh;
      const onboarding = currentProfile()?.onboarding_completed;
      activeRefresh = (async () => {
        try {
          return await baseRefreshAll(...args);
        } finally {
          /* /api/data currently returns a compact profile; preserve the
             auth-me onboarding flag across that replacement. */
          if (currentProfile() && typeof onboarding === 'boolean' && typeof state.profile.onboarding_completed !== 'boolean') {
            state.profile.onboarding_completed = onboarding;
          }
          if (typeof state !== 'undefined') state.refreshing = false;
          const button = document.querySelector('#refreshBtn');
          try { if (button && typeof setBusy === 'function') setBusy(button, false); } catch {}
          try { if (currentProfile() && typeof setSyncState === 'function') setSyncState('online', 'מעודכן בזמן אמת'); } catch {}
          reconcileAutomaticDialogs();
          if (onboarding === false && currentProfile()?.onboarding_completed === false) {
            requestAnimationFrame(() => { try { renderAll(); } catch {} });
          }
        }
      })();
      try { return await activeRefresh; }
      finally { activeRefresh = null; }
    };
    window.__hadasV032StableRefreshInstalled = true;
  }

  const observer = new MutationObserver(() => reconcileAutomaticDialogs());
  observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['open','class'] });
  window.__hadasV032AutoDialogObserver = observer;

  window.addEventListener('pageshow', () => requestAnimationFrame(reconcileAutomaticDialogs));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestAnimationFrame(reconcileAutomaticDialogs); });

  reconcileAutomaticDialogs();
})();
