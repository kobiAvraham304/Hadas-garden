/* מערכת ניהול שיבוצים מעון הדס — bootstrap יציב לגרסה 0.35.0 */
(() => {
  const VERSION = '0.35.0';
  const V026 = '/patch-v026.js?v=0321';
  const V033 = '/patch-v033.js?v=0333';
  const HOTFIX = '/patch-v0331-hotfix.js?v=0331hf2';
  const V034 = '/patch-v034.js?v=0350';
  const V0342 = '/patch-v0342.js?v=0350';
  const V0343 = '/patch-v0343.js?v=0350';
  const V0345 = '/patch-v0345.js?v=0350';

  let releaseApiGate;
  let gateReleased = false;
  const bootstrapReady = new Promise((resolve) => { releaseApiGate = resolve; });
  const baseApiFetch = typeof apiFetch === 'function' ? apiFetch : null;

  function forceVersion() {
    window.__HADAS_RELEASE_VERSION = VERSION;
    const badge = document.querySelector('#appVersionBadge');
    if (badge) {
      badge.textContent = `v${VERSION}`;
      badge.title = `גרסת מערכת ${VERSION}`;
    }
    const login = document.querySelector('#loginVersion');
    if (login) login.textContent = `גרסה ${VERSION}`;
    document.documentElement.dataset.hadasVersion = VERSION;
  }

  function releaseGate() {
    if (gateReleased) return;
    gateReleased = true;
    window.__hadasCurrentBootstrapReady = true;
    releaseApiGate();
    window.dispatchEvent(new CustomEvent('hadas:bootstrap-ready', { detail:{ version:VERSION } }));
  }

  if (baseApiFetch) {
    apiFetch = async function bootstrapGatedApiFetch(...args) {
      await bootstrapReady;
      return baseApiFetch(...args);
    };
  }

  function appShellVisible() {
    const shell = document.querySelector('#appShell');
    return Boolean(shell && !shell.classList.contains('hidden'));
  }

  function closeTourIfUnsafe(dialog = document.querySelector('#v031TourDialog')) {
    if (!dialog?.open) return;
    const loggedIn = typeof state !== 'undefined' && Boolean(state?.profile);
    if (!loggedIn || !appShellVisible()) {
      try { dialog.close(); } catch {}
      dialog.dataset.started = '';
      document.querySelectorAll('.v031-tour-highlight').forEach((item) => item.classList.remove('v031-tour-highlight'));
    }
  }

  function guardTourDialog(dialog) {
    if (!dialog || dialog.dataset.bootstrapGuarded === 'true') return;
    dialog.dataset.bootstrapGuarded = 'true';
    const observer = new MutationObserver(() => closeTourIfUnsafe(dialog));
    observer.observe(dialog, { attributes:true, attributeFilter:['open'] });
    closeTourIfUnsafe(dialog);
  }

  function installTourSafety() {
    guardTourDialog(document.querySelector('#v031TourDialog'));
    const bodyObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
          if (!(node instanceof Element)) continue;
          if (node.id === 'v031TourDialog') guardTourDialog(node);
          else guardTourDialog(node.querySelector?.('#v031TourDialog'));
        }
      }
    });
    bodyObserver.observe(document.body, { childList:true, subtree:true });

    if (typeof setScreen === 'function' && !window.__hadasSafeSetScreenInstalled) {
      const originalSetScreen = setScreen;
      setScreen = function safeSetScreen(id) {
        const result = originalSetScreen(id);
        if (id !== 'appShell') queueMicrotask(() => closeTourIfUnsafe());
        return result;
      };
      window.__hadasSafeSetScreenInstalled = true;
    }
  }

  function loadScript(src, marker) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-hadas-bootstrap="${marker}"]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') return resolve();
        existing.addEventListener('load', resolve, { once:true });
        existing.addEventListener('error', reject, { once:true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.dataset.hadasBootstrap = marker;
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once:true });
      script.addEventListener('error', () => reject(new Error(`לא ניתן לטעון ${src}`)), { once:true });
      document.head.append(script);
    });
  }

  async function bootCurrentInterface() {
    if (window.__hadasCurrentBootstrapStarted) return;
    window.__hadasCurrentBootstrapStarted = true;
    forceVersion();
    installTourSafety();

    try {
      await loadScript(V026, 'v026');
      await loadScript(V033, 'v033');
      if (window.__hadasV033BootstrapPromise) {
        const currentReady = await window.__hadasV033BootstrapPromise;
        if (!currentReady) throw new Error('שכבות הממשק לא סיימו להיטען');
      }
      await loadScript(HOTFIX, 'v0331-hotfix');
      await loadScript(V034, 'v034');
      if (window.__hadasV034BootstrapPromise) {
        const currentReady = await window.__hadasV034BootstrapPromise;
        if (!currentReady) throw new Error('עדכון הנוכחות והתפעול לא סיים להיטען');
      }
      await loadScript(V0342, 'v0342');
      if (window.__hadasV0342BootstrapPromise) {
        const schedulingReady = await window.__hadasV0342BootstrapPromise;
        if (!schedulingReady) throw new Error('עדכון ההדפסה והשיבוץ לא סיים להיטען');
      }
      await loadScript(V0343, 'v0343');
      await loadScript(V0345, 'v0345');
      forceVersion();
    } catch (error) {
      console.error('Hadas v0.35.0 bootstrap failed', error);
      const toast = document.querySelector('#toast');
      if (toast) {
        toast.textContent = 'טעינת עדכון המערכת נכשלה. המערכת תמשיך במצב בסיסי; מומלץ לרענן.';
        toast.classList.remove('hidden');
      }
    } finally {
      releaseGate();
    }
  }

  forceVersion();
  bootCurrentInterface();
})();
