/* מערכת ניהול שיבוצים מעון הדס — השלמות ממשק לגרסה 0.26.0 */
(() => {
  const VERSION = '0.26.0';
  const originalApiFetch = apiFetch;
  const originalRefreshScheduleWeek = refreshScheduleWeek;
  const originalRenderSchedule = renderSchedule;
  const originalRenderCalendar = renderCalendar;
  const originalOpenCalendarEvent = openCalendarEvent;
  const originalFetchMatchingCandidates = fetchMatchingCandidates;
  const originalOpenShiftDialog = openShiftDialog;
  const originalOpenRequestDialog = openRequestDialog;
  const originalPrintWeeklySchedule = printWeeklySchedule;
  const originalDownloadScheduleImage = downloadScheduleImage;
  let skipNextForcedScheduleRefresh = false;
  let movingShift = false;

  function ensureVersionVisible() {
    const badge = document.querySelector('#appVersionBadge');
    if (badge) {
      badge.textContent = `v${VERSION}`;
      badge.classList.add('v025-mobile-visible');
      badge.title = `גרסת מערכת ${VERSION}`;
    }
    const loginVersion = document.querySelector('#loginVersion');
    if (loginVersion) loginVersion.textContent = `גרסה ${VERSION}`;
  }

  function currentWeekContains(dateValue) {
    const value = String(dateValue || '');
    const start = dateISO(state.weekStart);
    const end = dateISO(addDays(state.weekStart, 5));
    return value >= start && value <= end;
  }

  function applyShiftLocally(shift) {
    if (!shift?.id) return;
    state.shifts = state.shifts.filter((item) => item.id !== shift.id);
    if (currentWeekContains(shift.shift_date)) state.shifts.push(shift);
    state.weekCache.delete(scheduleCacheKey(state.weekStart));
    state.scheduleValidationCache = { key: '', value: null };
  }

  function leaveEmployeeName(event) {
    const employee = employeeById(event?.employee_id);
    if (employee?.full_name) return employee.full_name;
    if (event?.employee_id === state.profile?.id && state.profile?.full_name) return state.profile.full_name;
    const title = String(event?.title || '');
    const fromTitle = title.includes('·') ? title.split('·').slice(1).join('·').trim() : '';
    return fromTitle || 'עובד/ת';
  }

  function decorateLeaveEvent(event) {
    if (!event || event.source !== 'approved_leave') return event;
    const name = leaveEmployeeName(event);
    event.employee_name = name;
    event.title = `חופשה של ${name}`;
    event.description = `חופשה מאושרת במערכת הבקשות · ${name}`;
    return event;
  }

  function decorateCalendarEvents(events) {
    (events || []).forEach(decorateLeaveEvent);
    return events;
  }

  apiFetch = async function v026ApiFetch(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    let nextOptions = options;
    const path = String(url).split('?')[0];
    if (path === '/api/shifts' && method === 'PATCH' && options.body && !options.body.action) {
      nextOptions = { ...options, body: { ...options.body, complete_payload: true } };
    }

    const result = await originalApiFetch(url, nextOptions);

    if (String(url).startsWith('/api/calendar') && result?.events) decorateCalendarEvents(result.events);

    if (path === '/api/shifts' && result?.shift) {
      applyShiftLocally(result.shift);
      const action = nextOptions.body?.action;
      if (!action || action === 'apply_suggestion') skipNextForcedScheduleRefresh = true;
    }
    return result;
  };

  refreshScheduleWeek = async function v026RefreshScheduleWeek(options = {}) {
    if (skipNextForcedScheduleRefresh && options?.force) {
      skipNextForcedScheduleRefresh = false;
      if (state.activeTab === 'schedule') renderSchedule();
      setTimeout(() => originalRefreshScheduleWeek({ force: true }).catch(() => {}), 40);
      return schedulePayloadFromState();
    }
    return originalRefreshScheduleWeek(options);
  };

  function injectClearWeekButton() {
    const container = document.querySelector('.schedule-secondary-actions');
    if (!container) return;
    let button = document.querySelector('#clearWeekBtn');
    if (!button) {
      button = document.createElement('button');
      button.id = 'clearWeekBtn';
      button.type = 'button';
      button.className = 'danger-btn manager-only v025-clear-week';
      button.innerHTML = '<span aria-hidden="true">🗑</span> מחק שיבוץ';
      button.title = 'איפוס כל השיבוצים בשבוע הנבחר';
      container.append(button);
      button.addEventListener('click', clearSelectedWeek);
    }
    button.classList.toggle('hidden', !isManager());
  }

  async function clearSelectedWeek() {
    if (!isManager()) return;
    const weekStart = dateISO(state.weekStart);
    const weekEnd = dateISO(addDays(state.weekStart, 5));
    const count = state.shifts.length;
    const firstApproval = confirm(`למחוק את כל השיבוץ של השבוע ${formatDate(weekStart)}–${formatDate(weekEnd)}?\n\nהפעולה תאפס ${count} שיבוצים מהטיוטה. אם השבוע כבר פורסם, העובדים ימשיכו לראות את הגרסה שפורסמה עד לפרסום חדש.`);
    if (!firstApproval) return;
    const secondApproval = confirm(`אישור שני ואחרון: למחוק את כל ${count} השיבוצים בשבוע הנבחר?\n\nלא ניתן לבטל את האיפוס מתוך המסך.`);
    if (!secondApproval) return;

    const button = document.querySelector('#clearWeekBtn');
    const wasPublished = Boolean(state.publication?.published_at);
    setBusy(button, true, 'מאפס שבוע…');
    try {
      const result = await apiFetch('/api/shifts', { method: 'POST', body: { action: 'clear_week', week_start: weekStart }, timeout: 15000 });
      state.shifts = [];
      state.weekCache.delete(scheduleCacheKey(state.weekStart));
      state.scheduleValidationCache = { key: '', value: null };
      renderSchedule();
      showToast(result.count ? `נמחקו ${result.count} שיבוצים מהשבוע` : 'השבוע כבר היה ריק', 'success');
      setTimeout(() => originalRefreshScheduleWeek({ force: true }).catch(() => {}), 60);
      if (wasPublished && result.count) showPostPublishChangePrompt({ title: 'השבוע אופס לאחר שכבר פורסם', message: 'האיפוס נשמר כטיוטה. הצוות ימשיך לראות את הגרסה הקודמת עד לפרסום מחדש.' });
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setBusy(button, false);
    }
  }

  function dropMeta(element) {
    const zone = element?.closest?.('[data-v025-drop-date][data-v025-drop-class]');
    if (!zone) return null;
    return { zone, date: zone.dataset.v025DropDate, classId: zone.dataset.v025DropClass };
  }

  function markDropZones() {
    const root = document.querySelector('#scheduleExport');
    if (!root || !isManager()) return;
    root.querySelectorAll('.schedule-cell, .mobile-week-class, .day-class-card').forEach((zone) => {
      const addButton = zone.querySelector('[data-action="add"][data-date][data-class], .mobile-add-shift[data-date][data-class]');
      if (!addButton) return;
      zone.dataset.v025DropDate = addButton.dataset.date;
      zone.dataset.v025DropClass = addButton.dataset.class;
    });
    root.querySelectorAll('.shift-item[data-shift-id]').forEach((card) => {
      card.draggable = true;
      card.classList.add('v025-draggable-shift');
      card.title = `${card.title ? `${card.title} · ` : ''}אפשר לגרור לכיתה או ליום אחר`;
    });
  }

  function clearDropHighlight() {
    document.querySelectorAll('.v025-drop-active').forEach((zone) => zone.classList.remove('v025-drop-active'));
    document.body.classList.remove('v025-shift-dragging');
  }

  async function moveShiftTo(shiftId, targetDate, targetClassId) {
    if (movingShift || !isManager()) return;
    const shift = state.shifts.find((item) => item.id === shiftId);
    if (!shift) return;
    if (shift.shift_date === targetDate && shift.class_id === targetClassId) {
      showToast('השיבוץ כבר נמצא במקום הזה');
      return;
    }
    const employeeName = employeeById(shift.employee_id)?.full_name || 'העובד';
    const wasPublished = isPublishedWeekDate(shift.shift_date) || isPublishedWeekDate(targetDate);
    movingShift = true;
    setSyncState('syncing', `מעביר את ${employeeName}…`);
    try {
      const result = await apiFetch('/api/shifts', {
        method: 'POST',
        body: { action: 'move', id: shift.id, shift_date: targetDate, class_id: targetClassId },
        timeout: 12000,
      });
      if (result.shift) applyShiftLocally(result.shift);
      renderSchedule();
      showToast(`${employeeName} הועבר/ה ל-${classById(targetClassId)?.name || 'הכיתה'} והשינוי נשמר בטיוטה`, 'success');
      setTimeout(() => originalRefreshScheduleWeek({ force: true }).catch(() => {}), 50);
      if (wasPublished) showPostPublishChangePrompt({ title: 'שיבוץ פורסם הועבר', message: `ההעברה של ${employeeName} נשמרה בטיוטה. יש לפרסם כדי שהצוות יראה אותה.` });
    } catch (error) {
      showToast(error.message, 'error');
      setSyncState('online', 'מעודכן בזמן אמת');
    } finally {
      movingShift = false;
      clearDropHighlight();
    }
  }

  function installDragAndDrop() {
    const root = document.querySelector('#scheduleExport');
    if (!root || root.dataset.v025DragInstalled) return;
    root.dataset.v025DragInstalled = 'true';

    root.addEventListener('dragstart', (event) => {
      const card = event.target.closest('.shift-item[data-shift-id]');
      if (!card || !isManager()) return;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.dataset.shiftId);
      card.classList.add('v025-drag-source');
      document.body.classList.add('v025-shift-dragging');
    });

    root.addEventListener('dragover', (event) => {
      const meta = dropMeta(event.target);
      if (!meta || !isManager()) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.v025-drop-active').forEach((zone) => { if (zone !== meta.zone) zone.classList.remove('v025-drop-active'); });
      meta.zone.classList.add('v025-drop-active');
    });

    root.addEventListener('dragleave', (event) => {
      const meta = dropMeta(event.target);
      if (meta?.zone && !meta.zone.contains(event.relatedTarget)) meta.zone.classList.remove('v025-drop-active');
    });

    root.addEventListener('drop', (event) => {
      const meta = dropMeta(event.target);
      if (!meta || !isManager()) return;
      event.preventDefault();
      const shiftId = event.dataTransfer.getData('text/plain');
      moveShiftTo(shiftId, meta.date, meta.classId);
    });

    root.addEventListener('dragend', (event) => {
      event.target.closest('.v025-drag-source')?.classList.remove('v025-drag-source');
      clearDropHighlight();
    });
  }

  function enhanceSchedule() {
    injectClearWeekButton();
    markDropZones();
    installDragAndDrop();
    simplifyWeeklyExportTools();
    ensureVersionVisible();
  }

  renderSchedule = function v026RenderSchedule(...args) {
    const result = originalRenderSchedule(...args);
    requestAnimationFrame(enhanceSchedule);
    return result;
  };

  renderCalendar = function v026RenderCalendar(...args) {
    decorateCalendarEvents(state.calendarEvents);
    return originalRenderCalendar(...args);
  };

  openCalendarEvent = function v026OpenCalendarEvent(event) {
    decorateLeaveEvent(event);
    originalOpenCalendarEvent(event);
    if (event?.source === 'approved_leave') {
      const details = document.querySelector('#calendarEventDetails');
      const name = leaveEmployeeName(event);
      if (details) details.insertAdjacentHTML('beforeend', `<div class="event-detail-row v025-leave-owner"><strong>מי בחופשה</strong><span>${escapeHtml(name)}</span></div>`);
    }
  };

  function absencePdfPalette(type) {
    if (type === 'day_off_worked') return { fill: '#edf9f1', border: '#add7bb', text: '#2f754a' };
    if (type === 'fixed_day_off') return { fill: '#f2f1fb', border: '#d6d2e8', text: '#5f5b78' };
    if (type === 'day_off') return { fill: '#fff0f0', border: '#efb1b1', text: '#923b3b' };
    if (type === 'leave') return { fill: '#fff8e8', border: '#ead29b', text: '#7a5b19' };
    if (type === 'sick') return { fill: '#fff4ea', border: '#e6c1a5', text: '#815133' };
    return { fill: '#f6f7fa', border: '#dfe1e8', text: '#676b78' };
  }

  drawWeeklyScheduleCanvas = function v026DrawWeeklyScheduleCanvas(payload = schedulePayloadFromState(), weekStart = state.weekStart, title = 'שיבוץ שבועי') {
    const layout = weeklyExportLayout(payload, weekStart);
    const canvas = document.createElement('canvas');
    canvas.width = layout.width; canvas.height = layout.height;
    const ctx = canvas.getContext('2d');
    ctx.direction = 'rtl';
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);

    const { margin, width, dates, shifts, classes, rowHeights, absenceHeight, headerHeight, daysHeaderHeight } = layout;
    const contentWidth = width - margin * 2;
    const classColumnWidth = 150;
    const dayWidth = (contentWidth - classColumnWidth) / 6;

    fillRoundedRect(ctx, margin, margin, contentWidth, headerHeight - 12, 24, '#f5f4ff', '#dedff0');
    drawCanvasText(ctx, 'מערכת ניהול שיבוצים מעון הדס', width - margin - 28, margin + 31, 760, { font: '800 22px Arial', color: '#6267bb' });
    drawCanvasText(ctx, title, width - margin - 28, margin + 72, 760, { font: '900 42px Arial', color: '#2f3246' });
    drawCanvasText(ctx, `${formatDate(weekStart, { day: 'numeric', month: 'long' })} – ${formatDate(addDays(weekStart, 5), { day: 'numeric', month: 'long', year: 'numeric' })}`, margin + 28, margin + 67, 650, { font: '800 26px Arial', color: '#474b66', align: 'left' });

    let y = margin + headerHeight;
    fillRoundedRect(ctx, margin, y, contentWidth, daysHeaderHeight, 16, '#eef0ff', '#dcdfee');
    drawCanvasText(ctx, 'כיתה', width - margin - classColumnWidth / 2, y + daysHeaderHeight / 2, classColumnWidth - 20, { font: '900 22px Arial', align: 'center' });
    dates.forEach((date, index) => {
      const xRight = width - margin - classColumnWidth - index * dayWidth;
      drawCanvasText(ctx, DAY_NAMES[date.getDay()], xRight - dayWidth / 2, y + 23, dayWidth - 20, { font: '900 20px Arial', align: 'center' });
      drawCanvasText(ctx, formatDate(date, { day: '2-digit', month: '2-digit' }), xRight - dayWidth / 2, y + 46, dayWidth - 20, { font: '700 15px Arial', color: '#777b91', align: 'center' });
      if (index < 5) { ctx.strokeStyle = '#d9dcea'; ctx.beginPath(); ctx.moveTo(xRight - dayWidth, y); ctx.lineTo(xRight - dayWidth, y + daysHeaderHeight); ctx.stroke(); }
    });
    y += daysHeaderHeight;

    classes.forEach((classItem, rowIndex) => {
      const rowHeight = rowHeights[rowIndex];
      ctx.fillStyle = rowIndex % 2 ? '#fcfcff' : '#ffffff'; ctx.fillRect(margin, y, contentWidth, rowHeight);
      ctx.strokeStyle = '#e2e4ed'; ctx.lineWidth = 1; ctx.strokeRect(margin, y, contentWidth, rowHeight);
      ctx.fillStyle = '#f8f7ff'; ctx.fillRect(width - margin - classColumnWidth, y, classColumnWidth, rowHeight);
      drawCanvasText(ctx, classItem.name, width - margin - classColumnWidth / 2, y + rowHeight / 2, classColumnWidth - 24, { font: '900 27px Arial', align: 'center' });

      dates.forEach((date, index) => {
        const iso = dateISO(date);
        const items = sortScheduleRows(shifts.filter((shift) => shift.shift_date === iso && shift.class_id === classItem.id));
        const cellRight = width - margin - classColumnWidth - index * dayWidth;
        const cellLeft = cellRight - dayWidth;
        ctx.strokeStyle = '#e4e6ef'; ctx.beginPath(); ctx.moveTo(cellLeft, y); ctx.lineTo(cellLeft, y + rowHeight); ctx.stroke();
        if (!items.length) {
          drawCanvasText(ctx, '—', cellLeft + dayWidth / 2, y + rowHeight / 2, dayWidth - 30, { font: '700 25px Arial', color: '#b2b4c0', align: 'center' });
          return;
        }
        items.forEach((shift, itemIndex) => {
          const employee = employeeById(shift.employee_id);
          const cardY = y + 8 + itemIndex * 40;
          if (cardY + 34 > y + rowHeight) return;
          const palette = exportRolePalette(shift.shift_role);
          fillRoundedRect(ctx, cellLeft + 7, cardY, dayWidth - 14, 34, 8, palette.fill, palette.border);
          drawCanvasText(ctx, employee?.full_name || 'עובד', cellRight - 16, cardY + 12, dayWidth - 102, { font: '800 16px Arial', color: '#303348' });
          drawCanvasText(ctx, isolateCanvasLtr(`${trimTime(shift.start_time)}-${trimTime(shift.end_time)}`), cellLeft + 16, cardY + 12, 92, { font: '800 14px Arial', color: palette.accent, align: 'left' });
          const note = [SHIFT_ROLE_SHORT_LABELS[shift.shift_role] || '', shift.public_note].filter(Boolean).join(' · ');
          drawCanvasText(ctx, note, cellRight - 16, cardY + 25, dayWidth - 32, { font: '600 12px Arial', color: '#74788b' });
        });
      });
      y += rowHeight;
    });

    const absences = payload.scheduleAbsences || [];
    ctx.fillStyle = '#fffaf0'; ctx.fillRect(margin, y, contentWidth, absenceHeight);
    ctx.strokeStyle = '#eadfca'; ctx.strokeRect(margin, y, contentWidth, absenceHeight);
    ctx.fillStyle = '#fff4d8'; ctx.fillRect(width - margin - classColumnWidth, y, classColumnWidth, absenceHeight);
    drawCanvasText(ctx, 'חופש / היעדרות', width - margin - classColumnWidth / 2, y + absenceHeight / 2, classColumnWidth - 20, { font: '900 20px Arial', color: '#7d5c1f', align: 'center' });
    dates.forEach((date, index) => {
      const cellRight = width - margin - classColumnWidth - index * dayWidth;
      const cellLeft = cellRight - dayWidth;
      const items = absences.filter((item) => item.absence_date === dateISO(date));
      ctx.strokeStyle = '#eadfca'; ctx.beginPath(); ctx.moveTo(cellLeft, y); ctx.lineTo(cellLeft, y + absenceHeight); ctx.stroke();
      if (!items.length) drawCanvasText(ctx, 'אין', cellLeft + dayWidth / 2, y + absenceHeight / 2, dayWidth - 24, { font: '600 14px Arial', color: '#a99b83', align: 'center' });
      items.forEach((item, itemIndex) => {
        const employee = employeeById(item.employee_id);
        const name = employee?.full_name || item.employee_name || 'עובד';
        const palette = absencePdfPalette(item.absence_type);
        const rowY = y + 8 + itemIndex * 24;
        fillRoundedRect(ctx, cellLeft + 7, rowY, dayWidth - 14, 20, 7, palette.fill, palette.border);
        const text = item.absence_type === 'fixed_day_off' ? name : `${name} · ${absenceLabel(item.absence_type)}`;
        drawCanvasText(ctx, text, cellRight - 12, rowY + 10, dayWidth - 24, { font: '700 12px Arial', color: palette.text });
      });
    });
    y += absenceHeight;
    drawCanvasText(ctx, `נוצר בתאריך ${formatDate(new Date(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`, margin, y + 22, 600, { font: '600 12px Arial', color: '#9699a7', align: 'left' });
    return canvas;
  };

  function previewVirtualShifts() {
    const preview = state.autoSchedulePreview;
    if (!preview) return [];
    const form = document.querySelector('#shiftForm');
    const editingIndex = Number.isInteger(Number(form?.dataset.autoPreviewIndex)) && form?.dataset.autoPreviewIndex !== ''
      ? Number(form.dataset.autoPreviewIndex) : null;
    const kept = (preview.finalRows || []).filter((row) => row?.id).map((row) => ({ ...row }));
    const generated = (state.autoScheduleManualGenerated || []).filter((_, index) => editingIndex === null || index !== editingIndex).map((row) => ({ ...row }));
    return [...kept, ...generated];
  }

  fetchMatchingCandidates = async function v026FetchMatchingCandidates(context, options = {}) {
    const form = document.querySelector('#shiftForm');
    if (form?.dataset.autoPreviewMode !== 'true' || !state.autoSchedulePreview) return originalFetchMatchingCandidates(context, options);
    const result = await apiFetch('/api/suggestions', {
      method: 'POST',
      body: {
        date: context.date,
        class_id: context.classId,
        start_time: context.start,
        end_time: context.end,
        shift_role: context.role || 'staff',
        mode: context.shiftId ? 'replace' : 'add',
        virtual_shifts: previewVirtualShifts(),
      },
      timeout: options.timeout || 9000,
    });
    return result;
  };

  function selectedShiftEmployeeBar(form) {
    let bar = document.querySelector('#v026SelectedEmployeeBar');
    if (bar) return bar;
    const picker = document.querySelector('.unified-shift-picker');
    if (!picker) return null;
    bar = document.createElement('div');
    bar.id = 'v026SelectedEmployeeBar';
    bar.className = 'v026-selected-employee hidden';
    bar.innerHTML = '<div><small>עובד בשיבוץ</small><strong id="v026SelectedEmployeeName">—</strong><span id="v026SelectedEmployeeMeta"></span></div><button id="v026ChangeEmployeeBtn" type="button" class="secondary-btn">החלפת עובד</button>';
    const search = picker.querySelector('.employee-picker-search');
    picker.insertBefore(bar, search || picker.firstChild);
    bar.querySelector('#v026ChangeEmployeeBtn').addEventListener('click', () => {
      picker.classList.remove('v026-picker-collapsed');
      picker.querySelector('#shiftEmployeeSearch')?.focus();
    });
    return bar;
  }

  function updateShiftEditSummary() {
    const form = document.querySelector('#shiftForm');
    const dialog = document.querySelector('#shiftDialog');
    if (!form || !dialog?.open) return;
    const employeeId = form.elements.employee_id?.value || '';
    const employee = employeeById(employeeId);
    const bar = selectedShiftEmployeeBar(form);
    if (bar) {
      bar.classList.toggle('hidden', !employee);
      const name = bar.querySelector('#v026SelectedEmployeeName');
      const meta = bar.querySelector('#v026SelectedEmployeeMeta');
      if (name) name.textContent = employee?.full_name || 'לא נבחר עובד';
      if (meta) meta.textContent = employee ? [employee.job_title, classById(form.elements.class_id?.value)?.name, form.elements.shift_date?.value ? formatDate(form.elements.shift_date.value) : '', `${trimTime(form.elements.start_time?.value)}-${trimTime(form.elements.end_time?.value)}`].filter(Boolean).join(' · ') : '';
    }
  }

  function enhanceShiftDialog(shift = {}) {
    const form = document.querySelector('#shiftForm');
    const dialog = document.querySelector('#shiftDialog');
    if (!form || !dialog) return;
    const previewEdit = Number.isInteger(shift?._autoPreviewIndex);
    const editing = Boolean(shift?.id) || previewEdit;
    form.dataset.v026Editing = editing ? 'true' : 'false';
    form.classList.add('v026-shift-form');
    dialog.classList.toggle('v026-edit-shift-dialog', editing);
    const heading = dialog.querySelector('.modal-heading h3');
    if (heading) heading.textContent = previewEdit ? 'תיקון שיבוץ מוצע' : editing ? 'עריכת שיבוץ' : 'הוספת שיבוץ';
    const picker = dialog.querySelector('.unified-shift-picker');
    selectedShiftEmployeeBar(form);
    updateShiftEditSummary();
    if (editing && form.elements.employee_id?.value) picker?.classList.add('v026-picker-collapsed');
    else picker?.classList.remove('v026-picker-collapsed');

    if (picker && !picker.dataset.v026PickerInstalled) {
      picker.dataset.v026PickerInstalled = 'true';
      picker.querySelector('#shiftEmployeeOptionsList')?.addEventListener('click', () => {
        setTimeout(() => {
          updateShiftEditSummary();
          if (form.dataset.v026Editing === 'true' && form.elements.employee_id?.value) picker.classList.add('v026-picker-collapsed');
        }, 40);
      });
      form.addEventListener('change', () => requestAnimationFrame(updateShiftEditSummary));
    }
  }

  openShiftDialog = function v026OpenShiftDialog(shift = {}) {
    const result = originalOpenShiftDialog(shift);
    requestAnimationFrame(() => enhanceShiftDialog(shift));
    return result;
  };

  function ensurePreApprovedField(options = {}) {
    const form = document.querySelector('#requestForm');
    if (!form) return;
    let field = document.querySelector('#v026PreApprovedField');
    if (!field) {
      field = document.createElement('label');
      field.id = 'v026PreApprovedField';
      field.className = 'v026-preapproved hidden';
      field.innerHTML = '<input type="checkbox" name="pre_approved" value="true"><span><strong>מאושר מראש</strong><small>סימון זה ישמור את הבקשה כמאושרת מיד. ללא סימון היא תישמר כממתינה לאישור, גם כשהוזנה על ידי משבצת/מנהלת.</small></span>';
      form.querySelector('.modal-actions')?.before(field);
    }
    const onBehalf = isManager() && !document.querySelector('#requestRequesterField')?.classList.contains('hidden');
    field.classList.toggle('hidden', !onBehalf);
    const checkbox = field.querySelector('input[name="pre_approved"]');
    if (checkbox) {
      checkbox.checked = Boolean(options.applyNow);
      checkbox.disabled = Boolean(options.applyNow);
    }
  }

  openRequestDialog = function v026OpenRequestDialog(options = {}) {
    const result = originalOpenRequestDialog(options);
    requestAnimationFrame(() => ensurePreApprovedField(options));
    return result;
  };

  function asciiBytes(text) { return new TextEncoder().encode(text); }
  function concatByteChunks(chunks) {
    const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(size); let offset = 0;
    chunks.forEach((chunk) => { out.set(chunk, offset); offset += chunk.length; });
    return out;
  }
  async function jpegBytesFromCanvas(canvas) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.94));
    if (!blob) throw new Error('לא ניתן להכין את קובץ ה-PDF');
    return new Uint8Array(await blob.arrayBuffer());
  }
  async function weeklyPdfBlob(canvas) {
    const image = await jpegBytesFromCanvas(canvas);
    const pageW = 841.89, pageH = 595.28, margin = 16;
    const scale = Math.min((pageW - margin * 2) / canvas.width, (pageH - margin * 2) / canvas.height);
    const drawW = canvas.width * scale, drawH = canvas.height * scale;
    const x = (pageW - drawW) / 2, y = (pageH - drawH) / 2;
    const content = `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`;
    const chunks = []; const offsets = [0]; let length = 0;
    const push = (chunk) => { const bytes = typeof chunk === 'string' ? asciiBytes(chunk) : chunk; chunks.push(bytes); length += bytes.length; };
    push('%PDF-1.4\n%HADAS\n');
    const object = (number, before, stream = null, after = '') => {
      offsets[number] = length;
      push(`${number} 0 obj\n${before}`);
      if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
      push(`${after}endobj\n`);
    };
    object(1, '<< /Type /Catalog /Pages 2 0 R >>\n');
    object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n');
    object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\n`);
    object(4, `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\n`, image);
    const contentBytes = asciiBytes(content);
    object(5, `<< /Length ${contentBytes.length} >>\n`, contentBytes);
    const xref = length;
    push('xref\n0 6\n0000000000 65535 f \n');
    for (let i = 1; i <= 5; i += 1) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
    push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob([concatByteChunks(chunks)], { type: 'application/pdf' });
  }

  async function shareWeeklyPdf() {
    const button = document.querySelector('#printBtn');
    setBusy(button, true, 'מכין PDF…');
    try {
      await document.fonts?.ready;
      const canvas = drawWeeklyScheduleCanvas();
      const blob = await weeklyPdfBlob(canvas);
      const week = dateISO(state.weekStart);
      const filename = `שיבוץ-מעון-הדס-${week}.pdf`;
      const file = new File([blob], filename, { type: 'application/pdf', lastModified: Date.now() });
      const canShare = Boolean(navigator.share) && (!navigator.canShare || navigator.canShare({ files: [file] }));
      if (canShare) {
        try {
          await navigator.share({ files: [file], title: 'שיבוץ שבועי מעון הדס', text: `שיבוץ שבועי החל מ-${formatDate(state.weekStart)}` });
          showToast('קובץ ה-PDF מוכן לשיתוף', 'success');
          return;
        } catch (error) {
          if (error?.name === 'AbortError') return;
        }
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = filename; link.style.display = 'none';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      showToast('קובץ ה-PDF נשמר ומוכן להעברה', 'success');
    } catch (error) {
      showToast(error.message || 'הכנת ה-PDF נכשלה', 'error');
    } finally {
      setBusy(button, false);
    }
  }

  function simplifyWeeklyExportTools() {
    const printButton = document.querySelector('#printBtn');
    if (printButton && !printButton.dataset.v026PdfInstalled) {
      printButton.dataset.v026PdfInstalled = 'true';
      printButton.removeEventListener('click', originalPrintWeeklySchedule);
      printButton.addEventListener('click', shareWeeklyPdf);
      printButton.innerHTML = '📄 PDF שבועי / שיתוף';
      printButton.title = 'יצירת קובץ PDF אמיתי לשמירה או שיתוף';
    }
    const imageButton = document.querySelector('#imageBtn');
    if (imageButton) {
      imageButton.removeEventListener('click', originalDownloadScheduleImage);
      imageButton.classList.add('hidden');
      imageButton.setAttribute('aria-hidden', 'true');
    }
  }

  ensureVersionVisible();
  injectClearWeekButton();
  simplifyWeeklyExportTools();
  requestAnimationFrame(enhanceSchedule);
  setTimeout(ensureVersionVisible, 800);
})();
