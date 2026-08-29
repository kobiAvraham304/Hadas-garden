/* מערכת ניהול שיבוצים מעון הדס — השלמות ממשק לגרסה 0.27.0 */
(() => {
  const VERSION = '0.27.0';
  const previousRenderSchedule = renderSchedule;
  const previousRefreshScheduleWeek = refreshScheduleWeek;
  const previousRenderShiftEmployeePicker = renderShiftEmployeePicker;
  const previousOpenShiftDialog = openShiftDialog;
  const previousValidateScheduleClient = validateScheduleClient;
  const previousShiftCardHtml = shiftCardHtml;
  const previousOpenCalendarDialog = openCalendarDialog;
  const previousOpenCalendarEvent = openCalendarEvent;
  const previousRenderCalendar = renderCalendar;
  const previousApplyAutomaticSchedule = applyAutomaticSchedule;
  const previousRevalidateAutomaticPreview = revalidateAutomaticPreview;

  state.v027GeneralDaysOff = state.v027GeneralDaysOff || new Map();
  state.v027GeneralDayOffMonths = state.v027GeneralDayOffMonths || new Map();
  state.v027PickerFilter = state.v027PickerFilter || 'available';

  function ensureVersion() {
    const badge = document.querySelector('#appVersionBadge');
    if (badge) badge.textContent = `v${VERSION}`;
    const login = document.querySelector('#loginVersion');
    if (login) login.textContent = `גרסה ${VERSION}`;
  }

  function weekRangeLabel(start = state.weekStart) {
    return `${formatDate(start, { day:'2-digit', month:'2-digit' })}–${formatDate(addDays(start, 5), { day:'2-digit', month:'2-digit', year:'numeric' })}`;
  }

  function monthKey(dateValue) {
    const date = parseDateValue(dateValue);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  async function loadGeneralDaysOffForWeek(startValue = state.weekStart, { force = false } = {}) {
    const start = startOfWeek(parseDateValue(startValue));
    const dates = Array.from({ length: 6 }, (_, index) => addDays(start, index));
    const months = [...new Set(dates.map(monthKey))];
    const results = await Promise.all(months.map(async (month) => {
      if (!force && state.v027GeneralDayOffMonths.has(month)) return state.v027GeneralDayOffMonths.get(month);
      try {
        const result = await apiFetch(`/api/calendar?month=${encodeURIComponent(month)}`, { timeout: 9000 });
        const closures = (result.events || []).filter((event) => event.is_general_day_off === true);
        state.v027GeneralDayOffMonths.set(month, closures);
        return closures;
      } catch {
        return state.v027GeneralDayOffMonths.get(month) || [];
      }
    }));
    state.v027GeneralDaysOff.clear();
    for (const events of state.v027GeneralDayOffMonths.values()) {
      for (const event of events || []) if (event?.event_date) state.v027GeneralDaysOff.set(event.event_date, event);
    }
    state.scheduleValidationCache = { key:'', value:null };
    return results.flat();
  }

  function generalDayOff(date) {
    return state.v027GeneralDaysOff.get(String(date || '')) || null;
  }

  refreshScheduleWeek = async function v027RefreshScheduleWeek(options = {}) {
    const payload = await previousRefreshScheduleWeek(options);
    await loadGeneralDaysOffForWeek(state.weekStart).catch(() => {});
    if (state.activeTab === 'schedule') renderSchedule();
    return payload;
  };

  validateScheduleClient = function v027ValidateScheduleClient() {
    const result = previousValidateScheduleClient();
    const filterClosure = (item) => !(item?.date && generalDayOff(item.date));
    return {
      errors: (result.errors || []).filter(filterClosure),
      warnings: (result.warnings || []).filter(filterClosure),
    };
  };

  function shiftUsesDifferentFixedHours(shift) {
    if (!shift?.employee_id || !shift?.shift_date) return false;
    const pattern = employeePatternForDate(shift.employee_id, shift.shift_date);
    if (!pattern || pattern.day_type !== 'work' || !pattern.start_time || !pattern.end_time) return false;
    return trimTime(shift.start_time) !== trimTime(pattern.start_time) || trimTime(shift.end_time) !== trimTime(pattern.end_time);
  }

  shiftCardHtml = function v027ShiftCardHtml(shift, compact = false) {
    let html = previousShiftCardHtml(shift, compact);
    if (!shiftUsesDifferentFixedHours(shift)) return html;
    html = html.replace('class="shift-item ', 'class="shift-item v027-hours-different ');
    html = html.replace('class="shift-time"', 'class="shift-time v027-time-marker" title="השעות שונות מהשעות הקבועות בכרטיס העובד"');
    return html;
  };

  function pickerFilterBar() {
    return `<div class="v027-picker-filter" role="group" aria-label="סינון עובדים">
      <button type="button" data-v027-picker-filter="available" class="${state.v027PickerFilter === 'available' ? 'active' : ''}">זמינים בלבד</button>
      <button type="button" data-v027-picker-filter="recommended" class="${state.v027PickerFilter === 'recommended' ? 'active' : ''}">מומלצים</button>
      <button type="button" data-v027-picker-filter="all" class="${state.v027PickerFilter === 'all' ? 'active' : ''}">כולל חסומים</button>
    </div>`;
  }

  function applyPickerFilter() {
    const target = document.querySelector('#shiftEmployeeOptionsList');
    if (!target) return;
    if (!target.querySelector('.v027-picker-filter')) target.insertAdjacentHTML('afterbegin', pickerFilterBar());
    const groups = [...target.querySelectorAll('.employee-option-group')];
    for (const group of groups) {
      const blocked = group.classList.contains('blocked-employees');
      const label = group.querySelector(':scope > span')?.textContent || '';
      const possible = /אפשרויות נוספות/.test(label);
      if (state.v027PickerFilter === 'all') group.classList.remove('v027-filter-hidden');
      else if (state.v027PickerFilter === 'recommended') group.classList.toggle('v027-filter-hidden', blocked || possible);
      else group.classList.toggle('v027-filter-hidden', blocked);
    }
    target.querySelectorAll('.matching-rejected-details').forEach((item) => item.classList.toggle('v027-filter-hidden', state.v027PickerFilter !== 'all'));
  }

  renderShiftEmployeePicker = function v027RenderShiftEmployeePicker(...args) {
    const result = previousRenderShiftEmployeePicker(...args);
    applyPickerFilter();
    return result;
  };

  openShiftDialog = function v027OpenShiftDialog(shift = {}) {
    state.v027PickerFilter = 'available';
    return previousOpenShiftDialog(shift);
  };

  function installPickerFilterEvents() {
    const target = document.querySelector('#shiftEmployeeOptionsList');
    if (!target || target.dataset.v027FilterInstalled) return;
    target.dataset.v027FilterInstalled = 'true';
    target.addEventListener('click', (event) => {
      const button = event.target.closest('[data-v027-picker-filter]');
      if (!button) return;
      event.preventDefault();
      state.v027PickerFilter = button.dataset.v027PickerFilter;
      renderShiftEmployeePicker();
    });
  }

  function issueCard(item, kind) {
    return `<button type="button" class="v027-validation-item ${kind}" data-issue-id="${escapeHtml(item.id || '')}">
      <span>${kind === 'error' ? '!' : 'i'}</span><div><strong>${escapeHtml(item.title || (kind === 'error' ? 'נדרשת בדיקה' : 'הערה'))}</strong><small>${escapeHtml(item.text || '')}</small></div>
    </button>`;
  }

  function renderValidationPanel(open = state.scheduleIssuesOpen) {
    const panel = document.querySelector('#scheduleWarnings');
    const toggle = document.querySelector('#scheduleIssuesToggle');
    const count = document.querySelector('#scheduleIssuesCount');
    if (!panel || !toggle || !count || !isManager()) return;
    const validation = validateScheduleClient();
    const total = validation.errors.length + validation.warnings.length;
    count.textContent = validation.errors.length ? `${validation.errors.length} בעיות · ${validation.warnings.length} הערות` : validation.warnings.length ? `${validation.warnings.length} הערות` : 'הכל תקין';
    toggle.classList.toggle('has-errors', validation.errors.length > 0);
    toggle.classList.toggle('v027-all-good', total === 0);
    toggle.setAttribute('aria-expanded', String(Boolean(open)));
    panel.classList.toggle('hidden', !open);
    if (!open) return;
    panel.innerHTML = total
      ? `<div class="v027-validation-head"><strong>בדיקות תקינות לשבוע ${weekRangeLabel()}</strong><small>לחיצה על בעיה תעביר למקום הרלוונטי בשיבוץ.</small></div><div class="v027-validation-list">${validation.errors.map((item) => issueCard(item, 'error')).join('')}${validation.warnings.map((item) => issueCard(item, 'warning')).join('')}</div>`
      : `<div class="v027-validation-success"><span>✓</span><div><strong>השיבוץ עבר את בדיקות התקינות</strong><small>לא נמצאו חוסרי תקינה, חריגות שעות או אזהרות בשבוע הנבחר.</small></div></div>`;
  }

  function installValidationButton() {
    const toggle = document.querySelector('#scheduleIssuesToggle');
    if (!toggle || toggle.dataset.v027Installed) return;
    toggle.dataset.v027Installed = 'true';
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      state.scheduleIssuesOpen = !state.scheduleIssuesOpen;
      renderValidationPanel(state.scheduleIssuesOpen);
      if (state.scheduleIssuesOpen) requestAnimationFrame(() => document.querySelector('#scheduleWarnings')?.scrollIntoView({ behavior:'smooth', block:'nearest' }));
    }, true);
  }

  function problemCellKeys() {
    const validation = validateScheduleClient();
    return new Set((validation.errors || []).filter((item) => item.date && (item.classId || item.class_id)).map((item) => `${item.date}|${item.classId || item.class_id}`));
  }

  function cellMeta(zone) {
    if (zone.dataset.v025DropDate && zone.dataset.v025DropClass) return { date:zone.dataset.v025DropDate, classId:zone.dataset.v025DropClass };
    const add = zone.querySelector('[data-date][data-class]');
    return add ? { date:add.dataset.date, classId:add.dataset.class } : null;
  }

  function decorateScheduleCells() {
    const root = document.querySelector('#scheduleExport');
    if (!root) return;
    const problems = problemCellKeys();
    root.querySelectorAll('.schedule-cell, .mobile-week-class, .day-class-card').forEach((zone) => {
      const meta = cellMeta(zone); if (!meta) return;
      zone.classList.remove('v027-problem-cell', 'v027-general-day-off-cell');
      zone.querySelector('.v027-cell-flag')?.remove();
      const closure = generalDayOff(meta.date);
      if (closure) {
        zone.classList.add('v027-general-day-off-cell');
        zone.insertAdjacentHTML('afterbegin', `<div class="v027-cell-flag closure">☀ ${escapeHtml(closure.title || 'יום חופשי כללי')}</div>`);
      } else if (problems.has(`${meta.date}|${meta.classId}`)) {
        zone.classList.add('v027-problem-cell');
        zone.insertAdjacentHTML('afterbegin', '<div class="v027-cell-flag problem">נדרשת בדיקה</div>');
      }
    });
  }

  function renderWeekClosureBanner() {
    const root = document.querySelector('#scheduleExport');
    if (!root) return;
    document.querySelector('#v027WeekClosures')?.remove();
    const dates = currentWeekDates().map(dateISO).filter((date) => generalDayOff(date));
    if (!dates.length) return;
    const html = dates.map((date) => {
      const event = generalDayOff(date);
      return `<span><b>${DAY_NAMES[parseDateValue(date).getDay()]} ${formatDate(date,{day:'2-digit',month:'2-digit'})}</b> · ${escapeHtml(event.title || 'יום חופשי כללי')}${event.description ? ` — ${escapeHtml(event.description)}` : ''}</span>`;
    }).join('');
    root.insertAdjacentHTML('beforebegin', `<div id="v027WeekClosures" class="v027-week-closures"><strong>☀ ימים חופשיים כלליים</strong>${html}</div>`);
  }

  function injectAbsencePdfButton() {
    const heading = document.querySelector('#scheduleAbsences .absence-section-heading');
    if (!heading || heading.querySelector('#v027AbsencePdfBtn')) return;
    const button = document.createElement('button');
    button.id = 'v027AbsencePdfBtn';
    button.type = 'button';
    button.className = 'ghost-btn v027-absence-pdf';
    button.textContent = 'PDF חופשות השבוע';
    heading.append(button);
    button.addEventListener('click', exportAbsencePdf);
  }

  function fixWeekArrows() {
    const prev = document.querySelector('#prevWeekBtn'); const next = document.querySelector('#nextWeekBtn');
    if (prev) { prev.textContent = '›'; prev.title = 'שבוע קודם'; }
    if (next) { next.textContent = '‹'; next.title = 'שבוע הבא'; }
  }

  function enhanceScheduleV027() {
    ensureVersion();
    installPickerFilterEvents();
    installValidationButton();
    renderValidationPanel(state.scheduleIssuesOpen);
    decorateScheduleCells();
    renderWeekClosureBanner();
    injectAbsencePdfButton();
    fixWeekArrows();
    const imageButton = document.querySelector('#imageBtn');
    if (imageButton) imageButton.classList.remove('hidden');
  }

  renderSchedule = function v027RenderSchedule(...args) {
    const result = previousRenderSchedule(...args);
    requestAnimationFrame(enhanceScheduleV027);
    return result;
  };

  function canvasText(ctx, text, x, y, size = 15, weight = 600, align = 'right', color = '#35384a') {
    ctx.save();
    ctx.direction = 'rtl'; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.font = `${weight} ${size}px Arial, sans-serif`; ctx.fillStyle = color;
    ctx.fillText(String(text ?? ''), x, y);
    ctx.restore();
  }

  function highQualityWeeklyCanvas(payload = schedulePayloadFromState(), weekStart = state.weekStart, title = 'שיבוץ שבועי', scale = 2) {
    const dates = Array.from({ length: 6 }, (_, index) => addDays(weekStart, index));
    const classes = (payload.classes || state.classes || []).filter((item) => item.active !== false);
    const shifts = payload.shifts || state.shifts || [];
    const absences = payload.scheduleAbsences || state.scheduleAbsences || [];
    const logicalWidth = 1680, margin = 34, classWidth = 138, headerHeight = 112, dayHeaderHeight = 62;
    const dayWidth = (logicalWidth - margin * 2 - classWidth) / 6;
    const rowHeights = classes.map((classItem) => {
      let max = 0;
      for (const date of dates) max = Math.max(max, shifts.filter((row) => row.shift_date === dateISO(date) && row.class_id === classItem.id).length);
      return Math.max(76, 18 + max * 44);
    });
    let absenceMax = 0;
    for (const date of dates) absenceMax = Math.max(absenceMax, absences.filter((row) => row.absence_date === dateISO(date) && row.absence_type !== 'day_off_worked').length);
    const absenceHeight = Math.max(82, 22 + absenceMax * 28);
    const logicalHeight = margin * 2 + headerHeight + dayHeaderHeight + rowHeights.reduce((a,b)=>a+b,0) + absenceHeight + 34;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(logicalWidth * scale); canvas.height = Math.round(logicalHeight * scale);
    const ctx = canvas.getContext('2d'); ctx.scale(scale, scale); ctx.direction = 'rtl';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    ctx.fillStyle = '#f4f4ff'; ctx.fillRect(margin, margin, logicalWidth - margin * 2, headerHeight - 10);
    canvasText(ctx, 'מערכת ניהול שיבוצים מעון הדס', logicalWidth - margin - 24, margin + 26, 18, 800, 'right', '#6267bb');
    canvasText(ctx, title, logicalWidth - margin - 24, margin + 64, 34, 900);
    canvasText(ctx, weekRangeLabel(weekStart), margin + 24, margin + 64, 22, 800, 'left', '#555a72');

    let y = margin + headerHeight;
    ctx.fillStyle = '#eceeff'; ctx.fillRect(margin, y, logicalWidth - margin * 2, dayHeaderHeight);
    canvasText(ctx, 'כיתה', logicalWidth - margin - classWidth / 2, y + dayHeaderHeight / 2, 18, 900, 'center');
    dates.forEach((date, index) => {
      const right = logicalWidth - margin - classWidth - index * dayWidth;
      canvasText(ctx, DAY_NAMES[date.getDay()], right - dayWidth / 2, y + 22, 18, 900, 'center');
      canvasText(ctx, formatDate(date,{day:'2-digit',month:'2-digit'}), right - dayWidth / 2, y + 44, 13, 700, 'center', '#777b8f');
    });
    y += dayHeaderHeight;

    classes.forEach((classItem, rowIndex) => {
      const rh = rowHeights[rowIndex];
      ctx.fillStyle = rowIndex % 2 ? '#fcfcff' : '#fff'; ctx.fillRect(margin, y, logicalWidth - margin * 2, rh);
      ctx.strokeStyle = '#e2e4ee'; ctx.strokeRect(margin, y, logicalWidth - margin * 2, rh);
      ctx.fillStyle = '#f7f6ff'; ctx.fillRect(logicalWidth - margin - classWidth, y, classWidth, rh);
      canvasText(ctx, classItem.name, logicalWidth - margin - classWidth/2, y + rh/2, 21, 900, 'center');
      dates.forEach((date, index) => {
        const iso = dateISO(date); const right = logicalWidth - margin - classWidth - index * dayWidth; const left = right - dayWidth;
        ctx.strokeStyle = '#e3e5ee'; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left, y + rh); ctx.stroke();
        const closure = generalDayOff(iso);
        if (closure) {
          ctx.fillStyle = '#f1f1f7'; ctx.fillRect(left + 2, y + 2, dayWidth - 4, rh - 4);
          canvasText(ctx, 'יום חופשי כללי', left + dayWidth/2, y + rh/2 - 10, 15, 900, 'center', '#686b7c');
          canvasText(ctx, closure.title || '', left + dayWidth/2, y + rh/2 + 13, 12, 600, 'center', '#8b8e9c');
          return;
        }
        const items = sortScheduleRows(shifts.filter((row) => row.shift_date === iso && row.class_id === classItem.id));
        if (!items.length) { canvasText(ctx, '—', left + dayWidth/2, y + rh/2, 20, 700, 'center', '#b0b3c0'); return; }
        items.forEach((shift, itemIndex) => {
          const employee = employeeById(shift.employee_id); const cy = y + 16 + itemIndex * 44;
          ctx.fillStyle = shift.shift_role === 'teacher' ? '#eaf7ef' : shift.shift_role === 'lead' ? '#f2edfb' : '#f8f9fc';
          ctx.fillRect(left + 7, cy, dayWidth - 14, 36);
          canvasText(ctx, employee?.full_name || 'עובד', right - 14, cy + 12, 14, 800);
          const time = `${trimTime(shift.start_time)}-${trimTime(shift.end_time)}`;
          if (shiftUsesDifferentFixedHours(shift)) {
            ctx.fillStyle = 'rgba(244, 207, 97, .28)'; ctx.fillRect(left + 10, cy + 3, 94, 19);
          }
          canvasText(ctx, time, left + 14, cy + 12, 12, 800, 'left', '#555b73');
          const meta = [SHIFT_ROLE_SHORT_LABELS[shift.shift_role] || '', shift.public_note || ''].filter(Boolean).join(' · ');
          canvasText(ctx, meta, right - 14, cy + 27, 10, 600, 'right', '#7d8192');
        });
      });
      y += rh;
    });

    ctx.fillStyle = '#fffaf0'; ctx.fillRect(margin, y, logicalWidth - margin * 2, absenceHeight);
    ctx.strokeStyle = '#eadfc9'; ctx.strokeRect(margin, y, logicalWidth - margin * 2, absenceHeight);
    ctx.fillStyle = '#fff2d8'; ctx.fillRect(logicalWidth - margin - classWidth, y, classWidth, absenceHeight);
    canvasText(ctx, 'חופש / היעדרות', logicalWidth - margin - classWidth/2, y + absenceHeight/2, 15, 900, 'center', '#7c5d24');
    dates.forEach((date, index) => {
      const iso = dateISO(date), right = logicalWidth - margin - classWidth - index * dayWidth, left = right - dayWidth;
      const items = absences.filter((row) => row.absence_date === iso && row.absence_type !== 'day_off_worked');
      if (!items.length) { canvasText(ctx, 'אין', left + dayWidth/2, y + absenceHeight/2, 12, 600, 'center', '#a39a87'); return; }
      items.forEach((item, itemIndex) => {
        const name = employeeById(item.employee_id)?.full_name || item.employee_name || 'עובד';
        const line = `${name} · ${absenceLabel(item.absence_type)}`;
        canvasText(ctx, line, right - 10, y + 18 + itemIndex * 27, 11, 700, 'right', item.absence_type === 'leave' ? '#7a5b19' : '#75504b');
      });
    });
    canvasText(ctx, `נוצר ${formatDate(new Date(),{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}`, margin, logicalHeight - 16, 10, 600, 'left', '#999ca8');
    return canvas;
  }

  drawWeeklyScheduleCanvas = highQualityWeeklyCanvas;

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0); const out = new Uint8Array(total); let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; } return out;
  }
  function ascii(text) { return new TextEncoder().encode(String(text)); }

  async function pdfBlobFromCanvas(canvas) {
    const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.995));
    if (!jpegBlob) throw new Error('לא ניתן להכין PDF');
    const image = new Uint8Array(await jpegBlob.arrayBuffer());
    const pageW = 841.89, pageH = 595.28, margin = 12;
    const scale = Math.min((pageW - margin*2) / canvas.width, (pageH - margin*2) / canvas.height);
    const drawW = canvas.width * scale, drawH = canvas.height * scale, x = (pageW-drawW)/2, y = (pageH-drawH)/2;
    const content = ascii(`q\n${drawW.toFixed(3)} 0 0 ${drawH.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm\n/Im0 Do\nQ\n`);
    const parts = []; const offsets = [0]; let length = 0;
    const push = (bytes) => { parts.push(bytes); length += bytes.length; };
    push(ascii('%PDF-1.4\n%âãÏÓ\n'));
    const object = (id, bodyParts) => { offsets[id] = length; push(ascii(`${id} 0 obj\n`)); for (const p of bodyParts) push(p); push(ascii('\nendobj\n')); };
    object(1, [ascii('<< /Type /Catalog /Pages 2 0 R >>')]);
    object(2, [ascii('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')]);
    object(3, [ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`)]);
    object(4, [ascii(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, ascii('\nendstream')]);
    object(5, [ascii(`<< /Length ${content.length} >>\nstream\n`), content, ascii('endstream')]);
    const xrefOffset = length; push(ascii('xref\n0 6\n0000000000 65535 f \n'));
    for (let id=1; id<=5; id++) push(ascii(`${String(offsets[id]).padStart(10,'0')} 00000 n \n`));
    push(ascii(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
    return new Blob([concatBytes(parts)], { type:'application/pdf' });
  }

  function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function shareFile(blob, filename, title, text) {
    const file = new File([blob], filename, { type:blob.type, lastModified:Date.now() });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files:[file] }))) {
      try { await navigator.share({ files:[file], title, text }); return 'shared'; }
      catch (error) { if (error?.name === 'AbortError') return 'cancelled'; }
    }
    downloadFile(blob, filename); return 'downloaded';
  }

  async function exportWeeklyPdf(event) {
    event?.preventDefault?.(); event?.stopImmediatePropagation?.();
    const button = document.querySelector('#printBtn'); setBusy(button, true, 'מכין PDF איכותי…');
    try {
      await document.fonts?.ready; const canvas = highQualityWeeklyCanvas(schedulePayloadFromState(), state.weekStart, 'שיבוץ שבועי', 2.15);
      const blob = await pdfBlobFromCanvas(canvas); const filename = `שיבוץ-מעון-הדס-${dateISO(state.weekStart)}.pdf`;
      const result = await shareFile(blob, filename, 'שיבוץ שבועי – מעון הדס', `שיבוץ שבועי ${weekRangeLabel()}`);
      if (result === 'downloaded') showToast('קובץ ה-PDF נשמר', 'success');
    } catch (error) { showToast(error.message, 'error'); }
    finally { setBusy(button, false); }
  }

  async function exportWeekImage(event) {
    event?.preventDefault?.(); event?.stopImmediatePropagation?.();
    const button = document.querySelector('#imageBtn'); setBusy(button, true, 'מכין תמונה…');
    try {
      await document.fonts?.ready; const canvas = highQualityWeeklyCanvas(schedulePayloadFromState(), state.weekStart, 'שיבוץ שבועי', 1.55);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('לא ניתן להכין את התמונה');
      await shareFile(blob, `שיבוץ-שבועי-${dateISO(state.weekStart)}.png`, 'שיבוץ שבועי – מעון הדס', `שיבוץ שבועי לתאריכים ${weekRangeLabel()}`);
    } catch (error) { if (error?.name !== 'AbortError') showToast(error.message, 'error'); }
    finally { setBusy(button, false); }
  }

  function absenceRows() {
    return (state.scheduleAbsences || []).filter((item) => ['leave','day_off','sick'].includes(item.absence_type)).sort((a,b) => `${a.absence_date}-${employeeById(a.employee_id)?.full_name || ''}`.localeCompare(`${b.absence_date}-${employeeById(b.employee_id)?.full_name || ''}`,'he'));
  }

  function absencePdfCanvas(scale = 2) {
    const rows = absenceRows(); const logicalWidth = 1280, margin = 44, header = 120, rowH = 46;
    const logicalHeight = Math.max(430, margin*2 + header + Math.max(1, rows.length)*rowH + 70);
    const canvas = document.createElement('canvas'); canvas.width = logicalWidth*scale; canvas.height = logicalHeight*scale;
    const ctx = canvas.getContext('2d'); ctx.scale(scale,scale); ctx.fillStyle='#fff';ctx.fillRect(0,0,logicalWidth,logicalHeight);
    ctx.fillStyle='#f5f4ff';ctx.fillRect(margin,margin,logicalWidth-margin*2,90);
    canvasText(ctx,'חופשות והיעדרויות – מעון הדס',logicalWidth-margin-24,margin+30,27,900);
    canvasText(ctx,weekRangeLabel(),logicalWidth-margin-24,margin+64,16,700,'right','#656a80');
    let y=margin+header;
    ctx.fillStyle='#eceeff';ctx.fillRect(margin,y,logicalWidth-margin*2,42);
    canvasText(ctx,'תאריך',logicalWidth-margin-30,y+21,14,900);canvasText(ctx,'עובד',logicalWidth-margin-250,y+21,14,900);canvasText(ctx,'סוג',logicalWidth-margin-650,y+21,14,900);canvasText(ctx,'כיתה',margin+220,y+21,14,900,'left');
    y+=42;
    if(!rows.length){canvasText(ctx,'אין חופשות או היעדרויות מאושרות בשבוע זה',logicalWidth/2,y+70,18,700,'center','#777b8c');}
    rows.forEach((item,index)=>{const employee=employeeById(item.employee_id);ctx.fillStyle=index%2?'#fbfbfd':'#fff';ctx.fillRect(margin,y,logicalWidth-margin*2,rowH);ctx.strokeStyle='#e5e6ed';ctx.beginPath();ctx.moveTo(margin,y+rowH);ctx.lineTo(logicalWidth-margin,y+rowH);ctx.stroke();canvasText(ctx,`${DAY_NAMES[parseDateValue(item.absence_date).getDay()]} ${formatDate(item.absence_date,{day:'2-digit',month:'2-digit'})}`,logicalWidth-margin-30,y+rowH/2,13,700);canvasText(ctx,employee?.full_name||item.employee_name||'עובד',logicalWidth-margin-250,y+rowH/2,14,800);canvasText(ctx,absenceLabel(item.absence_type),logicalWidth-margin-650,y+rowH/2,13,700);canvasText(ctx,fixedClassLabel(item.employee_id)||'—',margin+220,y+rowH/2,13,700,'left');y+=rowH;});
    canvasText(ctx,'הקובץ כולל חופשה, יום חופשי חד-פעמי ומחלה מאושרים; ימים חופשיים קבועים אינם נכללים.',logicalWidth-margin-20,logicalHeight-35,11,600,'right','#8a8d9a');
    return canvas;
  }

  async function exportAbsencePdf(event) {
    event?.preventDefault?.(); const button = document.querySelector('#v027AbsencePdfBtn'); setBusy(button,true,'מכין PDF…');
    try { await document.fonts?.ready; const blob=await pdfBlobFromCanvas(absencePdfCanvas(2.15)); await shareFile(blob,`חופשות-מעון-הדס-${dateISO(state.weekStart)}.pdf`,'חופשות השבוע – מעון הדס',`חופשות והיעדרויות לתאריכים ${weekRangeLabel()}`); }
    catch(error){showToast(error.message,'error');} finally{setBusy(button,false);}
  }

  function installExportHandlers() {
    const pdf = document.querySelector('#printBtn'); const image = document.querySelector('#imageBtn');
    if (pdf && !pdf.dataset.v027Export) { pdf.dataset.v027Export='true'; pdf.addEventListener('click', exportWeeklyPdf, true); }
    if (image && !image.dataset.v027Export) { image.dataset.v027Export='true'; image.addEventListener('click', exportWeekImage, true); }
  }

  function autoWeekButton(offset) {
    const current=startOfWeek(new Date()), start=addDays(current,offset*7), end=addDays(start,5), value=dateISO(start);
    const label=offset===-1?'שבוע שעבר':offset===0?'השבוע':offset===1?'שבוע הבא':'בעוד שבועיים';
    return `<button type="button" data-v027-auto-week="${value}" class="${document.querySelector('#autoScheduleWeek')?.value===value?'active':''}"><strong>${label}</strong><small>${formatDate(start,{day:'2-digit',month:'2-digit'})}–${formatDate(end,{day:'2-digit',month:'2-digit'})}</small></button>`;
  }

  function enhanceAutoWeekSelector() {
    const picker=document.querySelector('.auto-week-picker'); if(!picker)return;
    let quick=picker.querySelector('.v027-auto-week-quick'); if(!quick){quick=document.createElement('div');quick.className='v027-auto-week-quick';picker.insertBefore(quick,picker.querySelector('select'));}
    quick.innerHTML=[-1,0,1,2].map(autoWeekButton).join('');
    const select=picker.querySelector('#autoScheduleWeek'); if(select) select.setAttribute('aria-label','בחירת שבוע אחר');
    renderAutoClosureHint();
  }

  function renderAutoClosureHint() {
    const picker=document.querySelector('.auto-week-picker'); if(!picker)return;
    picker.querySelector('.v027-auto-closures')?.remove();
    const start=autoSelectedWeekStart(); const dates=Array.from({length:6},(_,i)=>dateISO(addDays(start,i))).filter((date)=>generalDayOff(date));
    if(!dates.length)return;
    const hint=document.createElement('div');hint.className='v027-auto-closures';hint.innerHTML=`<strong>☀ לא ישובצו:</strong> ${dates.map((date)=>`${DAY_NAMES[parseDateValue(date).getDay()]} ${formatDate(date,{day:'2-digit',month:'2-digit'})}`).join(', ')}`;picker.append(hint);
  }

  async function prepareAutoScheduleDialog(event) {
    event.preventDefault(); event.stopImmediatePropagation();
    await loadGeneralDaysOffForWeek(state.weekStart).catch(()=>{});
    const original = window.__v027OriginalAutoOpen || openAutoScheduleDialog;
    original();
    enhanceAutoWeekSelector();
  }

  function installAutoWeekEnhancements() {
    const openButton=document.querySelector('#autoScheduleBtn');
    if(openButton&&!openButton.dataset.v027Auto){openButton.dataset.v027Auto='true';window.__v027OriginalAutoOpen=openAutoScheduleDialog;openButton.addEventListener('click',prepareAutoScheduleDialog,true);}
    const dialog=document.querySelector('#autoScheduleDialog'); if(!dialog||dialog.dataset.v027Weeks)return;dialog.dataset.v027Weeks='true';
    dialog.addEventListener('click',async(event)=>{const button=event.target.closest('[data-v027-auto-week]');if(!button)return;const select=document.querySelector('#autoScheduleWeek');select.value=button.dataset.v027AutoWeek;select.dispatchEvent(new Event('change',{bubbles:true}));await loadGeneralDaysOffForWeek(button.dataset.v027AutoWeek).catch(()=>{});enhanceAutoWeekSelector();});
    document.querySelector('#autoScheduleWeek')?.addEventListener('change',async(event)=>{await loadGeneralDaysOffForWeek(event.target.value).catch(()=>{});enhanceAutoWeekSelector();});
  }

  revalidateAutomaticPreview = async function v027RevalidateAutomaticPreview() {
    const previous = new Map(state.autoScheduleIssueDecisions);
    await previousRevalidateAutomaticPreview();
    for (const item of state.autoSchedulePreview?.validation?.errors || []) {
      const prior = previous.get(autoIssueKey(item));
      if (prior === 'rejected' || (prior === 'approved' && autoIssueCanApprove(item))) state.autoScheduleIssueDecisions.set(autoIssueKey(item), prior);
    }
    renderAutomaticSchedulePreview(state.autoSchedulePreview);
  };

  applyAutomaticSchedule = async function v027ApplyAutomaticSchedule() {
    const preview=state.autoSchedulePreview;if(!preview)return false;
    const errors=preview.validation?.errors||[];
    const hard=errors.filter((item)=>!autoIssueCanApprove(item));
    if(hard.length){showToast(`יש ${hard.length} נקודות שחייבות תיקון לפני החלת השיבוץ.`,'error');return false;}
    const decisions=errors.map((item)=>state.autoScheduleIssueDecisions.get(autoIssueKey(item))||'');
    const undecided=decisions.filter((value)=>!value||value==='fixing').length;
    if(undecided){showToast(`יש ${undecided} נקודות שעדיין דורשות החלטה.`,'error');return false;}
    const rejected=decisions.filter((value)=>value==='rejected').length;
    const button=document.querySelector('#autoSchedulePreview [data-auto-action="apply"]');setBusy(button,true,'שומר טיוטה…');
    try{
      const result=await apiFetch('/api/shifts',{method:'POST',body:{action:'auto_apply',week_start:preview.weekStart,mode:preview.mode,selected_dates:preview.selectedDates||state.autoScheduleSelectedDates,signature:preview.signature,manual_generated:state.autoScheduleManualGenerated,allow_incomplete:errors.length>0},timeout:30000});
      document.querySelector('#autoScheduleDialog')?.close();state.shiftSuggestionCache.clear();state.weekStart=startOfWeek(parseDateValue(preview.weekStart));await refreshScheduleWeek({force:true});state.scheduleIssuesOpen=rejected>0;renderValidationPanel(state.scheduleIssuesOpen);
      showToast(rejected?`השיבוץ נשמר עם ${rejected} נקודות שסומנו לבדיקה`:`נשמרו ${result.count||0} שיבוצים אוטומטיים בטיוטה`,'success');
      return true;
    }catch(error){if(error.status===409&&/השתנו/.test(error.message)){showToast(error.message,'error');}else showToast(error.message,'error');return false;}finally{setBusy(button,false);}
  };

  function installGeneralDayOffCalendarType() {
    const grid=document.querySelector('.calendar-type-grid');if(!grid||grid.querySelector('[data-v027-general-day-off]'))return;
    const label=document.createElement('label');label.className='general-day-off manager-only';label.dataset.v027GeneralDayOff='true';label.innerHTML='<input type="radio" name="event_type" value="general_day_off" /><span>☀</span><strong>יום חופשי כללי</strong>';
    grid.append(label);label.classList.toggle('hidden',!isManager());
    const form=document.querySelector('#calendarForm');
    form?.addEventListener('change',(event)=>{if(event.target.name==='event_type')syncGeneralCalendarForm();});
  }

  function syncGeneralCalendarForm() {
    const form=document.querySelector('#calendarForm');if(!form)return;const general=form.elements.event_type?.value==='general_day_off';
    for(const name of ['visibility','class_id','start_time','end_time']){const input=form.elements[name];if(input){input.disabled=general;input.closest('label')?.classList.toggle('v027-general-disabled',general);}}
    if(general){form.elements.visibility.value='all';form.elements.class_id.value='';form.elements.start_time.value='';form.elements.end_time.value='';if(!form.elements.title.value.trim())form.elements.title.value='יום חופשי כללי';}
    let note=form.querySelector('.v027-general-calendar-note');if(general&&!note){note=document.createElement('div');note.className='v027-general-calendar-note';note.innerHTML='<strong>השפעה על השיבוץ</strong><span>המעון ייחשב סגור לכל הצוות ביום זה. שיבוצים קיימים יוסרו אם אין עליהם דיווחים/בקשות פתוחות, והשיבוץ האוטומטי ידלג על היום.</span>';form.querySelector('.form-grid')?.insertAdjacentElement('afterend',note);}else if(!general)note?.remove();
  }

  openCalendarDialog = function v027OpenCalendarDialog(event = {}) {
    previousOpenCalendarDialog(event);
    installGeneralDayOffCalendarType();
    if(event?.is_general_day_off){const radio=document.querySelector('#calendarForm input[name="event_type"][value="general_day_off"]');if(radio)radio.checked=true;}
    syncGeneralCalendarForm();
  };

  async function saveGeneralDayOff(event) {
    const form=event.currentTarget;if(form.elements.event_type?.value!=='general_day_off')return;
    event.preventDefault();event.stopImmediatePropagation();const button=form.querySelector('button[value="default"]');setBusy(button,true,'שומר יום חופשי…');
    try{const data=formObject(form);data.event_type='general_day_off';data.general_day_off=true;const result=await apiFetch('/api/calendar',{method:'POST',body:data,timeout:15000});document.querySelector('#calendarDialog')?.close();state.v027GeneralDayOffMonths.clear();await loadGeneralDaysOffForWeek(state.weekStart,{force:true});await setCalendarMonth(state.calendarMonth);if(currentWeekDates().map(dateISO).includes(data.event_date))await refreshScheduleWeek({force:true});showToast(result.deleted_shifts?`יום החופש נשמר והוסרו ${result.deleted_shifts} שיבוצים`:'יום החופש הכללי נשמר','success');}catch(error){showToast(error.message,'error');}finally{setBusy(button,false);}
  }

  function installGeneralCalendarSubmit() {
    const form=document.querySelector('#calendarForm');if(!form||form.dataset.v027Submit)return;form.dataset.v027Submit='true';form.addEventListener('submit',saveGeneralDayOff,true);
  }

  renderCalendar = function v027RenderCalendar(...args) {
    for(const event of state.calendarEvents||[]){if(event.is_general_day_off){event.title=event.title||'יום חופשי כללי';}}
    const result=previousRenderCalendar(...args);requestAnimationFrame(()=>{installGeneralDayOffCalendarType();document.querySelectorAll('[data-event-id]').forEach((button)=>{const event=state.calendarEvents.find((item)=>item.id===button.dataset.eventId);button.classList.toggle('v027-general-event',Boolean(event?.is_general_day_off));});});return result;
  };

  openCalendarEvent = function v027OpenCalendarEvent(event) {
    previousOpenCalendarEvent(event);
    if(event?.is_general_day_off){const details=document.querySelector('#calendarEventDetails');details?.insertAdjacentHTML('beforeend','<div class="event-detail-row v027-general-impact"><strong>השפעה על השיבוץ</strong><span>יום חופשי כללי — אין שיבוצים לצוות ביום זה.</span></div>');}
  };

  function initialize() {
    ensureVersion();installExportHandlers();installPickerFilterEvents();installValidationButton();installAutoWeekEnhancements();installGeneralDayOffCalendarType();installGeneralCalendarSubmit();fixWeekArrows();
    loadGeneralDaysOffForWeek(state.weekStart).then(()=>{if(state.activeTab==='schedule')renderSchedule();}).catch(()=>{});
    requestAnimationFrame(enhanceScheduleV027);
  }

  initialize();
  setTimeout(initialize,700);
})();
