/* מערכת ניהול שיבוצים מעון הדס — נקודת כניסה תואמת לאחור לגרסה 0.32.0 */
(() => {
  const VERSION = '0.32.0';
  const V026 = '/patch-v026.js?v=0320';
  const V032 = '/patch-v032.js?v=0320';
  let loadingFallbackTimer = null;

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

  function loadingIsVisible() {
    const loading = document.querySelector('#loadingScreen');
    return Boolean(loading && !loading.classList.contains('hidden'));
  }

  function recoverFromStuckLoading(reason = '') {
    if (!loadingIsVisible()) return false;
    try {
      const hasProfile = typeof state !== 'undefined' && Boolean(state?.profile);
      if (typeof setScreen === 'function') {
        setScreen(hasProfile ? 'appShell' : 'loginScreen');
        if (hasProfile) {
          try { if (typeof applyPermissions === 'function') applyPermissions(); } catch {}
          try { if (typeof switchTab === 'function') switchTab(state.activeTab || 'dashboard'); } catch {}
          try { if (typeof refreshAll === 'function') Promise.resolve(refreshAll()).catch(() => {}); } catch {}
        }
      } else {
        document.querySelector('#loadingScreen')?.classList.add('hidden');
        document.querySelector('#loginScreen')?.classList.remove('hidden');
      }
      if (reason) console.warn(`Hadas startup recovery: ${reason}`);
      return true;
    } catch (error) {
      console.error('Hadas startup recovery failed', error);
      return false;
    }
  }

  function armLoadingWatchdog() {
    clearTimeout(loadingFallbackTimer);
    loadingFallbackTimer = setTimeout(() => {
      if (!loadingIsVisible()) return;
      recoverFromStuckLoading('loading watchdog');
    }, 4500);
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
      script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve(); }, { once:true });
      script.addEventListener('error', () => reject(new Error(`לא ניתן לטעון ${src}`)), { once:true });
      document.head.append(script);
    });
  }

  async function bootCurrentInterface() {
    if (window.__hadasCurrentBootstrapStarted) return;
    window.__hadasCurrentBootstrapStarted = true;
    forceVersion();
    armLoadingWatchdog();
    try {
      await loadScript(V026, 'v026');
      await loadScript(V032, 'v032');
      forceVersion();
      window.__hadasCurrentBootstrapReady = true;
      if (loadingIsVisible()) setTimeout(() => recoverFromStuckLoading('bootstrap completed while loading screen remained visible'), 250);
    } catch (error) {
      window.__hadasCurrentBootstrapStarted = false;
      console.error('Hadas v0.32 bootstrap failed', error);
      recoverFromStuckLoading('bootstrap error');
      const toast = document.querySelector('#toast');
      if (toast) {
        toast.textContent = 'טעינת עדכון המערכת נכשלה. יש לרענן את הדף.';
        toast.classList.remove('hidden');
      }
    }
  }

  window.addEventListener('error', () => {
    if (loadingIsVisible()) setTimeout(() => recoverFromStuckLoading('window error during startup'), 0);
  });
  window.addEventListener('unhandledrejection', () => {
    if (loadingIsVisible()) setTimeout(() => recoverFromStuckLoading('unhandled rejection during startup'), 0);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && loadingIsVisible()) armLoadingWatchdog();
  });

  forceVersion();
  armLoadingWatchdog();
  bootCurrentInterface();
})();
