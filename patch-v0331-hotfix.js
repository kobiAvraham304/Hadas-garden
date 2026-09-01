/* מערכת ניהול שיבוצים מעון הדס — hotfix הדפסה A4 + ניקוי בחירת יום 0.34.0 */
(() => {
  if (window.__hadasV0331PrintHotfixInstalled) return;
  window.__hadasV0331PrintHotfixInstalled = true;

  const VERSION = '0.34.0';
  const PRINT_DIALOG_ID = 'v0331A4PrintDialog';
  let currentPrintDataUrl = '';

  function managerScheduleView() {
    return Boolean(state?.profile && ['admin', 'scheduler'].includes(state.profile.role));
  }

  function injectStyles() {
    if (document.querySelector('#v0331A4PrintStyles')) return;
    const style = document.createElement('style');
    style.id = 'v0331A4PrintStyles';
    style.textContent = `
      #${PRINT_DIALOG_ID} { border:0; padding:0; background:transparent; width:min(1180px, calc(100vw - 20px)); max-width:none; }
      #${PRINT_DIALOG_ID}::backdrop { background:rgba(31,35,58,.56); backdrop-filter:blur(2px); }
      #${PRINT_DIALOG_ID} .v0331-print-card { background:#fff; border-radius:24px; padding:18px; box-shadow:0 24px 70px rgba(31,35,58,.24); }
      #${PRINT_DIALOG_ID} .v0331-print-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:14px; }
      #${PRINT_DIALOG_ID} .v0331-print-head h3 { margin:2px 0 4px; font-size:1.25rem; }
      #${PRINT_DIALOG_ID} .v0331-print-head p { margin:0; color:#6d7185; }
      #${PRINT_DIALOG_ID} .v0331-a4-preview-shell { background:#eef0f7; border-radius:18px; padding:10px; overflow:auto; }
      #${PRINT_DIALOG_ID} .v0331-a4-preview { width:100%; aspect-ratio:297 / 210; background:#fff; box-shadow:0 6px 24px rgba(31,35,58,.12); display:flex; align-items:center; justify-content:center; overflow:hidden; }
      #${PRINT_DIALOG_ID} .v0331-a4-preview img { display:block; width:100%; height:100%; object-fit:contain; }
      #${PRINT_DIALOG_ID} .v0331-print-note { margin:12px 2px 0; color:#676b7e; font-size:.92rem; }
      #${PRINT_DIALOG_ID} .v0331-print-actions { display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap; margin-top:16px; }
      #${PRINT_DIALOG_ID} .v0331-print-actions button { min-height:44px; }
      @media (max-width:700px) {
        #${PRINT_DIALOG_ID} { width:calc(100vw - 12px); }
        #${PRINT_DIALOG_ID} .v0331-print-card { border-radius:18px; padding:12px; }
        #${PRINT_DIALOG_ID} .v0331-a4-preview-shell { padding:6px; border-radius:12px; }
        #${PRINT_DIALOG_ID} .v0331-print-actions { display:grid; grid-template-columns:1fr 1fr; }
        #${PRINT_DIALOG_ID} .v0331-print-actions .v0331-print-primary { grid-column:1 / -1; }
      }
    `;
    document.head.append(style);
  }

  function hideRedundantDaySelector() {
    if (!managerScheduleView()) return;
    const field = document.querySelector('#scheduleDayField');
    if (!field) return;
    const visible = state?.scheduleMode === 'day';
    field.hidden = false;
    field.classList.toggle('hidden', !visible);
    field.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  function cropCanvasToContent(sourceCanvas) {
    if (!sourceCanvas?.width || !sourceCanvas?.height) return sourceCanvas;

    const maxProbeWidth = 1200;
    const maxProbeHeight = 850;
    const probeScale = Math.min(1, maxProbeWidth / sourceCanvas.width, maxProbeHeight / sourceCanvas.height);
    const probe = document.createElement('canvas');
    probe.width = Math.max(1, Math.round(sourceCanvas.width * probeScale));
    probe.height = Math.max(1, Math.round(sourceCanvas.height * probeScale));
    const probeCtx = probe.getContext('2d', { willReadFrequently:true });
    probeCtx.fillStyle = '#ffffff';
    probeCtx.fillRect(0, 0, probe.width, probe.height);
    probeCtx.drawImage(sourceCanvas, 0, 0, probe.width, probe.height);

    let image;
    try { image = probeCtx.getImageData(0, 0, probe.width, probe.height); }
    catch { return sourceCanvas; }

    const data = image.data;
    let minX = probe.width;
    let minY = probe.height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < probe.height; y += 1) {
      for (let x = 0; x < probe.width; x += 1) {
        const offset = (y * probe.width + x) * 4;
        const alpha = data[offset + 3];
        if (alpha < 20) continue;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        if (r > 247 && g > 247 && b > 247) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    if (maxX < minX || maxY < minY) return sourceCanvas;

    const sourcePerProbe = 1 / probeScale;
    const safety = Math.max(16, Math.round(14 * sourcePerProbe));
    const sx = Math.max(0, Math.floor(minX * sourcePerProbe) - safety);
    const sy = Math.max(0, Math.floor(minY * sourcePerProbe) - safety);
    const ex = Math.min(sourceCanvas.width, Math.ceil((maxX + 1) * sourcePerProbe) + safety);
    const ey = Math.min(sourceCanvas.height, Math.ceil((maxY + 1) * sourcePerProbe) + safety);
    const sw = Math.max(1, ex - sx);
    const sh = Math.max(1, ey - sy);

    const cropped = document.createElement('canvas');
    cropped.width = sw;
    cropped.height = sh;
    const ctx = cropped.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sw, sh);
    ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return cropped;
  }

  function composeA4Canvas(sourceCanvas) {
    if (!sourceCanvas?.width || !sourceCanvas?.height) throw new Error('לא ניתן להכין את תצוגת השבוע להדפסה');

    const cropped = cropCanvasToContent(sourceCanvas);
    const page = document.createElement('canvas');
    page.width = 3508;
    page.height = 2480;
    const ctx = page.getContext('2d');
    const paddingX = 28;
    const paddingY = 24;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, page.width, page.height);

    const scale = Math.min(
      (page.width - paddingX * 2) / cropped.width,
      (page.height - paddingY * 2) / cropped.height,
    );
    const width = Math.max(1, Math.round(cropped.width * scale));
    const height = Math.max(1, Math.round(cropped.height * scale));
    const x = Math.round((page.width - width) / 2);
    const y = Math.round((page.height - height) / 2);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cropped, x, y, width, height);
    return page;
  }

  function printInIsolatedFrame(dataUrl) {
    return new Promise((resolve, reject) => {
      const printWindow = window.open('', '_blank');
      if (!printWindow) return reject(new Error('חלון ההדפסה נחסם'));
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error); else resolve();
      };

      try {
        const doc = printWindow.document;
        doc.open();
        doc.write(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>שיבוץ שבועי</title><style>
          @page { size:A4 landscape; margin:5mm; }
          html,body { width:287mm; height:200mm; margin:0; padding:0; overflow:hidden; background:#fff; }
          * { box-sizing:border-box; }
          .sheet { width:287mm; height:200mm; margin:0; padding:0; overflow:hidden; background:#fff; display:flex; align-items:center; justify-content:center; break-after:avoid-page; page-break-after:avoid; }
          .sheet img { display:block; width:100%; height:100%; margin:0; padding:0; object-fit:contain; break-inside:avoid-page; page-break-inside:avoid; }
        </style></head><body><main class="sheet"><img id="printImage" alt="שיבוץ שבועי"></main></body></html>`);
        doc.close();

        const image = doc.querySelector('#printImage');
        let printed = false;
        const runPrint = () => {
          if (printed) return;
          printed = true;
          try {
            printWindow.addEventListener('afterprint', () => {
              try { printWindow.close(); } catch {}
            }, { once:true });
            printWindow.focus();
            setTimeout(() => {
              try { printWindow.print(); finish(); }
              catch (error) { try { printWindow.close(); } catch {} finish(error); }
            }, 120);
          } catch (error) {
            try { printWindow.close(); } catch {}
            finish(error);
          }
        };
        image.addEventListener('load', runPrint, { once:true });
        image.addEventListener('error', () => {
          try { printWindow.close(); } catch {}
          finish(new Error('טעינת עמוד ההדפסה נכשלה'));
        }, { once:true });
        image.src = dataUrl;
        if (image.complete && image.naturalWidth) setTimeout(runPrint, 0);
      } catch (error) {
        try { printWindow.close(); } catch {}
        finish(error);
      }
    });
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
          <div><small class="eyebrow">שיבוץ שבועי</small><h3>הדפסה A4 לרוחב</h3><p>עמוד אחד בלבד, עם שטח הדפסה גדול וקריא יותר.</p></div>
          <button type="button" class="icon-btn" data-v0331-print-close aria-label="סגירה">×</button>
        </div>
        <div class="v0331-a4-preview-shell"><div class="v0331-a4-preview"><img data-v0331-print-preview alt="תצוגה מקדימה של השיבוץ השבועי"></div></div>
        <p class="v0331-print-note">המערכת מכינה מסמך A4 לרוחב בעמוד יחיד. שוליים פנימיים צומצמו כדי להגדיל את הטבלה והכיתוב.</p>
        <div class="v0331-print-actions">
          <button type="button" class="ghost-btn" data-v0331-print-close>סגירה</button>
          <button type="button" class="secondary-btn" data-v0331-print-save>שמירת תמונה</button>
          <button type="button" class="primary-btn v0331-print-primary" data-v0331-print-now>🖨️ הדפסה</button>
        </div>
      </section>`;
    document.body.append(dialog);
    dialog.querySelectorAll('[data-v0331-print-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
    dialog.querySelector('[data-v0331-print-now]')?.addEventListener('click', async (event) => {
      if (!currentPrintDataUrl) return showToast('אין תצוגה מוכנה להדפסה', 'error');
      const button = event.currentTarget;
      if (typeof setBusy === 'function') setBusy(button, true, 'פותח הדפסה…');
      try {
        await printInIsolatedFrame(currentPrintDataUrl);
      } catch {
        showToast('Safari לא הצליח לפתוח את ההדפסה. אפשר לשמור את התמונה ולהדפיס אותה.', 'error');
      } finally {
        if (typeof setBusy === 'function') setBusy(button, false);
      }
    });
    dialog.querySelector('[data-v0331-print-save]')?.addEventListener('click', () => {
      if (!currentPrintDataUrl) return;
      const link = document.createElement('a');
      link.href = currentPrintDataUrl;
      link.download = `שיבוץ-שבועי-A4-${dateISO(state.weekStart)}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      showToast('תמונת A4 של השיבוץ מוכנה לשמירה', 'success');
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
    clone.title = 'תצוגה מקדימה והדפסת השיבוץ השבועי בעמוד A4 אחד לרוחב';
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
    document.documentElement.dataset.hadasHotfix = VERSION + '-a4-single-page';
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
