/* מערכת ניהול שיבוצים מעון הדס — hotfix הדפסה A4 + ניקוי בחירת יום 0.33.1 */
(() => {
  if (window.__hadasV0331PrintHotfixInstalled) return;
  window.__hadasV0331PrintHotfixInstalled = true;

  const VERSION = '0.33.1';
  const PRINT_DIALOG_ID = 'v0331A4PrintDialog';
  const PRINT_LAYER_ID = 'v0331A4PrintLayer';
  let currentPrintDataUrl = '';

  function managerScheduleView() {
    return Boolean(state?.profile && ['admin', 'scheduler'].includes(state.profile.role));
  }

  function injectStyles() {
    if (document.querySelector('#v0331A4PrintStyles')) return;
    const style = document.createElement('style');
    style.id = 'v0331A4PrintStyles';
    style.textContent = `
      html[data-hadas-role="manager"] #scheduleDayField { display:none !important; }
      #${PRINT_DIALOG_ID} { border:0; padding:0; background:transparent; width:min(1180px, calc(100vw - 20px)); max-width:none; }
      #${PRINT_DIALOG_ID}::backdrop { background:rgba(31,35,58,.56); backdrop-filter:blur(2px); }
      #${PRINT_DIALOG_ID} .v0331-print-card { background:#fff; border-radius:24px; padding:18px; box-shadow:0 24px 70px rgba(31,35,58,.24); }
      #${PRINT_DIALOG_ID} .v0331-print-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:14px; }
      #${PRINT_DIALOG_ID} .v0331-print-head h3 { margin:2px 0 4px; font-size:1.25rem; }
      #${PRINT_DIALOG_ID} .v0331-print-head p { margin:0; color:#6d7185; }
      #${PRINT_DIALOG_ID} .v0331-a4-preview-shell { background:#eef0f7; border-radius:18px; padding:14px; overflow:auto; }
      #${PRINT_DIALOG_ID} .v0331-a4-preview { width:100%; aspect-ratio:297 / 210; background:#fff; box-shadow:0 6px 24px rgba(31,35,58,.12); display:flex; align-items:center; justify-content:center; overflow:hidden; }
      #${PRINT_DIALOG_ID} .v0331-a4-preview img { display:block; width:100%; height:100%; object-fit:contain; }
      #${PRINT_DIALOG_ID} .v0331-print-note { margin:12px 2px 0; color:#676b7e; font-size:.92rem; }
      #${PRINT_DIALOG_ID} .v0331-print-actions { display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap; margin-top:16px; }
      #${PRINT_DIALOG_ID} .v0331-print-actions button { min-height:44px; }
      #${PRINT_LAYER_ID} { display:none; }
      @media (max-width:700px) {
        #${PRINT_DIALOG_ID} { width:calc(100vw - 12px); }
        #${PRINT_DIALOG_ID} .v0331-print-card { border-radius:18px; padding:12px; }
        #${PRINT_DIALOG_ID} .v0331-a4-preview-shell { padding:8px; border-radius:12px; }
        #${PRINT_DIALOG_ID} .v0331-print-actions { display:grid; grid-template-columns:1fr 1fr; }
        #${PRINT_DIALOG_ID} .v0331-print-actions .v0331-print-primary { grid-column:1 / -1; }
      }
      @page { size:A4 landscape; margin:6mm; }
      @media print {
        html, body { margin:0 !important; padding:0 !important; background:#fff !important; }
        body > *:not(#${PRINT_LAYER_ID}) { display:none !important; }
        #${PRINT_LAYER_ID} { display:flex !important; position:fixed !important; inset:0 !important; width:100% !important; height:100% !important; align-items:center !important; justify-content:center !important; background:#fff !important; overflow:hidden !important; }
        #${PRINT_LAYER_ID} img { display:block !important; width:100% !important; height:100% !important; object-fit:contain !important; }
      }
    `;
    document.head.append(style);
  }

  function hideRedundantDaySelector() {
    if (!managerScheduleView()) return;
    const field = document.querySelector('#scheduleDayField');
    if (!field) return;
    field.classList.add('hidden');
    field.hidden = true;
    field.setAttribute('aria-hidden', 'true');
  }

  function composeA4Canvas(sourceCanvas) {
    if (!sourceCanvas?.width || !sourceCanvas?.height) throw new Error('לא ניתן להכין את תצוגת השבוע להדפסה');
    const page = document.createElement('canvas');
    page.width = 2480;
    page.height = 1754;
    const ctx = page.getContext('2d');
    const padding = 54;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, page.width, page.height);
    const scale = Math.min((page.width - padding * 2) / sourceCanvas.width, (page.height - padding * 2) / sourceCanvas.height);
    const width = Math.max(1, Math.round(sourceCanvas.width * scale));
    const height = Math.max(1, Math.round(sourceCanvas.height * scale));
    const x = Math.round((page.width - width) / 2);
    const y = Math.round((page.height - height) / 2);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sourceCanvas, x, y, width, height);
    return page;
  }

  function ensurePrintLayer() {
    let layer = document.querySelector('#' + PRINT_LAYER_ID);
    if (!layer) {
      layer = document.createElement('div');
      layer.id = PRINT_LAYER_ID;
      layer.setAttribute('aria-hidden', 'true');
      layer.innerHTML = '<img alt="שיבוץ שבועי להדפסה">';
      document.body.append(layer);
    }
    return layer;
  }

  function ensurePrintDialog() {
    let dialog = document.querySelector('#' + PRINT_DIALOG_ID);
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = PRINT_DIALOG_ID;
    dialog.className = 'modal v0331-a4-print-dialog';
    dialog.innerHTML = `
      <section class="v0331-print-card">
        <div class="v0331-print-head">
          <div><small class="eyebrow">שיבוץ שבועי</small><h3>הדפסה A4 לרוחב</h3><p>תצוגת השבוע כעמוד אחד, מותאם להדפסה.</p></div>
          <button type="button" class="icon-btn" data-v0331-print-close aria-label="סגירה">×</button>
        </div>
        <div class="v0331-a4-preview-shell"><div class="v0331-a4-preview"><img data-v0331-print-preview alt="תצוגה מקדימה של השיבוץ השבועי"></div></div>
        <p class="v0331-print-note">ההדפסה נשארת בתוך המערכת ולא מעבירה אותך לעמוד אחר. מומלץ לבחור במדפסת “לרוחב” אם הדפדפן אינו בוחר זאת אוטומטית.</p>
        <div class="v0331-print-actions">
          <button type="button" class="ghost-btn" data-v0331-print-close>סגירה</button>
          <button type="button" class="secondary-btn" data-v0331-print-save>שמירת תמונה</button>
          <button type="button" class="primary-btn v0331-print-primary" data-v0331-print-now>🖨️ הדפסה</button>
        </div>
      </section>`;
    document.body.append(dialog);
    dialog.querySelectorAll('[data-v0331-print-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
    dialog.querySelector('[data-v0331-print-now]')?.addEventListener('click', () => {
      if (!currentPrintDataUrl) return showToast('אין תצוגה מוכנה להדפסה', 'error');
      const layer = ensurePrintLayer();
      layer.querySelector('img').src = currentPrintDataUrl;
      try { window.print(); }
      catch { showToast('הדפדפן לא הצליח לפתוח את חלון ההדפסה. אפשר לשמור את התמונה ולהדפיס אותה.', 'error'); }
    });
    dialog.querySelector('[data-v0331-print-save]')?.addEventListener('click', () => {
      if (!currentPrintDataUrl) return;
      const link = document.createElement('a');
      link.href = currentPrintDataUrl;
      link.download = `שיבוץ-שבועי-A4-${dateISO(state.weekStart)}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      showToast('תמונת השיבוץ מוכנה לשמירה', 'success');
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      dialog.close();
    });
    return dialog;
  }

  async function openA4PrintPreview(event) {
    if (!managerScheduleView()) return;
    const button = event.currentTarget;
    if (typeof setBusy === 'function') setBusy(button, true, 'מכין A4…');
    try {
      await document.fonts?.ready;
      if (typeof drawWeeklyScheduleCanvas !== 'function') throw new Error('מנגנון יצוא השבוע אינו זמין');
      const source = drawWeeklyScheduleCanvas();
      const page = composeA4Canvas(source);
      currentPrintDataUrl = page.toDataURL('image/png', 1);
      const dialog = ensurePrintDialog();
      const preview = dialog.querySelector('[data-v0331-print-preview]');
      preview.src = currentPrintDataUrl;
      if (!dialog.open) dialog.showModal();
    } catch (error) {
      showToast(error?.message || 'הכנת ההדפסה נכשלה', 'error');
    } finally {
      if (typeof setBusy === 'function') setBusy(button, false);
    }
  }

  function replacePrintButton(button) {
    if (!button || button.dataset.v0331A4Print === 'true') return button;
    const clone = button.cloneNode(true);
    clone.dataset.v0331A4Print = 'true';
    clone.textContent = '🖨️ הדפסה A4';
    clone.title = 'תצוגה מקדימה והדפסת השיבוץ השבועי בעמוד A4 לרוחב';
    button.replaceWith(clone);
    clone.addEventListener('click', openA4PrintPreview);
    return clone;
  }

  function installPrintButton() {
    if (!managerScheduleView()) return;
    const dedicated = document.querySelector('#v031PrintBtn');
    if (dedicated) replacePrintButton(dedicated);
    else replacePrintButton(document.querySelector('#printBtn'));
  }

  function applyUiFixes() {
    injectStyles();
    hideRedundantDaySelector();
    installPrintButton();
    document.documentElement.dataset.hadasHotfix = VERSION + '-a4';
  }

  function installHooks() {
    if (typeof renderAll === 'function' && !window.__hadasV0331RenderAllHotfix) {
      const previousRenderAll = renderAll;
      renderAll = function v0331HotfixRenderAll(...args) {
        const result = previousRenderAll(...args);
        requestAnimationFrame(applyUiFixes);
        return result;
      };
      window.__hadasV0331RenderAllHotfix = true;
    }

    const schedulePanel = document.querySelector('#schedulePanel');
    if (schedulePanel && !schedulePanel.dataset.v0331HotfixObserver) {
      schedulePanel.dataset.v0331HotfixObserver = 'true';
      const observer = new MutationObserver(() => requestAnimationFrame(applyUiFixes));
      observer.observe(schedulePanel, { childList:true, subtree:true, attributes:true, attributeFilter:['class','hidden'] });
      window.__hadasV0331ScheduleObserver = observer;
    }
  }

  injectStyles();
  installHooks();
  requestAnimationFrame(applyUiFixes);
})();
