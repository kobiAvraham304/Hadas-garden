/* מערכת ניהול שיבוצים מעון הדס — תיקוני הדפסה, הרשאות וזמינות 0.34.2 */
(() => {
  if (window.__hadasV0342Installed) return;
  window.__hadasV0342Installed = true;

  const VERSION = '0.34.0';
  const SCALE = 2; // 1754×1240 logical -> 3508×2480 px, close to 300dpi A4 landscape.

  function isManagementRole() {
    return ['admin', 'scheduler'].includes(String(state?.profile?.role || ''));
  }

  /*
   * מנהלת מעון ואחראית שיבוצים הן אותה רמת הרשאה. שמות התפקיד נשארים
   * שונים לתצוגה בלבד; אין שינוי ב-role עצמו או ב-ROLE_LABELS.
   */
  const previousIsManager = typeof isManager === 'function' ? isManager : null;
  if (previousIsManager && !window.__hadasV0342ManagerParity) {
    isManager = function v0342IsManager() {
      return isManagementRole();
    };
    window.__hadasV0342ManagerParity = true;
  }

  function enforceManagerParity() {
    if (!state?.profile || !isManagementRole()) return;
    state.profile.can_view_full_schedule = true;
    state.profile.can_create_content = true;
    state.profile.can_manage_daily_operations = true;
    state.profile.schedule_scope = 'full';
    document.documentElement.dataset.hadasRole = 'manager';
  }

  function isSubstitute(employeeOrId) {
    const employee = typeof employeeOrId === 'object' ? employeeOrId : employeeById(employeeOrId);
    return String(employee?.assignment_mode || '') === 'substitute';
  }

  function filterSubstituteAbsences(rows = state.scheduleAbsences || []) {
    return (rows || []).filter((item) => !isSubstitute(item.employee_id));
  }

  // Keep one source of truth throughout the client too, including stale week-cache payloads.
  if (typeof applySchedulePayload === 'function' && !window.__hadasV0342PayloadFilter) {
    const previousApplySchedulePayload = applySchedulePayload;
    applySchedulePayload = function v0342ApplySchedulePayload(payload = {}) {
      const clean = { ...payload, scheduleAbsences: filterSubstituteAbsences(payload.scheduleAbsences || []) };
      const result = previousApplySchedulePayload(clean);
      state.scheduleAbsences = filterSubstituteAbsences(state.scheduleAbsences);
      return result;
    };
    window.__hadasV0342PayloadFilter = true;
  }

  function stripSubstituteAvailability() {
    state.scheduleAbsences = filterSubstituteAbsences(state.scheduleAbsences);
    document.querySelectorAll('#scheduleAbsences .absence-person').forEach((card) => {
      const name = card.querySelector('strong')?.textContent?.trim();
      const employee = (state.employees || []).find((item) => item.full_name === name);
      if (employee && isSubstitute(employee)) card.remove();
    });
  }

  // Approved exceptions are historical decisions, not live staffing faults.
  function stripApprovedValidationState() {
    if (!state?.v030Validation) return;
    state.v030Validation.approved = [];
    state.v030Validation.errors = (state.v030Validation.errors || []).filter((item) => !item.approved && !item._v030Approved);
    state.v030Validation.warnings = (state.v030Validation.warnings || []).filter((item) => !item.approved && !item._v030Approved && item.code !== 'manual_rule_override');
  }

  if (typeof validateScheduleClient === 'function' && !window.__hadasV0342ValidationFilter) {
    const previousValidateScheduleClient = validateScheduleClient;
    validateScheduleClient = function v0342ValidateScheduleClient(...args) {
      stripApprovedValidationState();
      const result = previousValidateScheduleClient.apply(this, args) || { errors: [], warnings: [] };
      const clean = (item) => !item?.approved && !item?._v030Approved && item?.code !== 'manual_rule_override';
      return {
        ...result,
        errors: (result.errors || []).filter(clean),
        warnings: (result.warnings || []).filter(clean),
      };
    };
    window.__hadasV0342ValidationFilter = true;
  }

  function pad2(value) { return String(value).padStart(2, '0'); }
  function dateParts(value) {
    const date = parseDateValue(value);
    return { d: pad2(date.getDate()), m: pad2(date.getMonth() + 1), y: String(date.getFullYear()) };
  }
  function shortDate(value) {
    const p = dateParts(value);
    return `${p.d}.${p.m}`;
  }
  function longDate(value) {
    const p = dateParts(value);
    return `${p.d}.${p.m}.${p.y}`;
  }
  function orderedWeekLabel(start = state.weekStart) {
    // Construct character-by-character in chronological order to avoid RTL bidi reversal.
    return `${shortDate(start)}–${longDate(addDays(start, 5))}`;
  }

  function roundRect(ctx, x, y, width, height, radius, fill, stroke, lineWidth = 1) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
  }

  function text(ctx, value, x, y, options = {}) {
    const {
      size = 16, weight = 700, color = '#303448', align = 'right', maxWidth = undefined,
    } = options;
    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px Arial, "Helvetica Neue", sans-serif`;
    if (maxWidth) ctx.fillText(String(value ?? ''), x, y, maxWidth);
    else ctx.fillText(String(value ?? ''), x, y);
    ctx.restore();
  }

  function classRows() {
    return (state.classes || [])
      .filter((item) => item.active !== false)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'he'));
  }

  function roleMark(role) {
    if (role === 'teacher') return 'גננת';
    if (role === 'lead') return 'מובילה';
    if (role === 'replacement') return 'החלפה';
    return '';
  }

  function drawShiftCard(ctx, shift, x, y, width, height) {
    const employee = employeeById(shift.employee_id);
    const name = employee?.full_name || 'עובד';
    const role = roleMark(shift.shift_role);
    const time = `${trimTime(shift.start_time)}–${trimTime(shift.end_time)}`;
    const compact = height < 42;
    roundRect(ctx, x, y, width, height, 9, '#f7f7fc', '#d9dbea', 1);
    if (compact) {
      text(ctx, name, x + width - 9, y + height / 2, { size: 13.5, weight: 800, maxWidth: width * 0.59 });
      text(ctx, time, x + 9, y + height / 2, { size: 12.5, weight: 700, color: '#565d73', align: 'left', maxWidth: width * 0.36 });
      return;
    }
    text(ctx, name, x + width - 9, y + height * 0.36, { size: 15.5, weight: 850, maxWidth: width - 18 });
    text(ctx, `${time}${role ? ` · ${role}` : ''}`, x + width - 9, y + height * 0.72, { size: 12.5, weight: 700, color: '#61677b', maxWidth: width - 18 });
  }

  function absenceNamesForDate(iso) {
    return filterSubstituteAbsences(state.scheduleAbsences)
      .filter((item) => item.absence_date === iso && item.absence_type !== 'day_off_worked')
      .map((item) => employeeById(item.employee_id)?.full_name || item.employee_name || '')
      .filter(Boolean);
  }

  function buildA4ScheduleCanvas() {
    const logicalWidth = 1754;
    const logicalHeight = 1240;
    const canvas = document.createElement('canvas');
    canvas.width = logicalWidth * SCALE;
    canvas.height = logicalHeight * SCALE;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    const margin = 32;
    const tableWidth = logicalWidth - margin * 2;
    const headerTop = 28;
    const titleHeight = 95;
    const dayHeaderTop = headerTop + titleHeight + 12;
    const dayHeaderHeight = 62;
    const absenceHeight = 92;
    const footerHeight = 24;
    const classLabelWidth = 142;
    const classes = classRows();
    const dates = Array.from({ length: 6 }, (_, index) => addDays(state.weekStart, index));
    const tableBottom = logicalHeight - margin - footerHeight;
    const classesTop = dayHeaderTop + dayHeaderHeight;
    const classesBottom = tableBottom - absenceHeight;
    const rowHeight = Math.max(118, (classesBottom - classesTop) / Math.max(1, classes.length));
    const dayAreaX = margin + classLabelWidth;
    const dayAreaWidth = tableWidth - classLabelWidth;
    const dayWidth = dayAreaWidth / 6;

    roundRect(ctx, margin, headerTop, tableWidth, titleHeight, 18, '#f5f4ff', '#dedff0', 1.2);
    text(ctx, 'שיבוץ שבועי · מעון הדס', logicalWidth - margin - 26, headerTop + 34, { size: 29, weight: 900, color: '#33374e' });
    text(ctx, `השבוע ${orderedWeekLabel(state.weekStart)}`, logicalWidth - margin - 26, headerTop + 68, { size: 18, weight: 750, color: '#666b80' });
    text(ctx, 'A4 לרוחב · עמוד אחד', margin + 24, headerTop + titleHeight / 2, { size: 14, weight: 700, color: '#777b8e', align: 'left' });

    // Left-most column is the class label; Sunday remains the right-most day.
    ctx.fillStyle = '#f0f1f8';
    ctx.fillRect(margin, dayHeaderTop, classLabelWidth, dayHeaderHeight);
    text(ctx, 'כיתה', margin + classLabelWidth / 2, dayHeaderTop + dayHeaderHeight / 2, { size: 17, weight: 900, align: 'center' });

    dates.forEach((date, index) => {
      const x = dayAreaX + (5 - index) * dayWidth;
      ctx.fillStyle = index % 2 ? '#fafaff' : '#f6f6fd';
      ctx.fillRect(x, dayHeaderTop, dayWidth, dayHeaderHeight);
      ctx.strokeStyle = '#dde0eb';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, dayHeaderTop, dayWidth, dayHeaderHeight);
      text(ctx, DAY_NAMES[date.getDay()], x + dayWidth / 2, dayHeaderTop + 22, { size: 17.5, weight: 900, align: 'center' });
      text(ctx, shortDate(date), x + dayWidth / 2, dayHeaderTop + 45, { size: 14.5, weight: 750, color: '#70758a', align: 'center' });
    });

    classes.forEach((classItem, classIndex) => {
      const y = classesTop + classIndex * rowHeight;
      const actualHeight = classIndex === classes.length - 1 ? classesBottom - y : rowHeight;
      ctx.fillStyle = classIndex % 2 ? '#fff' : '#fdfdff';
      ctx.fillRect(margin, y, tableWidth, actualHeight);
      ctx.strokeStyle = '#e0e2ec';
      ctx.strokeRect(margin, y, tableWidth, actualHeight);
      ctx.fillStyle = '#f7f2ff';
      ctx.fillRect(margin, y, classLabelWidth, actualHeight);
      text(ctx, classItem.name || 'כיתה', margin + classLabelWidth / 2, y + actualHeight / 2 - 8, { size: 19, weight: 900, color: '#4a4367', align: 'center', maxWidth: classLabelWidth - 14 });
      const classCount = (state.shifts || []).filter((row) => row.class_id === classItem.id && dates.some((date) => row.shift_date === dateISO(date))).length;
      text(ctx, `${classCount} שיבוצים`, margin + classLabelWidth / 2, y + actualHeight / 2 + 18, { size: 11.5, weight: 650, color: '#858198', align: 'center' });

      dates.forEach((date, index) => {
        const iso = dateISO(date);
        const x = dayAreaX + (5 - index) * dayWidth;
        ctx.strokeStyle = '#e2e4ed';
        ctx.strokeRect(x, y, dayWidth, actualHeight);
        const rows = typeof sortScheduleRows === 'function'
          ? sortScheduleRows((state.shifts || []).filter((row) => row.class_id === classItem.id && row.shift_date === iso))
          : (state.shifts || []).filter((row) => row.class_id === classItem.id && row.shift_date === iso);
        if (!rows.length) {
          text(ctx, '—', x + dayWidth / 2, y + actualHeight / 2, { size: 18, weight: 600, color: '#b0b3bf', align: 'center' });
          return;
        }
        const gap = 5;
        const innerY = y + 9;
        const innerHeight = actualHeight - 18;
        const cardHeight = Math.max(28, Math.min(54, (innerHeight - gap * (rows.length - 1)) / rows.length));
        let currentY = innerY + Math.max(0, (innerHeight - (cardHeight * rows.length + gap * (rows.length - 1))) / 2);
        rows.forEach((shift) => {
          drawShiftCard(ctx, shift, x + 7, currentY, dayWidth - 14, cardHeight);
          currentY += cardHeight + gap;
        });
      });
    });

    const absenceTop = classesBottom;
    ctx.fillStyle = '#fff9ed';
    ctx.fillRect(margin, absenceTop, classLabelWidth, absenceHeight);
    ctx.strokeStyle = '#eadfca';
    ctx.strokeRect(margin, absenceTop, tableWidth, absenceHeight);
    text(ctx, 'חופש / היעדרות', margin + classLabelWidth / 2, absenceTop + absenceHeight / 2, { size: 14, weight: 900, color: '#765f39', align: 'center', maxWidth: classLabelWidth - 12 });
    dates.forEach((date, index) => {
      const x = dayAreaX + (5 - index) * dayWidth;
      ctx.strokeStyle = '#eadfca';
      ctx.strokeRect(x, absenceTop, dayWidth, absenceHeight);
      const names = absenceNamesForDate(dateISO(date));
      if (!names.length) {
        text(ctx, '—', x + dayWidth / 2, absenceTop + absenceHeight / 2, { size: 14, weight: 650, color: '#b0aa9c', align: 'center' });
        return;
      }
      const max = 4;
      const shown = names.slice(0, max);
      const lineHeight = Math.min(17, (absenceHeight - 16) / shown.length);
      let yy = absenceTop + 11 + lineHeight / 2;
      shown.forEach((name) => {
        text(ctx, name, x + dayWidth - 8, yy, { size: 11.8, weight: 750, color: '#6d5a3d', maxWidth: dayWidth - 16 });
        yy += lineHeight;
      });
      if (names.length > max) text(ctx, `+${names.length - max} נוספים`, x + 8, absenceTop + absenceHeight - 10, { size: 10.5, weight: 650, color: '#8b795e', align: 'left' });
    });

    text(ctx, `מעון הדס · ${orderedWeekLabel(state.weekStart)}`, logicalWidth - margin, logicalHeight - 18, { size: 10.5, weight: 650, color: '#8c8f9e' });
    return canvas;
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
  }
  function ascii(value) { return new TextEncoder().encode(String(value)); }

  async function pdfFromCanvas(canvas) {
    const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.995));
    if (!jpegBlob) throw new Error('לא ניתן להכין את קובץ ההדפסה');
    const image = new Uint8Array(await jpegBlob.arrayBuffer());
    const pageW = 841.89;
    const pageH = 595.28;
    const margin = 5;
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
    push(ascii('%PDF-1.4\n%HadasA4\n'));
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
    return new Blob([concatBytes(parts)], { type: 'application/pdf' });
  }

  async function shareOrDownload(blob) {
    const filename = `שיבוץ-מעון-הדס-${dateISO(state.weekStart)}.pdf`;
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'שיבוץ שבועי – מעון הדס', text: `שיבוץ שבועי ${orderedWeekLabel(state.weekStart)}` });
      return 'shared';
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return 'downloaded';
  }

  async function exportA4(event) {
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    const button = event.currentTarget;
    if (typeof setBusy === 'function') setBusy(button, true, 'מכין PDF…');
    try {
      enforceManagerParity();
      stripSubstituteAvailability();
      await document.fonts?.ready;
      const canvas = buildA4ScheduleCanvas();
      const blob = await pdfFromCanvas(canvas);
      const result = await shareOrDownload(blob);
      if (result === 'downloaded' && typeof showToast === 'function') showToast('קובץ A4 נשמר', 'success');
    } catch (error) {
      if (error?.name !== 'AbortError' && typeof showToast === 'function') showToast(error?.message || 'הכנת ההדפסה נכשלה', 'error');
    } finally {
      if (typeof setBusy === 'function') setBusy(button, false);
    }
  }

  function installA4Button() {
    const current = document.querySelector('#printBtn');
    if (!current || current.dataset.v0342A4 === 'true') return;
    const button = current.cloneNode(true);
    button.dataset.v0342A4 = 'true';
    button.textContent = 'הדפסה A4';
    button.title = 'שיבוץ שבועי בעמוד A4 אחד לרוחב';
    button.addEventListener('click', exportA4, true);
    current.replaceWith(button);
  }

  function apply() {
    enforceManagerParity();
    stripApprovedValidationState();
    stripSubstituteAvailability();
    installA4Button();
    document.documentElement.dataset.hadasA4 = 'v0342';
  }

  if (typeof renderSchedule === 'function' && !window.__hadasV0342RenderHook) {
    const previousRenderSchedule = renderSchedule;
    renderSchedule = function v0342RenderSchedule(...args) {
      enforceManagerParity();
      stripApprovedValidationState();
      state.scheduleAbsences = filterSubstituteAbsences(state.scheduleAbsences);
      const result = previousRenderSchedule.apply(this, args);
      queueMicrotask(apply);
      requestAnimationFrame(apply);
      return result;
    };
    window.__hadasV0342RenderHook = true;
  }

  if (typeof renderAll === 'function' && !window.__hadasV0342RenderAllHook) {
    const previousRenderAll = renderAll;
    renderAll = function v0342RenderAll(...args) {
      enforceManagerParity();
      const result = previousRenderAll.apply(this, args);
      queueMicrotask(apply);
      requestAnimationFrame(apply);
      return result;
    };
    window.__hadasV0342RenderAllHook = true;
  }

  const schedulePanel = document.querySelector('#schedulePanel');
  if (schedulePanel) {
    const observer = new MutationObserver(() => requestAnimationFrame(apply));
    observer.observe(schedulePanel, { childList: true, subtree: true });
    window.__hadasV0342ScheduleObserver = observer;
  }

  requestAnimationFrame(apply);
  window.__hadasV0342BootstrapPromise = Promise.resolve(true);
})();
