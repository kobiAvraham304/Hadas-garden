/* מערכת ניהול שיבוצים מעון הדס — bootstrap גרסה 0.32.1 */
(() => {
  const VERSION = '0.32.1';
  const PREVIOUS = '/patch-v031.js?v=0321';
  const CURRENT_FILES = [
    '/patch-v032-core.js?v=0321',
    '/patch-v032-exports.js?v=0321',
    '/patch-v032-ux.js?v=0321',
    '/patch-v032-stability.js?v=0321',
  ];

  function pin() {
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

  function load(src, marker) {
    return new Promise((resolve, reject) => {
      const old = document.querySelector(`script[data-hadas-v032="${marker}"]`);
      if (old) {
        if (old.dataset.loaded === 'true') return resolve();
        old.addEventListener('load', resolve, { once:true });
        old.addEventListener('error', reject, { once:true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.dataset.hadasV032 = marker;
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once:true });
      script.addEventListener('error', () => reject(new Error(`לא ניתן לטעון ${src}`)), { once:true });
      document.head.append(script);
    });
  }

  function waitForFlag(flag, timeout = 15000) {
    if (window[flag]) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (window[flag]) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started >= timeout) {
          clearInterval(timer);
          reject(new Error(`אתחול ${flag} לא הסתיים בזמן`));
        }
      }, 25);
    });
  }

  async function boot() {
    if (window.__hadasV032Installed) return true;
    pin();
    try {
      /* Loading the file is not enough: v0.31 installs v0.27-v0.30
         asynchronously. Wait for the complete legacy chain before wrapping it. */
      await load(PREVIOUS, 'previous');
      await waitForFlag('__hadasV031Installed');
      /* v0.31 deliberately pins its own version text with observers. Once the
         full previous layer is ready, retire those observers so v0.32.1 owns
         the displayed release without a mutation loop. */
      (window.__hadasV031VersionObservers || []).forEach((observer) => {
        try { observer?.disconnect(); } catch {}
      });
      window.__hadasV031VersionObservers = [];
      for (let index = 0; index < CURRENT_FILES.length; index += 1) {
        await load(CURRENT_FILES[index], `current-${index}`);
      }
      window.__hadasV032Installed = true;
      pin();
      return true;
    } catch (error) {
      console.error('Hadas v0.32.1 bootstrap failed', error);
      try { showToast('טעינת שכבות הממשק נכשלה. המערכת תעלה במצב בסיסי.', 'error'); } catch {}
      return false;
    }
  }

  pin();
  if (!window.__hadasV032BootstrapPromise) window.__hadasV032BootstrapPromise = boot();
})();
