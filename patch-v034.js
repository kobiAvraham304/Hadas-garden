/* מערכת ניהול שיבוצים מעון הדס — נוכחות ותפעול יומי 0.34.0 */
(() => {
  const VERSION = '0.34.0';

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
    for (const key of ['__hadasV031VersionObservers', '__hadasV032VersionObservers', '__hadasV033VersionObservers', '__hadasV034VersionObservers']) {
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
    window.__hadasV034VersionObservers = observers;
    pinVersion();
  }

  installVersionGuard();
  window.__hadasV034Installed = true;
  window.__hadasV034BootstrapPromise = Promise.resolve(true);
})();
