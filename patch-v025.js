/* מערכת ניהול שיבוצים מעון הדס — נקודת כניסה תואמת לאחור לגרסה 0.32.0 */
(() => {
  const VERSION = '0.32.0';
  const V026 = '/patch-v026.js?v=0320';
  const V032 = '/patch-v032.js?v=0320';

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
    try {
      await loadScript(V026, 'v026');
      await loadScript(V032, 'v032');
      forceVersion();
      window.__hadasCurrentBootstrapReady = true;
    } catch (error) {
      window.__hadasCurrentBootstrapStarted = false;
      console.error('Hadas v0.32 bootstrap failed', error);
      const toast = document.querySelector('#toast');
      if (toast) {
        toast.textContent = 'טעינת עדכון המערכת נכשלה. יש לרענן את הדף.';
        toast.classList.remove('hidden');
      }
    }
  }

  forceVersion();
  bootCurrentInterface();
})();
