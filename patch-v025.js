/* מערכת ניהול שיבוצים מעון הדס — השלמות ממשק לגרסה 0.25.0 */
(() => {
  const VERSION = '0.25.0';
  const originalApiFetch = apiFetch;
  const originalRefreshScheduleWeek = refreshScheduleWeek;
  const originalRenderSchedule = renderSchedule;
  const originalRenderCalendar = renderCalendar;
  const originalOpenCalendarEvent = openCalendarEvent;
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

  apiFetch = async function v025ApiFetch(url, options = {}) {
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

  refreshScheduleWeek = async function v025RefreshScheduleWeek(options = {}) {
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
    ensureVersionVisible();
  }

  renderSchedule = function v025RenderSchedule(...args) {
    const result = originalRenderSchedule(...args);
    requestAnimationFrame(enhanceSchedule);
    return result;
  };

  renderCalendar = function v025RenderCalendar(...args) {
    decorateCalendarEvents(state.calendarEvents);
    return originalRenderCalendar(...args);
  };

  openCalendarEvent = function v025OpenCalendarEvent(event) {
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

  drawWeeklyScheduleCanvas = function v025DrawWeeklyScheduleCanvas(payload = schedulePayloadFromState(), weekStart = state.weekStart, title = 'שיבוץ שבועי') {
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

  ensureVersionVisible();
  injectClearWeekButton();
  requestAnimationFrame(enhanceSchedule);
  setTimeout(ensureVersionVisible, 800);
})();
