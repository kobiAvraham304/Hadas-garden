/* Hadas Garden — forward-compatible bridge for clients still entering through v0.29 */
(() => {
  const LEGACY = '/patch-v029-legacy.js?v=0301';
  const CURRENT = '/patch-v030.js?v=0301';

  function load(src, marker) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-hadas-bridge="${marker}"]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') return resolve();
        existing.addEventListener('load', resolve, { once:true });
        existing.addEventListener('error', reject, { once:true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.dataset.hadasBridge = marker;
      script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve(); }, { once:true });
      script.addEventListener('error', reject, { once:true });
      document.head.append(script);
    });
  }

  async function boot() {
    try {
      await load(LEGACY, 'v029-legacy');
      const currentAlreadyPresent = [...document.scripts].some((script) => /patch-v030\.js(?:\?|$)/.test(script.src));
      if (!currentAlreadyPresent && !window.__hadasV030Installed) {
        await load(CURRENT, 'v030-current');
      }
    } catch (error) {
      console.error('Hadas v0.29→v0.30 bridge failed', error);
    }
  }

  boot();
})();
