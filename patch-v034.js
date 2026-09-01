/* מערכת ניהול שיבוצים מעון הדס — נוכחות ותפעול יומי 0.34.0 */
(() => {
  const VERSION = '0.34.0';
  const DAY_FIELD_HIDDEN_CLASS = 'v034-day-field-hidden';
  const ABSENCE_TYPES = new Set(['leave', 'day_off', 'sick', 'fixed_day_off']);

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

  function injectFixStyles() {
    if (document.querySelector('#v034ScheduleExportFixStyles')) return;
    const style = document.createElement('style');
    style.id = 'v034ScheduleExportFixStyles';
    style.textContent = `
      #scheduleDayField.${DAY_FIELD_HIDDEN_CLASS} { display:none !important; visibility:hidden !important; }
    `;
    document.head.append(style);
  }

  function syncScheduleDayField() {
    const field = document.querySelector('#scheduleDayField');
    if (!field) return;
    const visible = state?.scheduleMode === 'day';
    field.classList.toggle(DAY_FIELD_HIDDEN_CLASS, !visible);
    field.setAttribute('aria-hidden', visible ? 'false' : 'true');
    if (visible) field.removeAttribute('hidden');
    else field.setAttribute('hidden', '');
  }

  function weekDates() {
    return Array.from({ length:6 }, (_, index) => addDays(state.weekStart, index));
  }

  function absenceTypeLabel(type) {
    if (type === 'leave') return 'חופשה מאושרת';
    if (type === 'day_off') return 'יום חופשי';
    if (type === 'sick') return 'מחלה';
    if (type === 'fixed_day_off') return 'יום חופשי קבוע';
    return 'היעדרות';
  }

  function absenceTypePalette(type) {
    if (type === 'sick') return { fill:'#fff0f0', border:'#efc2c2', text:'#8b3b3b', mark:'#d95f5f' };
    if (type === 'leave') return { fill:'#fff8e8', border:'#eed9a8', text:'#775a24', mark:'#d5a642' };
    if (type === 'day_off') return { fill:'#eef4ff', border:'#c9d8f5', text:'#425b85', mark:'#6d8fd1' };
    return { fill:'#f5f2ff', border:'#d8cff1', text:'#64548b', mark:'#8f7bc0' };
  }

  function absenceRowsForWeek() {
    const dateSet = new Set(weekDates().map(dateISO));
    return (state.scheduleAbsences || [])
      .filter((item) => dateSet.has(item.absence_date) && ABSENCE_TYPES.has(item.absence_type))
      .sort((a, b) => {
        const dateCompare = String(a.absence_date || '').localeCompare(String(b.absence_date || ''));
        if (dateCompare) return dateCompare;
        const aName = employeeById(a.employee_id)?.full_name || a.employee_name || '';
        const bName = employeeById(b.employee_id)?.full_name || b.employee_name || '';
        return aName.localeCompare(bName, 'he');
      });
  }

  function canvasText(ctx, text, x, y, options = {}) {
    const {
      size = 24,
      weight = 700,
      color = '#34384a',
      align = 'right',
      maxWidth,
    } = options;
    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.font = `${weight} ${size}px Arial, sans-serif`;
    ctx.fillStyle = color;
    if (maxWidth) ctx.fillText(String(text ?? ''), x, y, maxWidth);
    else ctx.fillText(String(text ?? ''), x, y);
    ctx.restore();
  }

  function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  }

  function drawAbsenceWeekCanvas(scale = 2) {
    const logicalWidth = 1680;
    const logicalHeight = 1188;
    const canvas = document.createElement('canvas');
    canvas.width = logicalWidth * scale;
    canvas.height = logicalHeight * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    const margin = 52;
    const contentWidth = logicalWidth - margin * 2;
    const dates = weekDates();
    const rows = absenceRowsForWeek();
    const weekStartText = formatDate(state.weekStart, { day:'2-digit', month:'2-digit' });
    const weekEndText = formatDate(addDays(state.weekStart, 5), { day:'2-digit', month:'2-digit', year:'numeric' });

    roundRect(ctx, margin, margin, contentWidth, 126, 24, '#f5f4ff', '#dedff0');
    canvasText(ctx, 'חופשות והיעדרויות · מעון הדס', logicalWidth - margin - 30, margin + 43, { size:34, weight:900, color:'#35384f' });
    canvasText(ctx, `השבוע ${weekStartText}–${weekEndText}`, logicalWidth - margin - 30, margin + 90, { size:20, weight:700, color:'#6d7185' });
    canvasText(ctx, `${rows.length} ימי חופש / היעדרות`, margin + 30, margin + 65, { size:20, weight:800, color:'#686cb9', align:'left' });

    const tableTop = margin + 156;
    const headerHeight = 86;
    const tableBottom = logicalHeight - margin - 54;
    const tableHeight = tableBottom - tableTop;
    const bodyTop = tableTop + headerHeight;
    const bodyHeight = tableHeight - headerHeight;
    const dayWidth = contentWidth / 6;

    roundRect(ctx, margin, tableTop, contentWidth, tableHeight, 18, '#ffffff', '#dfe1ec');

    dates.forEach((date, index) => {
      const right = logicalWidth - margin - index * dayWidth;
      const left = right - dayWidth;
      const iso = dateISO(date);
      const dayRows = rows.filter((item) => item.absence_date === iso);

      ctx.fillStyle = index % 2 ? '#fafaff' : '#f7f7fd';
      ctx.fillRect(left, tableTop, dayWidth, headerHeight);
      if (index < 5) {
        ctx.strokeStyle = '#e0e2ec';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(left, tableTop);
        ctx.lineTo(left, tableBottom);
        ctx.stroke();
      }
      ctx.strokeStyle = '#e0e2ec';
      ctx.beginPath();
      ctx.moveTo(left, bodyTop);
      ctx.lineTo(right, bodyTop);
      ctx.stroke();

      canvasText(ctx, DAY_NAMES[date.getDay()], left + dayWidth / 2, tableTop + 28, { size:22, weight:900, color:'#45495e', align:'center' });
      canvasText(ctx, formatDate(iso, { day:'2-digit', month:'2-digit' }), left + dayWidth / 2, tableTop + 59, { size:17, weight:700, color:'#7a7e91', align:'center' });

      if (!dayRows.length) {
        canvasText(ctx, 'אין חופשות / היעדרויות', left + dayWidth / 2, bodyTop + bodyHeight / 2, { size:17, weight:700, color:'#a0a3b1', align:'center', maxWidth:dayWidth - 28 });
        return;
      }

      const gap = 10;
      const availableHeight = bodyHeight - 28;
      const cardHeight = Math.max(44, Math.min(68, (availableHeight - gap * (dayRows.length - 1)) / dayRows.length));
      const totalCardsHeight = dayRows.length * cardHeight + Math.max(0, dayRows.length - 1) * gap;
      let y = bodyTop + Math.max(14, (bodyHeight - totalCardsHeight) / 2);

      dayRows.forEach((item) => {
        const palette = absenceTypePalette(item.absence_type);
        const employee = employeeById(item.employee_id);
        const name = employee?.full_name || item.employee_name || 'עובד';
        const className = typeof fixedClassLabel === 'function' ? fixedClassLabel(item.employee_id) : '';
        const cardX = left + 10;
        const cardWidth = dayWidth - 20;
        roundRect(ctx, cardX, y, cardWidth, cardHeight, 12, palette.fill, palette.border);
        ctx.fillStyle = palette.mark;
        ctx.fillRect(right - 16, y + 8, 4, Math.max(18, cardHeight - 16));

        const compact = cardHeight < 55;
        const titleY = compact ? y + cardHeight / 2 : y + 21;
        canvasText(ctx, name, right - 24, titleY, { size:compact ? 15 : 17, weight:900, color:palette.text, maxWidth:cardWidth - 34 });
        if (!compact) {
          const meta = `${absenceTypeLabel(item.absence_type)}${className ? ` · ${className}` : ''}`;
          canvasText(ctx, meta, right - 24, y + 47, { size:12, weight:700, color:'#737789', maxWidth:cardWidth - 34 });
        }
        y += cardHeight + gap;
      });
    });

    canvasText(ctx, 'מוצגים חופשה מאושרת, יום חופשי, מחלה ויום חופשי קבוע. השיבוצים עצמם אינם מוצגים במסמך זה.', logicalWidth - margin, logicalHeight - margin + 8, { size:14, weight:600, color:'#8b8e9d', maxWidth:contentWidth });
    return canvas;
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
  }

  function ascii(text) {
    return new TextEncoder().encode(String(text));
  }

  async function pdfBlobFromCanvas(canvas) {
    const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.995));
    if (!jpegBlob) throw new Error('לא ניתן להכין PDF');
    const image = new Uint8Array(await jpegBlob.arrayBuffer());
    const pageW = 841.89;
    const pageH = 595.28;
    const margin = 12;
    const fit = Math.min((pageW - margin * 2) / canvas.width, (pageH - margin * 2) / canvas.height);
    const drawW = canvas.width * fit;
    const drawH = canvas.height * fit;
    const x = (pageW - drawW) / 2;
    const y = (pageH - drawH) / 2;
    const content = ascii(`q\n${drawW.toFixed(3)} 0 0 ${drawH.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm\n/Im0 Do\nQ\n`);
    const parts = [];
    const offsets = [0];
    let length = 0;
    const push = (bytes) => { parts.push(bytes); length += bytes.length; };
    push(ascii('%PDF-1.4\n%PDF-image\n'));
    const object = (id, bodyParts) => {
      offsets[id] = length;
      push(ascii(`${id} 0 obj\n`));
      bodyParts.forEach(push);
      push(ascii('\nendobj\n'));
    };
    object(1, [ascii('<< /Type /Catalog /Pages 2 0 R >>')]);
    object(2, [ascii('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')]);
    object(3, [ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`)]);
    object(4, [ascii(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, ascii('\nendstream')]);
    object(5, [ascii(`<< /Length ${content.length} >>\nstream\n`), content, ascii('endstream')]);
    const xrefOffset = length;
    push(ascii('xref\n0 6\n0000000000 65535 f \n'));
    for (let id = 1; id <= 5; id += 1) push(ascii(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`));
    push(ascii(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
    return new Blob([concatBytes(parts)], { type:'application/pdf' });
  }

  async function shareOrDownloadPdf(blob, filename) {
    const file = new File([blob], filename, { type:'application/pdf' });
    if (navigator.share && navigator.canShare?.({ files:[file] })) {
      await navigator.share({
        files:[file],
        title:'חופשות השבוע – מעון הדס',
        text:`חופשות והיעדרויות לתאריכים ${formatDate(state.weekStart, { day:'2-digit', month:'2-digit' })}–${formatDate(addDays(state.weekStart, 5), { day:'2-digit', month:'2-digit', year:'numeric' })}`,
      });
      return 'shared';
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return 'downloaded';
  }

  async function exportAbsenceWeekPdf(event) {
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    const button = document.querySelector('#v027AbsencePdfBtn');
    if (typeof setBusy === 'function') setBusy(button, true, 'מכין טבלת שבוע…');
    try {
      await document.fonts?.ready;
      const canvas = drawAbsenceWeekCanvas(2);
      const blob = await pdfBlobFromCanvas(canvas);
      const result = await shareOrDownloadPdf(blob, `חופשות-שבוע-${dateISO(state.weekStart)}.pdf`);
      if (result === 'downloaded' && typeof showToast === 'function') showToast('PDF חופשות השבוע נשמר', 'success');
    } catch (error) {
      if (error?.name !== 'AbortError' && typeof showToast === 'function') showToast(error?.message || 'הכנת PDF החופשות נכשלה', 'error');
    } finally {
      if (typeof setBusy === 'function') setBusy(button, false);
    }
  }

  function installAbsencePdfButton() {
    const button = document.querySelector('#v027AbsencePdfBtn');
    if (!button || button.dataset.v034WeeklyAbsencePdf === 'true') return;
    const clone = button.cloneNode(true);
    clone.dataset.v034WeeklyAbsencePdf = 'true';
    clone.textContent = 'PDF חופשות השבוע';
    clone.title = 'טבלת שבוע עם הימים והחופשות בלבד, ללא שיבוצים';
    clone.addEventListener('click', exportAbsenceWeekPdf, true);
    button.replaceWith(clone);
  }

  function applyScheduleFixes() {
    injectFixStyles();
    syncScheduleDayField();
    installAbsencePdfButton();
  }

  function installHooks() {
    if (typeof renderSchedule === 'function' && !window.__hadasV034ScheduleFixRender) {
      const previousRenderSchedule = renderSchedule;
      renderSchedule = function v034RenderScheduleFix(...args) {
        const result = previousRenderSchedule.apply(this, args);
        queueMicrotask(applyScheduleFixes);
        requestAnimationFrame(applyScheduleFixes);
        return result;
      };
      window.__hadasV034ScheduleFixRender = true;
    }

    if (typeof renderAll === 'function' && !window.__hadasV034ScheduleFixRenderAll) {
      const previousRenderAll = renderAll;
      renderAll = function v034RenderAllFix(...args) {
        const result = previousRenderAll.apply(this, args);
        queueMicrotask(applyScheduleFixes);
        requestAnimationFrame(applyScheduleFixes);
        return result;
      };
      window.__hadasV034ScheduleFixRenderAll = true;
    }

    const panel = document.querySelector('#schedulePanel');
    if (panel && !panel.dataset.v034ScheduleFixObserver) {
      panel.dataset.v034ScheduleFixObserver = 'true';
      const observer = new MutationObserver(() => requestAnimationFrame(applyScheduleFixes));
      observer.observe(panel, { childList:true, subtree:true });
      window.__hadasV034ScheduleFixObserver = observer;
    }

    document.querySelector('#scheduleMode')?.addEventListener('click', () => {
      queueMicrotask(syncScheduleDayField);
      requestAnimationFrame(syncScheduleDayField);
    }, true);
  }

  installVersionGuard();
  installHooks();
  requestAnimationFrame(applyScheduleFixes);
  window.__hadasV034Installed = true;
  window.__hadasV034BootstrapPromise = Promise.resolve(true);
})();
