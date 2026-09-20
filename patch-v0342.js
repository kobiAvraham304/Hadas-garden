/* מערכת ניהול שיבוצים מעון הדס — תיקוני הדפסה, הרשאות וזמינות 0.34.2 */
(() => {
  if (window.__hadasV0342Installed) return;
  window.__hadasV0342Installed = true;

  const VERSION = '0.36.0';
  const SCALE = 2; // 1754×1240 logical -> 3508×2480 px, close to 300dpi A4 landscape.

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
      state.generalDaysOff = Array.isArray(payload.generalDaysOff) ? payload.generalDaysOff : (state.generalDaysOff || []);
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

  // Approved exceptions are historical decisions: keep them available for the
  // explicit "show approved exceptions" view, but never mix them into live faults.
  function stripApprovedValidationState() {
    if (!state?.v030Validation) return;
    state.v030Validation.errors = (state.v030Validation.errors || []).filter((item) => !item.approved && !item._v030Approved);
    state.v030Validation.warnings = (state.v030Validation.warnings || []).filter((item) => !item.approved && !item._v030Approved && item.code !== 'manual_rule_override');
    state.v030Validation.approved = state.v030Validation.approved || [];
  }

  if (typeof validateScheduleClient === 'function' && !window.__hadasV0342ValidationFilter) {
    const previousValidateScheduleClient = validateScheduleClient;
    validateScheduleClient = function v0342ValidateScheduleClient(...args) {
      stripApprovedValidationState();
      const result = previousValidateScheduleClient.apply(this, args) || { errors: [], warnings: [] };
      const approved = [
        ...(result.approved || []),
        ...(result.warnings || []).filter((item) => item?.approved || item?._v030Approved),
      ];
      const clean = (item) => !item?.approved && !item?._v030Approved && item?.code !== 'manual_rule_override';
      return {
        ...result,
        errors: (result.errors || []).filter(clean),
        warnings: (result.warnings || []).filter(clean),
        approved,
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

  function fitText(ctx, value, x, y, options = {}) {
    const {
      size = 16,
      minSize = Math.max(10, size * .72),
      weight = 700,
      color = '#303448',
      align = 'right',
      maxWidth,
      ellipsis = true,
    } = options;
    let output = String(value ?? '');
    let fittedSize = size;
    if (maxWidth && output) {
      ctx.save();
      ctx.direction = 'rtl';
      ctx.font = `${weight} ${fittedSize}px Arial, "Helvetica Neue", sans-serif`;
      const measured = ctx.measureText(output).width;
      if (measured > maxWidth) fittedSize = Math.max(minSize, fittedSize * (maxWidth / measured));
      ctx.font = `${weight} ${fittedSize}px Arial, "Helvetica Neue", sans-serif`;
      const fittedWidth = ctx.measureText(output).width;
      if (fittedWidth > maxWidth && !ellipsis) {
        fittedSize = Math.max(7.5, fittedSize * (maxWidth / fittedWidth));
      } else if (fittedWidth > maxWidth) {
        const suffix = '…';
        while (output.length > 2 && ctx.measureText(output + suffix).width > maxWidth) output = output.slice(0, -1);
        output += suffix;
      }
      ctx.restore();
    }
    text(ctx, output, x, y, { size:fittedSize, weight, color, align });
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
    const meta = `${time}${role ? ` · ${role}` : ''}`;
    const compact = height < 34;
    roundRect(ctx, x, y, width, height, 9, '#f7f7fc', '#d9dbea', 1);
    if (compact) {
      fitText(ctx, `${name} · ${meta}`, x + width - 8, y + height / 2, { size:15.5, minSize:8.5, weight:850, color:'#454a60', maxWidth:width - 16, ellipsis:false });
      return;
    }
    fitText(ctx, name, x + width - 9, y + height * .30, { size:22.6, minSize:15.2, weight:900, maxWidth:width - 18, ellipsis:false });
    fitText(ctx, meta, x + width - 9, y + height * .74, { size:18.2, minSize:12.4, weight:800, color:'#61677b', maxWidth:width - 18, ellipsis:false });
  }

  function absenceEntriesForDate(iso, sourceRows = state.scheduleAbsences || []) {
    const rows = filterSubstituteAbsences(sourceRows).filter((item) => item.absence_date === iso);
    const byEmployee = new Map();
    const priority = (item) => item.absence_type === 'day_off_worked' ? 4 : item.absence_kind === 'one_time_absence' ? 3 : item.absence_type === 'leave' ? 3 : 1;
    for (const item of rows) {
      const name = employeeById(item.employee_id)?.full_name || item.employee_name || '';
      if (!name) continue;
      const key = item.employee_id || name;
      const existing = byEmployee.get(key);
      if (existing && priority(existing) > priority(item)) continue;
      byEmployee.set(key, { ...item, employee_name:name });
    }
    return [...byEmployee.values()].sort((a,b)=>String(a.employee_name||'').localeCompare(String(b.employee_name||''),'he'));
  }
  function absencePdfLabel(type) {
    if (type === 'day_off_worked') return 'הגיעה ביום חופשי';
    if (type === 'leave') return 'חופשה מאושרת';
    if (type === 'sick') return 'מחלה';
    if (type === 'day_off') return 'יום חופשי מאושר';
    if (type === 'fixed_day_off') return 'יום חופשי קבוע';
    return 'לא זמינה';
  }


  function generalDaysOffRows() {
    const rows = [...(Array.isArray(state.generalDaysOff) ? state.generalDaysOff : [])];
    for (const event of state.calendarEvents || []) {
      if (event?.is_general_day_off && !rows.some((row) => row.id === event.id)) rows.push(event);
    }
    return rows;
  }
  function generalDayOffFor(date) {
    const iso = typeof date === 'string' ? date : dateISO(date);
    return generalDaysOffRows().find((row) => String(row.event_date || row.date || '') === iso) || null;
  }
  function compactReason(value, max = 50) {
    const textValue = String(value || '').replace(/\s+/g, ' ').trim();
    return textValue.length > max ? textValue.slice(0, max - 1) + '…' : textValue;
  }

  function buildA4ScheduleCanvas(options = {}) {
    const logicalWidth = 1754;
    const logicalHeight = 1240;
    const canvas = document.createElement('canvas');
    canvas.width = logicalWidth * SCALE;
    canvas.height = logicalHeight * SCALE;
    const ctx = canvas.getContext('2d', { alpha:false });
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    const weekStart = options.weekStart ? parseDateValue(options.weekStart) : state.weekStart;
    const shiftRows = Array.isArray(options.shifts) ? options.shifts : (state.shifts || []);
    const absenceRows = Array.isArray(options.scheduleAbsences) ? options.scheduleAbsences : (state.scheduleAbsences || []);
    const generalRows = Array.isArray(options.generalDaysOff) ? options.generalDaysOff : generalDaysOffRows();
    const generalOffFor = (iso) => generalRows.find((row) => String(row.event_date || row.date || '') === iso) || null;

    const margin = 24;
    const headerTop = 18;
    const headerHeight = 96;
    const dayHeaderTop = headerTop + headerHeight + 8;
    const dayHeaderHeight = 64;
    const absenceHeight = 192;
    const footerHeight = 16;
    const tableWidth = logicalWidth - margin * 2;
    const classColumnWidth = 180;
    const classColumnX = margin + tableWidth - classColumnWidth;
    const dayAreaX = margin;
    const dayAreaWidth = tableWidth - classColumnWidth;
    const dayWidth = dayAreaWidth / 6;
    const classes = classRows();
    const dates = Array.from({ length:6 }, (_, index) => addDays(weekStart, index));
    const tableBottom = logicalHeight - margin - footerHeight;
    const classesTop = dayHeaderTop + dayHeaderHeight;
    const classesBottom = tableBottom - absenceHeight;
    const classBodyHeight = Math.max(1, classesBottom - classesTop);
    const rowHeight = classBodyHeight / Math.max(1, classes.length);

    roundRect(ctx, margin, headerTop, tableWidth, headerHeight, 18, '#f4f3fb', '#ddddea', 1.2);
    text(ctx, 'שיבוץ שבועי · מעון הדס', logicalWidth - margin - 24, headerTop + 27, { size:31, weight:900, color:'#292d43' });
    fitText(ctx, orderedWeekLabel(weekStart), logicalWidth - margin - 24, headerTop + 67, { size:30, minSize:25, weight:950, color:'#4c5270', maxWidth:660, ellipsis:false });
    text(ctx, 'A4 לרוחב · עמוד אחד', margin + 22, headerTop + 46, { size:15.5, weight:750, color:'#777b8f', align:'left' });

    ctx.fillStyle = '#efeff7';
    ctx.fillRect(classColumnX, dayHeaderTop, classColumnWidth, dayHeaderHeight);
    ctx.strokeStyle = '#d9dbe7';
    ctx.strokeRect(classColumnX, dayHeaderTop, classColumnWidth, dayHeaderHeight);
    text(ctx, 'כיתה', classColumnX + classColumnWidth / 2, dayHeaderTop + dayHeaderHeight / 2, { size:22.5, weight:950, color:'#44485e', align:'center' });

    dates.forEach((date, index) => {
      const x = dayAreaX + (5 - index) * dayWidth;
      ctx.fillStyle = index % 2 ? '#fbfbfe' : '#f7f7fc';
      ctx.fillRect(x, dayHeaderTop, dayWidth, dayHeaderHeight);
      ctx.strokeStyle = '#dfe1ea';
      ctx.strokeRect(x, dayHeaderTop, dayWidth, dayHeaderHeight);
      text(ctx, DAY_NAMES[date.getDay()], x + dayWidth / 2, dayHeaderTop + 21, { size:21.5, weight:950, align:'center' });
      text(ctx, shortDate(date), x + dayWidth / 2, dayHeaderTop + 44, { size:17.8, weight:800, color:'#72768a', align:'center' });
    });

    classes.forEach((classItem, classIndex) => {
      const y = classesTop + classIndex * rowHeight;
      const h = classIndex === classes.length - 1 ? classesBottom - y : rowHeight;
      ctx.fillStyle = classIndex % 2 ? '#ffffff' : '#fdfdff';
      ctx.fillRect(margin, y, tableWidth, h);
      ctx.strokeStyle = '#dfe1ea';
      ctx.strokeRect(margin, y, tableWidth, h);

      ctx.fillStyle = classIndex % 2 ? '#f7f4fc' : '#f3f0fa';
      ctx.fillRect(classColumnX, y, classColumnWidth, h);
      ctx.strokeStyle = '#dad9e7';
      ctx.strokeRect(classColumnX, y, classColumnWidth, h);
      fitText(ctx, classItem.name || 'כיתה', classColumnX + classColumnWidth / 2, y + h / 2 - 12, { size:27, minSize:20, weight:950, color:'#4a4562', align:'center', maxWidth:classColumnWidth - 18 });
      const weeklyCount = shiftRows.filter((row) => row.class_id === classItem.id && dates.some((date) => row.shift_date === dateISO(date))).length;
      fitText(ctx, weeklyCount + ' שיבוצים', classColumnX + classColumnWidth / 2, y + h / 2 + 26, { size:13.8, minSize:11.5, weight:750, color:'#858197', align:'center', maxWidth:classColumnWidth - 18 });

      dates.forEach((date, index) => {
        const iso = dateISO(date);
        const x = dayAreaX + (5 - index) * dayWidth;
        ctx.strokeStyle = '#e3e4ec';
        ctx.strokeRect(x, y, dayWidth, h);
        if (generalOffFor(iso)) return;
        const rows = typeof sortScheduleRows === 'function'
          ? sortScheduleRows(shiftRows.filter((row) => row.class_id === classItem.id && row.shift_date === iso))
          : shiftRows.filter((row) => row.class_id === classItem.id && row.shift_date === iso);
        if (!rows.length) {
          text(ctx, '—', x + dayWidth / 2, y + h / 2, { size:18, weight:650, color:'#b1b3bf', align:'center' });
          return;
        }
        const gap = 5;
        const innerY = y + 10;
        const innerHeight = h - 20;
        const maxCard = rows.length <= 4 ? 58 : 50;
        const cardHeight = Math.max(31, Math.min(maxCard, (innerHeight - gap * (rows.length - 1)) / rows.length));
        const stackHeight = cardHeight * rows.length + gap * (rows.length - 1);
        let currentY = innerY + Math.max(0, (innerHeight - stackHeight) / 2);
        rows.forEach((shift) => {
          drawShiftCard(ctx, shift, x + 7, currentY, dayWidth - 14, cardHeight);
          currentY += cardHeight + gap;
        });
      });
    });

    dates.forEach((date, index) => {
      const off = generalOffFor(dateISO(date));
      if (!off) return;
      const x = dayAreaX + (5 - index) * dayWidth;
      const bodyH = classesBottom - classesTop;
      ctx.fillStyle = '#fff8e7';
      ctx.fillRect(x + 1, classesTop + 1, dayWidth - 2, bodyH - 2);
      ctx.strokeStyle = '#e8d7aa';
      ctx.strokeRect(x, classesTop, dayWidth, bodyH);
      classes.forEach((classItem, classIndex) => {
        const lineY = classesTop + classIndex * rowHeight;
        ctx.beginPath();
        ctx.moveTo(x, lineY);
        ctx.lineTo(x + dayWidth, lineY);
        ctx.strokeStyle = 'rgba(222,205,160,.55)';
        ctx.stroke();
      });
      const cardH = Math.min(142, Math.max(112, bodyH * .42));
      const cardY = classesTop + (bodyH - cardH) / 2;
      roundRect(ctx, x + 12, cardY, dayWidth - 24, cardH, 17, '#fff3d4', '#e4c97f', 1.3);
      fitText(ctx, 'חופש כללי', x + dayWidth / 2, cardY + 31, { size:24, minSize:19, weight:950, color:'#76551b', align:'center', maxWidth:dayWidth - 38, ellipsis:false });
      fitText(ctx, off.title || 'יום חופשי', x + dayWidth / 2, cardY + 66, { size:20, minSize:15.5, weight:900, color:'#866326', align:'center', maxWidth:dayWidth - 38, ellipsis:false });
      if (off.description) fitText(ctx, compactReason(off.description, 52), x + dayWidth / 2, cardY + 101, { size:14.5, minSize:10.8, weight:700, color:'#9a7942', align:'center', maxWidth:dayWidth - 42, ellipsis:false });
    });

    const absenceTop = classesBottom;
    ctx.fillStyle = '#fbf7ed';
    ctx.fillRect(margin, absenceTop, tableWidth, absenceHeight);
    ctx.strokeStyle = '#e6ddc9';
    ctx.strokeRect(margin, absenceTop, tableWidth, absenceHeight);

    ctx.fillStyle = '#f5eedf';
    ctx.fillRect(classColumnX, absenceTop, classColumnWidth, absenceHeight);
    ctx.strokeStyle = '#e0d4bc';
    ctx.strokeRect(classColumnX, absenceTop, classColumnWidth, absenceHeight);
    fitText(ctx, 'חופש / היעדרות', classColumnX + classColumnWidth / 2, absenceTop + absenceHeight / 2 - 14, { size:24.5, minSize:20, weight:950, color:'#735f3e', align:'center', maxWidth:classColumnWidth - 14, ellipsis:false });
    text(ctx, 'לפי יום', classColumnX + classColumnWidth / 2, absenceTop + absenceHeight / 2 + 22, { size:15.5, weight:750, color:'#9a886b', align:'center' });

    dates.forEach((date, index) => {
      const x = dayAreaX + (5 - index) * dayWidth;
      ctx.strokeStyle = '#e6ddc9';
      ctx.strokeRect(x, absenceTop, dayWidth, absenceHeight);
      const items = absenceEntriesForDate(dateISO(date), absenceRows);
      if (!items.length) {
        text(ctx, '—', x + dayWidth / 2, absenceTop + absenceHeight / 2, { size:17, weight:650, color:'#b0aa9c', align:'center' });
        return;
      }

      const columns = items.length > 4 ? 2 : 1;
      const rowsPerColumn = Math.ceil(items.length / columns);
      const gapX = 5;
      const gapY = 5;
      const innerX = x + 7;
      const innerY = absenceTop + 8;
      const innerWidth = dayWidth - 14;
      const innerHeight = absenceHeight - 16;
      const cardWidth = (innerWidth - gapX * (columns - 1)) / columns;
      const cardHeight = Math.max(30, Math.min(44, (innerHeight - gapY * (rowsPerColumn - 1)) / rowsPerColumn));

      items.forEach((item, itemIndex) => {
        const column = Math.floor(itemIndex / rowsPerColumn);
        const row = itemIndex % rowsPerColumn;
        const cardX = innerX + (columns - 1 - column) * (cardWidth + gapX);
        const cardY = innerY + row * (cardHeight + gapY);
        const worked = item.absence_type === 'day_off_worked';
        const approvedLeave = item.absence_type === 'leave';
        const fill = worked ? '#edf9f1' : approvedLeave ? '#fff0f0' : '#f8f8fb';
        const border = worked ? '#add7bb' : approvedLeave ? '#efb1b1' : '#d9dbe5';
        const color = worked ? '#2f754a' : approvedLeave ? '#923b3b' : '#555b6e';
        roundRect(ctx, cardX, cardY, cardWidth, cardHeight, 8, fill, border, 1);
        const name = item.employee_name || employeeById(item.employee_id)?.full_name || 'עובד';
        const label = absencePdfLabel(item.absence_type);
        if (cardHeight >= 36) {
          fitText(ctx, name, cardX + cardWidth - 7, cardY + cardHeight * .33, { size:17.4, minSize:12.8, weight:900, color, maxWidth:cardWidth - 14, ellipsis:false });
          fitText(ctx, label, cardX + cardWidth - 7, cardY + cardHeight * .74, { size:12.3, minSize:9.4, weight:750, color, maxWidth:cardWidth - 14, ellipsis:false });
        } else {
          fitText(ctx, name, cardX + cardWidth - 7, cardY + cardHeight / 2, { size:15.2, minSize:11, weight:850, color, maxWidth:cardWidth - 14, ellipsis:false });
        }
      });
    });

    text(ctx, 'מעון הדס · ' + orderedWeekLabel(weekStart), logicalWidth - margin, logicalHeight - 15, { size:11.8, weight:700, color:'#8b8e9e' });
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

  async function pdfFromCanvases(canvases) {
    const pages = (canvases || []).filter(Boolean);
    if (!pages.length) throw new Error('לא נמצאו עמודים להכנת PDF');
    const pageW = 841.89;
    const pageH = 595.28;
    const margin = 5;
    const rendered = [];
    for (const canvas of pages) {
      const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.995));
      if (!jpegBlob) throw new Error('לא ניתן להכין את קובץ ההדפסה');
      const image = new Uint8Array(await jpegBlob.arrayBuffer());
      const fit = Math.min((pageW - margin * 2) / canvas.width, (pageH - margin * 2) / canvas.height);
      const drawW = canvas.width * fit;
      const drawH = canvas.height * fit;
      const x = (pageW - drawW) / 2;
      const y = (pageH - drawH) / 2;
      const content = ascii(`q\n${drawW.toFixed(3)} 0 0 ${drawH.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm\n/Im0 Do\nQ\n`);
      rendered.push({ canvas, image, content });
    }

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

    const pageIds = rendered.map((_, index) => 3 + index * 3);
    object(1, [ascii('<< /Type /Catalog /Pages 2 0 R >>')]);
    object(2, [ascii(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${rendered.length} >>`)]);
    rendered.forEach((page, index) => {
      const pageId = 3 + index * 3;
      const imageId = pageId + 1;
      const contentId = pageId + 2;
      object(pageId, [ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`)]);
      object(imageId, [ascii(`<< /Type /XObject /Subtype /Image /Width ${page.canvas.width} /Height ${page.canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.image.length} >>\nstream\n`), page.image, ascii('\nendstream')]);
      object(contentId, [ascii(`<< /Length ${page.content.length} >>\nstream\n`), page.content, ascii('endstream')]);
    });

    const maxId = 2 + rendered.length * 3;
    const xrefOffset = length;
    push(ascii(`xref\n0 ${maxId + 1}\n0000000000 65535 f \n`));
    for (let id = 1; id <= maxId; id += 1) push(ascii(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`));
    push(ascii(`trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
    return new Blob([concatBytes(parts)], { type:'application/pdf' });
  }

  async function pdfFromCanvas(canvas) {
    return pdfFromCanvases([canvas]);
  }

  function monthKeyFromWeek() {
    const d = parseDateValue(state.weekStart);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function monthDates(monthKey) {
    const [year, month] = String(monthKey).split('-').map(Number);
    const last = new Date(year, month, 0, 12);
    const rows = [];
    for (let day = 1; day <= last.getDate(); day += 1) {
      const date = new Date(year, month - 1, day, 12);
      if (date.getDay() !== 6) rows.push(date);
    }
    return rows;
  }
  function monthWeekStarts(monthKey) {
    const [year, month] = String(monthKey).split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1, 12);
    const lastDay = new Date(year, month, 0, 12);
    const firstSunday = startOfWeek(firstDay);
    const lastSunday = startOfWeek(lastDay);
    const weeks = [];
    for (let cursor = new Date(firstSunday); cursor <= lastSunday; cursor = addDays(cursor, 7)) weeks.push(new Date(cursor));
    return weeks;
  }

  async function monthSchedulePages(monthKey) {
    const weeks = monthWeekStarts(monthKey);
    const payloads = await Promise.all(weeks.map((week) => fetchScheduleWeek(week, { force:false, apply:false })));
    if (payloads.some(payload => !payload)) throw new Error('השיבוץ השתנה בזמן הכנת הדוח. יש לפתוח את הדוח מחדש.');
    return weeks.map((weekStart, index) => ({
      weekStart,
      payload:payloads[index] || {},
      canvas:buildA4ScheduleCanvas({
        weekStart,
        shifts:payloads[index]?.shifts || [],
        scheduleAbsences:payloads[index]?.scheduleAbsences || [],
        generalDaysOff:payloads[index]?.generalDaysOff || [],
      }),
    }));
  }

  function printCanvasesDirect(canvases) {
    const pages = (canvases || []).filter(Boolean);
    if (!pages.length) return;
    document.querySelector('#v036PrintRoot')?.remove();
    const root = document.createElement('div');
    root.id = 'v036PrintRoot';
    pages.forEach((canvas, index) => {
      const page = document.createElement('section');
      page.className = 'v036-print-page';
      const image = document.createElement('img');
      image.alt = `שיבוץ מעון הדס להדפסה · עמוד ${index + 1}`;
      image.src = canvas.toDataURL('image/jpeg', .99);
      page.append(image);
      root.append(page);
    });
    document.body.append(root);
    document.body.classList.add('v036-printing');
    const cleanup = () => {
      document.body.classList.remove('v036-printing');
      root.remove();
    };
    window.addEventListener('afterprint', cleanup, { once:true });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        window.focus();
        window.print();
      } catch (error) {
        cleanup();
        throw error;
      }
    }));
    setTimeout(() => {
      if (document.body.classList.contains('v036-printing')) cleanup();
    }, 60000);
  }

  function printCanvasDirect(canvas) {
    printCanvasesDirect([canvas]);
  }

  function ensureUnifiedPdfDialog() {
    let dialog=document.querySelector('#hadasUnifiedPdfDialog');
    if(dialog)return dialog;
    dialog=document.createElement('dialog'); dialog.id='hadasUnifiedPdfDialog'; dialog.className='v036-pdf-dialog';
    dialog.innerHTML=`<form method="dialog" class="v036-pdf-shell"><header><div><strong>שיבוץ PDF</strong><small>שבוע: עמוד A4 אחד · חודש: קובץ אחד עם עמוד נפרד לכל שבוע</small></div><button value="cancel" class="icon-round-btn" aria-label="סגירה">×</button></header><div class="v036-pdf-options"><div class="v036-pdf-tabs"><button type="button" data-pdf-mode="week" class="active">שבוע</button><button type="button" data-pdf-mode="month">חודש</button></div><label class="v036-month-field hidden">חודש <input type="month" value="${monthKeyFromWeek()}"></label></div><div class="v036-pdf-status">מכין תצוגה…</div><div class="v036-pdf-preview"></div><footer><button type="button" class="secondary-btn" data-pdf-action="save">⬇ שמירה</button><button type="button" class="secondary-btn" data-pdf-action="share">↗ שיתוף / WhatsApp</button><button type="button" class="primary-btn" data-pdf-action="print">🖨 הדפסה A4</button></footer></form>`;
    document.body.append(dialog);
    const context={mode:'week',canvases:[],blob:null,month:monthKeyFromWeek(),busy:false};

    async function refreshPreview(){
      if(context.busy)return;
      context.busy=true;
      context.canvases=[];
      context.blob=null;
      const status=dialog.querySelector('.v036-pdf-status');
      const preview=dialog.querySelector('.v036-pdf-preview');
      status.textContent='מכין תצוגה…';
      preview.innerHTML='';
      try{
        await document.fonts?.ready;
        if(context.mode==='week') {
          context.canvases=[buildA4ScheduleCanvas()];
        } else {
          const pages=await monthSchedulePages(context.month);
          context.canvases=pages.map((page)=>page.canvas);
        }
        context.blob=await pdfFromCanvases(context.canvases);
        context.canvases.forEach((canvas,index)=>{
          canvas.classList.add('v036-pdf-canvas');
          if(context.mode==='week') { preview.append(canvas); return; }
          const shell=document.createElement('section');
          shell.className='v036-pdf-page-preview';
          const label=document.createElement('strong');
          label.textContent=`שבוע ${index + 1} מתוך ${context.canvases.length}`;
          shell.append(label,canvas);
          preview.append(shell);
        });
        status.textContent=context.mode==='week'
          ? 'שבוע · A4 לרוחב · עמוד אחד'
          : `חודש · ${context.canvases.length} עמודי A4 · עמוד נפרד לכל שבוע`;
      }catch(error){
        status.textContent=error?.message||'הכנת התצוגה נכשלה';
        if(typeof showToast==='function')showToast(status.textContent,'error');
      }finally{context.busy=false;}
    }

    function filename(){
      return context.mode==='week'
        ? `שיבוץ-מעון-הדס-${dateISO(state.weekStart)}.pdf`
        : `שיבוץ-מעון-הדס-${context.month}-שבועות.pdf`;
    }
    function saveBlob(){
      if(!context.blob)return;
      const url=URL.createObjectURL(context.blob),a=document.createElement('a');
      a.href=url;a.download=filename();document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
    }

    dialog.addEventListener('click',async(event)=>{
      const mode=event.target.closest('[data-pdf-mode]');
      if(mode){
        context.mode=mode.dataset.pdfMode;
        dialog.querySelectorAll('[data-pdf-mode]').forEach((b)=>b.classList.toggle('active',b===mode));
        dialog.querySelector('.v036-month-field').classList.toggle('hidden',context.mode!=='month');
        await refreshPreview();
        return;
      }
      const action=event.target.closest('[data-pdf-action]')?.dataset.pdfAction;
      if(!action)return;
      if(!context.canvases.length||!context.blob){
        await refreshPreview();
        if(!context.canvases.length||!context.blob)return;
      }
      if(action==='save'){saveBlob();showToast?.('קובץ ה-PDF נשמר','success');return;}
      if(action==='share'){
        const file=new File([context.blob],filename(),{type:'application/pdf'});
        if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){
          try{await navigator.share({files:[file],title:'שיבוץ מעון הדס'});}catch(error){if(error?.name!=='AbortError')throw error;}
        } else {
          saveBlob();
          showToast?.('השיתוף הישיר לא זמין במכשיר הזה — הקובץ נשמר וניתן לשלוח אותו ב-WhatsApp','success');
        }
        return;
      }
      if(action==='print'){
        try { dialog.close(); } catch {}
        printCanvasesDirect(context.canvases);
        return;
      }
    });

    dialog.querySelector('input[type="month"]').addEventListener('change',async(event)=>{
      context.month=event.target.value||monthKeyFromWeek();
      await refreshPreview();
    });
    dialog.__hadasRefresh=refreshPreview;
    dialog.__hadasContext=context;
    return dialog;
  }

  function openUnifiedPdf(event){
    event?.preventDefault?.();event?.stopImmediatePropagation?.();
    stripSubstituteAvailability();
    const dialog=ensureUnifiedPdfDialog();dialog.__hadasContext.mode='week';dialog.__hadasContext.month=monthKeyFromWeek();
    dialog.querySelector('input[type="month"]').value=dialog.__hadasContext.month;
    dialog.querySelectorAll('[data-pdf-mode]').forEach((b)=>b.classList.toggle('active',b.dataset.pdfMode==='week'));
    dialog.querySelector('.v036-month-field').classList.add('hidden');
    if(!dialog.open)dialog.showModal();dialog.__hadasRefresh();
  }
  function dayCopyText(iso){
    const date=parseDateValue(iso),off=generalDayOffFor(iso);
    const lines=[`שיבוץ מעון הדס — יום ${DAY_NAMES[date.getDay()]} ${formatDate(date,{day:'2-digit',month:'2-digit',year:'numeric'})}`];
    if(off){lines.push('',`חופש כללי: ${off.title||'חופש כללי'}`);if(off.description)lines.push(`סיבה: ${off.description}`);}
    for(const classItem of classRows()){
      const rows=typeof sortScheduleRows==='function'?sortScheduleRows((state.shifts||[]).filter((row)=>row.shift_date===iso&&row.class_id===classItem.id)):(state.shifts||[]).filter((row)=>row.shift_date===iso&&row.class_id===classItem.id);
      lines.push('',`${classItem.name}:`);
      if(off&&!rows.length){lines.push('• חופש כללי');continue;}
      if(!rows.length){lines.push('• אין שיבוצים');continue;}
      rows.forEach((shift)=>lines.push(`• ${employeeById(shift.employee_id)?.full_name||'עובד'} — ${trimTime(shift.start_time)}–${trimTime(shift.end_time)}`));
    }
    const abs=(state.scheduleAbsences||[]).filter((row)=>row.absence_date===iso);
    if(abs.length){lines.push('','חופש / היעדרות:');abs.forEach((row)=>lines.push(`• ${employeeById(row.employee_id)?.full_name||row.employee_name||'עובד'} — ${row.label||row.absence_type||'חופש'}`));}
    return lines.join('\n');
  }
  async function copyDay(iso){
    const value=dayCopyText(iso);
    try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);else{const area=document.createElement('textarea');area.value=value;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();document.execCommand('copy');area.remove();}showToast?.('השיבוץ של היום הועתק','success');}
    catch{showToast?.('לא ניתן להעתיק את השיבוץ','error');}
  }
  if (typeof renderMobileWeekDay === 'function' && !window.__hadasV036MobileDayRenderer) {
    renderMobileWeekDay = function v036RenderMobileWeekDay(date, index) {
      const iso = dateISO(date);
      const dayRows = state.shifts.filter((shift) => shift.shift_date === iso);
      const off = generalDayOffFor(iso);
      const classResults = off ? [] : visibleScheduleClasses().map((item) => coverageFor(dayRows.filter((shift) => shift.class_id === item.id), iso));
      const issues = off ? 0 : classResults.filter((result) => !result.ok).length;
      const open = state.expandedWeekDay === index;
      const status = off
        ? '<span class="mobile-week-day-status v036-mobile-holiday-status">חופש כללי · ' + escapeHtml(off.title || 'יום חופשי') + '</span>'
        : '<span class="mobile-week-day-status ' + (issues ? 'issue' : 'ok') + '">' + (issues ? issues + ' כיתות לבדיקה' : 'כל הכיתות תקינות') + '</span>';
      const body = off
        ? '<div class="v036-mobile-holiday-body"><strong>חופש כללי</strong><span>' + escapeHtml(off.title || 'יום חופשי') + '</span>' + (off.description ? '<small>' + escapeHtml(off.description) + '</small>' : '') + '</div>'
        : visibleScheduleClasses().map((item) => renderMobileWeekClass(item, date)).join('');
      return '<article class="mobile-week-day ' + (issues ? 'has-issue ' : '') + (open ? 'is-open' : '') + '" data-day-index="' + index + '">' +
        '<button type="button" class="v036-mobile-day-toggle" aria-expanded="' + (open ? 'true' : 'false') + '">' +
          '<span class="mobile-week-day-name"><strong>' + DAY_NAMES[date.getDay()] + '</strong><small>' + formatDate(date, { day:'2-digit', month:'2-digit' }) + '</small></span>' +
          '<span class="mobile-week-day-stats"><b>' + new Set(dayRows.map((shift) => shift.employee_id)).size + '</b><small>עובדים</small></span>' +
          status +
          '<span class="mobile-week-chevron">⌄</span>' +
        '</button>' +
        '<div class="mobile-week-day-body"' + (open ? '' : ' hidden') + '>' + body + '</div>' +
      '</article>';
    };
    window.__hadasV036MobileDayRenderer = true;
  }

  function installMobileScheduleToggle() {
    const root = document.querySelector('#scheduleExport');
    if (!root || root.dataset.v036MobileToggle === 'true') return;
    root.dataset.v036MobileToggle = 'true';
    root.addEventListener('click', (event) => {
      const toggle = event.target.closest('.v036-mobile-day-toggle');
      if (!toggle) return;
      event.preventDefault();
      event.stopPropagation();
      const card = toggle.closest('.mobile-week-day');
      if (!card) return;
      const nextOpen = !card.classList.contains('is-open');
      root.querySelectorAll('.mobile-week-day').forEach((item) => {
        item.classList.remove('is-open');
        item.querySelector('.v036-mobile-day-toggle')?.setAttribute('aria-expanded', 'false');
        const body = item.querySelector('.mobile-week-day-body');
        if (body) body.hidden = true;
      });
      if (nextOpen) {
        card.classList.add('is-open');
        toggle.setAttribute('aria-expanded', 'true');
        const body = card.querySelector('.mobile-week-day-body');
        if (body) body.hidden = false;
        state.expandedWeekDay = Number(card.dataset.dayIndex);
      } else state.expandedWeekDay = null;
    }, true);
  }

  function installScheduleToolsControl() {
    const tools = document.querySelector('.schedule-tools-menu');
    if (!tools) return;
    const summary = tools.querySelector(':scope > summary');
    if (summary && summary.dataset.v036ToolsToggle !== 'true') {
      summary.dataset.v036ToolsToggle = 'true';
      summary.addEventListener('click', (event) => {
        if (!window.matchMedia('(max-width:820px)').matches) return;
        event.preventDefault();
        tools.open = !tools.open;
      }, true);
    }
    const mode = window.matchMedia('(max-width:820px)').matches ? 'mobile' : 'desktop';
    if (tools.dataset.v036ViewportMode !== mode) {
      tools.dataset.v036ViewportMode = mode;
      tools.open = mode === 'desktop';
    }
    if (!window.__hadasV036ToolsResize) {
      window.__hadasV036ToolsResize = true;
      window.addEventListener('resize', () => {
        const menu = document.querySelector('.schedule-tools-menu');
        if (!menu) return;
        const nextMode = window.matchMedia('(max-width:820px)').matches ? 'mobile' : 'desktop';
        if (menu.dataset.v036ViewportMode === nextMode) return;
        menu.dataset.v036ViewportMode = nextMode;
        menu.open = nextMode === 'desktop';
      }, { passive:true });
    }
  }

  function enhanceScheduleDays(){
    const dates=Array.from({length:6},(_,i)=>addDays(state.weekStart,i));
    const headers=[...document.querySelectorAll('#scheduleExport .schedule-desktop-week thead th:not(.class-name)')];
    headers.forEach((header,index)=>{
      const date=dates[index]; if(!date)return;
      header.dataset.copyScheduleDay=dateISO(date);
      header.classList.add('v036-copy-day-header');
      header.title='לחיצה להעתקת השיבוץ של היום';
      header.setAttribute('aria-label',`${header.textContent?.trim()||'יום'} — לחיצה להעתקת השיבוץ`);
      header.querySelector('.v036-copy-hint')?.remove();
      header.querySelector('.v036-general-day')?.remove();
    });
    const tableRows=[...document.querySelectorAll('#scheduleExport .schedule-desktop-week tbody tr')];
    tableRows.forEach((row)=>dates.forEach((date,index)=>{
      const cell=row.children[index+1]; if(!cell)return;
      const zone=cell.querySelector('.schedule-cell');
      const off=generalDayOffFor(dateISO(date));
      cell.classList.toggle('v036-general-off-cell',Boolean(off));
      zone?.querySelectorAll('.v027-cell-flag.closure,.v036-off-label').forEach((item)=>item.remove());
      if(off&&zone&&!zone.querySelector('.shift-card')){
        const note=String(off.description||'').trim();
        zone.insertAdjacentHTML('afterbegin',`<div class="v036-off-label"><strong>חופש כללי</strong><span>${escapeHtml(off.title||'')}</span>${note?`<small>${escapeHtml(note)}</small>`:''}</div>`);
      }
    }));
    document.querySelectorAll('#scheduleExport .mobile-week-day').forEach((day,index)=>{
      const date=dates[index],off=date&&generalDayOffFor(dateISO(date));
      day.querySelector('.v036-mobile-copy')?.remove();
      day.querySelector('.v036-mobile-general')?.remove();
      const body=day.querySelector('.mobile-week-day-body');
      if(body&&date) body.insertAdjacentHTML('afterbegin',`<button type="button" class="secondary-btn v036-mobile-copy" data-copy-schedule-day="${dateISO(date)}">⧉ העתקת יום</button>`);
      if(off){
        day.querySelectorAll('.v027-cell-flag.closure').forEach((item)=>item.remove());
        const summary=day.querySelector('.v036-mobile-day-toggle');
        if(summary && !summary.querySelector('.v036-mobile-holiday-status')) summary.insertAdjacentHTML('beforeend',`<span class="v036-mobile-general">חופש כללי · ${escapeHtml(off.title||'')}</span>`);
      }
    });
  }
  function installScheduleCopyEvents(){
    const panel=document.querySelector('#schedulePanel');if(!panel||panel.dataset.v036CopyEvents)return;panel.dataset.v036CopyEvents='true';
    panel.addEventListener('click',(event)=>{const target=event.target.closest('[data-copy-schedule-day]');if(!target)return;event.preventDefault();event.stopPropagation();copyDay(target.dataset.copyScheduleDay);},true);
  }

  function canShowUnifiedPdf() {
    if (!state?.profile) return false;
    if (typeof isManager === 'function' && isManager()) return true;
    const title=String(state.profile.job_title||'');
    return Boolean(state.profile.can_view_full_schedule || ['full','class'].includes(String(state.profile.schedule_scope||'')) || /גנ(?:נ|ן)|סייעת\s+מובילה/.test(title));
  }
  function installA4Button() {
    const container=document.querySelector('.schedule-secondary-actions');
    if(!container)return;
    let button=document.querySelector('#v036PdfBtn');
    if(!button){
      button=document.createElement('button');
      button.id='v036PdfBtn';
      button.type='button';
      button.className='ghost-btn v036-pdf-launch';
      button.innerHTML='<span aria-hidden="true">▣</span> שיבוץ PDF';
      button.title='שבוע או חודש · שמירה, שיתוף והדפסה A4';
      button.addEventListener('click',openUnifiedPdf,true);
      const clear=document.querySelector('#clearWeekBtn');
      if(clear&&clear.parentElement===container) container.insertBefore(button,clear);
      else container.append(button);
    }
    const visible=canShowUnifiedPdf();
    button.classList.toggle('hidden',!visible);
    button.setAttribute('aria-hidden',visible?'false':'true');
    ['#printBtn','#imageBtn','#monthImageBtn','#v031PrintBtn'].forEach((selector)=>{
      const item=document.querySelector(selector);
      if(item){item.classList.add('hidden');item.setAttribute('aria-hidden','true');}
    });
  }

  function apply() {
    stripApprovedValidationState();
    stripSubstituteAvailability();
    installA4Button();
    installScheduleCopyEvents();
    installMobileScheduleToggle();
    installScheduleToolsControl();
    enhanceScheduleDays();
    document.documentElement.dataset.hadasA4 = 'v0360';
  }

  if (typeof renderSchedule === 'function' && !window.__hadasV0342RenderHook) {
    const previousRenderSchedule = renderSchedule;
    renderSchedule = function v0342RenderSchedule(...args) {
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


  const v036Style=document.createElement('style');
  v036Style.textContent=`
    #scheduleAbsences{overflow-x:auto!important;-webkit-overflow-scrolling:touch}
    #scheduleAbsences .absence-grid{grid-template-columns:repeat(6,minmax(148px,1fr))!important;min-width:900px!important;gap:8px!important}
    #scheduleExport .schedule-desktop-week thead th{padding:5px 7px!important;line-height:1.08!important;height:auto!important;min-height:0!important}
    .v036-copy-day-header{cursor:pointer!important;position:relative!important;transition:.15s ease;padding-inline-start:25px!important}.v036-copy-day-header:hover{background:#e9ebff!important}.v036-copy-day-header::after{content:'⧉';position:absolute;inset-inline-start:6px;top:6px;width:16px;height:16px;display:grid;place-items:center;border-radius:5px;background:#eef0ff;color:#676dcc;font-size:.64rem;font-weight:900}
    .v036-copy-hint,.v036-general-day{display:none!important}
    .v036-general-off-cell{background:#fffaf0!important}.v036-off-label{display:grid;place-items:center;gap:2px;min-height:66px;padding:8px;border:1px solid #e5cf98;border-radius:11px;background:#fff8e9;color:#72531c;text-align:center}.v036-off-label strong{font-size:.9rem;font-weight:950}.v036-off-label span{font-size:.72rem;font-weight:850}.v036-off-label small{font-size:.58rem;line-height:1.2;color:#94733b;font-weight:650}.v027-cell-flag.closure{display:none!important}.v036-pdf-launch{display:inline-flex!important;align-items:center;gap:6px}
    .v036-mobile-copy{width:auto!important;justify-self:end;margin:0 0 6px!important;padding:6px 10px!important;min-height:34px!important;font-size:.7rem!important}.v036-mobile-general{margin-inline-start:auto;padding:4px 7px;border-radius:999px;background:#fff1cf;color:#785719;font-size:.62rem;font-weight:900}
    .v036-pdf-dialog{width:min(1160px,96vw);max-width:1160px;border:0;border-radius:24px;padding:0;box-shadow:0 25px 80px rgba(38,40,78,.28)}.v036-pdf-dialog::backdrop{background:rgba(29,31,54,.55);backdrop-filter:blur(4px)}
    .v036-pdf-shell{display:grid;grid-template-rows:auto auto auto minmax(260px,1fr) auto;max-height:94vh;background:#f7f7fb}.v036-pdf-shell>header{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;background:#fff;border-bottom:1px solid #e4e5ed}.v036-pdf-shell>header div{display:grid;gap:2px}.v036-pdf-shell>header strong{font-size:1.25rem}.v036-pdf-shell>header small{color:#777b8d}
    .v036-pdf-options{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px}.v036-pdf-tabs{display:flex;gap:6px;padding:4px;border-radius:13px;background:#e9eaf2}.v036-pdf-tabs button{border:0;border-radius:10px;padding:9px 22px;background:transparent;font-weight:900}.v036-pdf-tabs button.active{background:#fff;color:#565bd0;box-shadow:0 2px 9px rgba(65,67,115,.12)}.v036-month-field{display:flex;align-items:center;gap:8px;font-weight:800}.v036-month-field input{width:auto}
    .v036-pdf-status{padding:0 16px 8px;color:#6b6f83;font-size:.82rem;font-weight:800}.v036-pdf-preview{overflow:auto;margin:0 14px 12px;padding:10px;border:1px solid #dfe1e9;border-radius:16px;background:#d9dbe2;display:grid;place-items:center;gap:16px;overscroll-behavior:contain}.v036-pdf-page-preview{width:100%;display:grid;justify-items:center;gap:7px}.v036-pdf-page-preview>strong{justify-self:start;margin-inline:8px;padding:5px 9px;border-radius:999px;background:#fff;color:#64687b;font-size:.72rem;box-shadow:0 2px 8px rgba(31,33,58,.08)}.v036-pdf-canvas{display:block!important;width:min(100%,1040px)!important;height:auto!important;box-shadow:0 8px 25px rgba(31,33,58,.18);background:#fff}
    .v036-pdf-shell>footer{display:grid;grid-template-columns:1fr 1fr 1.2fr;gap:9px;padding:13px 16px;background:#fff;border-top:1px solid #e4e5ed}.v036-pdf-shell>footer button{min-height:44px!important;font-size:.86rem!important}
    html[data-hadas-role="manager"] #v036PdfBtn,html[data-hadas-role="teacher"] #v036PdfBtn,html[data-hadas-role="full"] #v036PdfBtn,html[data-hadas-role="lead"] #v036PdfBtn{display:inline-flex!important;visibility:visible!important}
    #publishScheduleBtn.publication-toggle.is-unpublished{background:#d9545d!important;border-color:#c84650!important;color:#fff!important;box-shadow:0 5px 14px rgba(201,70,80,.18)!important}
    #publishScheduleBtn.publication-toggle.is-unpublished .publication-toggle-dot{background:#fff!important;box-shadow:0 0 0 3px rgba(255,255,255,.22)!important}
    #publishScheduleBtn.publication-toggle.is-published{background:#f6f7fa!important;border-color:#dfe1e9!important;color:#4c5267!important;box-shadow:none!important}
    #toast{z-index:2147483647!important;position:fixed!important}
    #toast:popover-open{display:block!important;position:fixed!important;inset:auto 18px 18px auto!important;margin:0!important;border:0!important;z-index:2147483647!important}
    .v031-validation-card.approved{border:2px solid #e68b91!important;background:#fff8f8!important}
    .v032-validation-card.approved{border:2px solid #e68b91!important;background:#fff8f8!important}
    .v032-validation-card.approved .v032-validation-icon{background:#fde7e8!important;color:#a73942!important}
    .v032-validation-card.approved .v032-validation-copy>span{color:#a73942!important}
    .v032-focus-ring,.v032-focus-column{outline-color:#d84f59!important;box-shadow:0 0 0 7px rgba(216,79,89,.14)!important}
    .v031-validation-card.approved .v031-validation-icon{background:#fde7e8!important;color:#a73942!important}
    .v031-validation-card.approved .v031-validation-copy>span{color:#a73942!important}
    .v036-approved-toggle{display:inline-flex;align-items:center;gap:7px;min-height:38px;padding:8px 12px;border:1px solid #e5a1a5;border-radius:12px;background:#fff7f7;color:#9d3d45;font:inherit;font-weight:850;cursor:pointer}
    .v036-approved-toggle.active{background:#a9444d;color:#fff;border-color:#a9444d}
    .v036-validation-head-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px}
    .v036-validation-head-actions>b{white-space:nowrap;font-size:12px;color:#a33f45;background:#fff0f0;padding:7px 10px;border-radius:999px}
    .v036-approved-list{display:grid;gap:10px}
    .day-class-card.attention-pulse{outline:3px solid #d84f59!important;outline-offset:3px!important;box-shadow:0 0 0 7px rgba(216,79,89,.12)!important}
    .v026-selected-employee-copy{min-width:0;display:grid!important;gap:5px!important;line-height:1.35}
    .v026-selected-employee-label{display:block!important;margin:0 0 1px!important;line-height:1.3!important;letter-spacing:0!important}
    .v026-selected-employee-copy strong{display:block!important;margin:0!important;line-height:1.35!important}
    .v026-selected-employee-copy span{display:block!important;margin-top:1px!important;line-height:1.45!important}
    .employee-picker-current{display:grid!important;gap:8px!important;padding:12px 13px!important;border:1px solid #dfe1ec!important;border-radius:14px!important;background:#fafaff!important}
    .employee-picker-current>div:first-child{display:grid;gap:3px}
    .employee-picker-current>div:first-child small{font-size:.72rem;color:#73778a;font-weight:800}
    .employee-picker-current>div:first-child strong{font-size:1rem;color:#34384e}
    .shift-worker-reasons{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
    .shift-worker-reason{display:inline-flex;align-items:center;min-height:27px;padding:5px 8px;border-radius:999px;border:1px solid #dfe1e9;background:#f7f8fb;color:#565c70;font-size:.72rem;font-weight:850;line-height:1.25}
    .shift-worker-reason.tone-busy{border-color:#efc0a2;background:#fff5ee;color:#914d24}
    .shift-worker-reason.tone-leave{border-color:#efb2b5;background:#fff0f1;color:#9c3942}
    .shift-worker-reason.tone-off{border-color:#e8d7a0;background:#fff8e6;color:#84621f}
    .shift-worker-reason.tone-rule{border-color:#d7d9e5;background:#f6f6fa;color:#616579}
    .rejected-worker-copy{min-width:0;display:grid;gap:5px}
    .rejected-worker-row .shift-worker-reasons{margin-top:2px}
    .daily-matching-intro{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px;padding:13px 14px;border:1px solid #dfe1ee;border-radius:16px;background:linear-gradient(135deg,#f7f7ff,#fff)}
    .daily-matching-intro>div:first-child{display:grid;gap:4px;min-width:0}
    .daily-matching-intro>div:first-child>span{font-size:.72rem;font-weight:900;color:#6569c8}
    .daily-matching-intro strong{font-size:1rem;color:#30354c}
    .daily-matching-intro small{font-size:.7rem;color:#767b90;line-height:1.5}
    .daily-matching-counts{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}
    .daily-matching-counts b,.daily-matching-counts span{padding:6px 9px;border-radius:999px;font-size:.7rem;white-space:nowrap}
    .daily-matching-counts b{background:#eaf8ef;color:#28704f}.daily-matching-counts span{background:#f0f1f7;color:#656a80}
    .daily-matching-groups{display:grid;gap:15px}.daily-matching-groups>section{display:grid;gap:8px}.daily-matching-groups h4{margin:0;font-size:.78rem;color:#555a70}
    .daily-modern-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .daily-modern-candidate{min-width:0}.daily-modern-candidate .card-heading{align-items:flex-start}.daily-modern-candidate .candidate-cautions{margin:7px 0}
    .daily-transfer-notice{margin:8px 0;font-size:.68rem}
    .daily-matching-rejected{margin-top:14px;border:1px solid #e1e2eb;border-radius:14px;background:#fafafe;overflow:hidden}
    .daily-matching-rejected>summary{cursor:pointer;list-style:none;padding:11px 12px;font-size:.74rem;font-weight:900;color:#666a80}
    .daily-matching-rejected>summary::-webkit-details-marker{display:none}.daily-matching-rejected>summary b{display:inline-grid;place-items:center;min-width:24px;height:24px;margin-inline-start:6px;border-radius:999px;background:#eeeef5}
    .daily-rejected-list{display:grid;gap:7px;padding:0 10px 10px}
    .daily-rejected-worker{display:grid;grid-template-columns:minmax(120px,.72fr) minmax(0,1.4fr);align-items:center;gap:10px;padding:9px 10px;border:1px solid #e4e5ed;border-radius:12px;background:#fff}
    .daily-rejected-worker>div:first-child{display:grid;gap:2px}.daily-rejected-worker strong{font-size:.78rem}.daily-rejected-worker small{font-size:.64rem;color:#777c90}
    /* hf10 — Daily coverage decision surface + explicit cross-class assignments */
    #dailySuggestionsDialog{width:min(1040px,calc(100% - 24px))!important}
    #dailySuggestionsDialog .modal-card{width:100%!important;max-width:none!important}
    #dailySuggestionsList.daily-coverage-results{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:16px!important;width:100%!important;min-width:0!important}
    .daily-coverage-summary{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:18px;padding:16px 18px;border:1px solid #dfe2f2;border-radius:18px;background:linear-gradient(135deg,#f7f7ff 0%,#fff 62%,#f5fbf8 100%)}
    .daily-coverage-need{display:grid;gap:4px;min-width:0}.daily-coverage-need>span{font-size:.7rem;font-weight:950;color:#666cc8}.daily-coverage-need>strong{font-size:1.12rem;color:#30354b}.daily-coverage-need>small{font-size:.74rem;line-height:1.5;color:#72778c;max-width:680px}
    .daily-coverage-status{display:grid;gap:2px;min-width:140px;padding:10px 12px;border-radius:14px;text-align:center}.daily-coverage-status strong{font-size:.82rem}.daily-coverage-status span{font-size:.64rem;color:#74798c}.daily-coverage-status.ok{background:#eaf8ef;color:#276d4e}.daily-coverage-status.warn{background:#fff7df;color:#7d6224}.daily-coverage-status.none{background:#f2f3f7;color:#666b7c}
    .daily-matching-groups{display:grid!important;gap:14px!important}.daily-matching-groups>section,.daily-primary-options{display:grid;gap:9px}.daily-matching-groups h4{margin:0!important;font-size:.82rem!important;color:#4f556b}
    .daily-modern-grid{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:10px!important}
    .daily-coverage-option{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"main action" "source action" "reasons action" "cautions action";align-items:center;gap:10px 16px;padding:14px 15px;border:1px solid #e0e2ec;border-radius:17px;background:#fff;box-shadow:0 6px 18px rgba(45,49,82,.05)}
    .daily-coverage-option.is-recommended{border-color:#b9dfca;background:linear-gradient(135deg,#fbfffc,#fff)}
    .daily-coverage-option.is-transfer{border-color:#cdd4f1}
    .daily-option-main{grid-area:main;display:flex;align-items:flex-start;justify-content:space-between;gap:14px;min-width:0}.daily-option-identity{display:grid;gap:3px;min-width:0}.daily-option-identity h3{margin:0;font-size:1.02rem;color:#303449}.daily-option-identity p{margin:0;font-size:.72rem;color:#757a8e}
    .daily-option-badges{display:flex;gap:6px;flex-wrap:wrap}.daily-option-badges>span{display:inline-flex;align-items:center;min-height:24px;padding:4px 8px;border-radius:999px;font-size:.64rem;font-weight:900}.daily-option-type{background:#eef0ff;color:#5a61b5}.daily-option-level{background:#edf8f1;color:#2f7355}
    .daily-score-badge{display:grid;grid-template-columns:auto auto;align-items:baseline;justify-content:center;min-width:76px;padding:7px 9px;border:1px solid #e1e3ed;border-radius:12px;background:#fafafe}.daily-score-badge strong{font-size:1.16rem;color:#4f56b0}.daily-score-badge>span{font-size:.62rem;color:#85899a}.daily-score-badge small{grid-column:1/-1;font-size:.57rem;color:#85899a;text-align:center}
    .daily-option-source{grid-area:source;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border-radius:11px;background:#f2f4ff;border:1px solid #dde1f5}.daily-option-source>span{font-size:.64rem;font-weight:900;color:#646a82}.daily-option-source>strong{font-size:.72rem;color:#343952}.daily-option-source>small{flex-basis:100%;font-size:.63rem;color:#747a90;line-height:1.4}
    .daily-reason-chips{grid-area:reasons;display:flex;flex-wrap:wrap;gap:6px}.daily-reason-chips span{padding:5px 8px;border-radius:999px;background:#f3f6f4;color:#4d6257;font-size:.65rem;font-weight:800}
    .daily-option-cautions{grid-area:cautions;display:grid;gap:4px}.daily-option-cautions span{font-size:.64rem;color:#8a6228}
    .daily-cover-action{grid-area:action;align-self:stretch;min-width:165px;max-width:205px;white-space:normal;line-height:1.25}
    .daily-other-options{border:1px solid #e5e6ee;border-radius:14px;background:#fafafe;overflow:hidden}.daily-other-options>summary{cursor:pointer;padding:10px 12px;font-size:.72rem;font-weight:900;color:#64697d;list-style:none}.daily-other-options>summary::-webkit-details-marker{display:none}.daily-other-options>.daily-modern-grid{padding:0 10px 10px}
    .daily-no-safe-option{padding:18px;border:1px solid #ead6b0;border-radius:16px;background:#fffaf0}.daily-no-safe-option strong{display:block;margin-bottom:5px;color:#76551e}.daily-no-safe-option p{margin:0;color:#77705f;font-size:.74rem;line-height:1.55}
    .daily-matching-rejected{margin-top:0!important;border:1px solid #e2e3eb!important;border-radius:15px!important;background:#fafafe!important;overflow:hidden}.daily-matching-rejected>summary{display:flex!important;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px!important;cursor:pointer;list-style:none}.daily-matching-rejected>summary::-webkit-details-marker{display:none}.daily-matching-rejected>summary>div{display:grid;gap:2px}.daily-matching-rejected>summary strong{font-size:.75rem;color:#52576a}.daily-matching-rejected>summary small{font-size:.62rem;color:#85899a}.daily-rejected-toggle{font-size:.64rem;font-weight:900;color:#6269bc;white-space:nowrap}
    .daily-rejected-summary{display:flex;gap:6px;flex-wrap:wrap;padding:0 12px 10px}.daily-rejected-summary>span{padding:5px 8px;border-radius:999px;background:#eef0f5;color:#666b7c;font-size:.62rem}.daily-rejected-summary b{color:#3f4456}
    .daily-rejected-list{display:grid!important;gap:7px!important;padding:0 10px 10px!important;max-height:360px;overflow:auto}
    .daily-rejected-worker{display:grid!important;grid-template-columns:minmax(150px,.7fr) minmax(0,1.3fr)!important;align-items:start!important;gap:10px!important;padding:9px 10px!important;border:1px solid #e5e6ed!important;border-radius:11px!important;background:#fff!important}.daily-rejected-person{display:grid;gap:2px}.daily-rejected-person strong{font-size:.74rem}.daily-rejected-person small{font-size:.61rem;color:#85899a}.daily-rejected-explanation{display:grid;gap:4px}.daily-rejected-explanation p{margin:0;font-size:.66rem;color:#676c80;line-height:1.45}.daily-rejected-assignment{display:flex;gap:5px;flex-wrap:wrap}.daily-rejected-assignment span{padding:4px 7px;border-radius:8px;background:#fff3ea;color:#87512f;font-size:.62rem}
    .shift-current-assignment{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:5px;padding:7px 9px;border:1px solid #efc7a8;border-radius:10px;background:#fff6ef}.shift-current-assignment>span{font-size:.62rem;font-weight:900;color:#8d5a36}.shift-current-assignment>strong{font-size:.68rem;color:#6e4327}
    .shift-transfer-result{display:block;margin-top:5px;padding:5px 7px;border-radius:8px;background:#edf8f1;color:#347054;font-size:.63rem;font-weight:800;line-height:1.35}
    .blocked-employees>summary{display:flex;align-items:center;justify-content:space-between;cursor:pointer;padding:9px 10px;border-radius:10px;background:#f6f6fa;font-size:.7rem;font-weight:900;color:#686d80;list-style:none}.blocked-employees>summary::-webkit-details-marker{display:none}.blocked-employee-list{display:grid;gap:8px;margin-top:8px}
    .shift-blocked-action{display:inline-flex;align-items:center;max-width:180px;padding:6px 8px;border-radius:9px;background:#f0f1f4;color:#747887;font-size:.61rem;font-weight:800;line-height:1.35;text-align:center}
    .v026-selected-employee-action{display:grid;gap:4px;justify-items:end;max-width:230px}.v026-selected-employee-action small{max-width:230px;text-align:end;font-size:.61rem!important;line-height:1.35!important;color:#7a7f92!important}

    /* hf11 — coverage decision clarity + explicit shift transfer state */
    #dailySuggestionsDialog{width:min(1180px,calc(100% - 20px))!important;max-width:1180px!important}
    #dailySuggestionsDialog .modal-card{width:100%!important;max-width:none!important;max-height:min(92vh,920px)!important;overflow:hidden!important}
    #dailySuggestionsList.daily-coverage-results{width:100%!important;min-width:0!important;max-height:calc(92vh - 170px)!important;overflow:auto!important;align-content:start!important;padding:2px 4px 10px!important}
    .daily-matching-groups,.daily-primary-options,.daily-backup-options,.daily-modern-grid,.daily-other-options{width:100%!important;min-width:0!important;justify-self:stretch!important}
    .daily-coverage-summary{width:100%!important;box-sizing:border-box!important}
    .daily-coverage-option{width:100%!important;box-sizing:border-box!important;grid-template-columns:minmax(0,1fr) 190px!important;grid-template-areas:"decision decision" "main action" "source action" "reasons action" "cautions action"!important;align-items:stretch!important}
    .daily-coverage-option.is-backup{border:2px solid #e8c575!important;background:linear-gradient(135deg,#fffaf0,#fff)!important;box-shadow:0 6px 18px rgba(153,111,33,.08)!important}
    .daily-option-decision{grid-area:decision;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 11px;border-radius:11px;font-size:.72rem}
    .daily-option-decision strong{font-size:.78rem}.daily-option-decision span{line-height:1.45}
    .daily-option-decision.ok{background:#eaf8ef;color:#286c4d}.daily-option-decision.warn{background:#fff1cf;color:#77551d;border:1px solid #edcf87}
    .daily-score-badge.ok{border-color:#b9dfca!important;background:#f2fbf5!important}.daily-score-badge.warn{border-color:#e6c375!important;background:#fff8e8!important}.daily-score-badge.warn strong{color:#9a681f!important}
    .daily-backup-warning{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:10px;padding:12px 14px;border:1px solid #e8c575;border-radius:14px;background:#fff7e4;color:#74531d}
    .daily-backup-warning strong{font-size:.86rem;white-space:nowrap}.daily-backup-warning span{font-size:.72rem;line-height:1.55}
    .daily-cover-action.is-backup-action{border:1px solid #d8a94c!important;background:#fff8e7!important;color:#78551d!important;font-weight:900!important}
    .daily-cover-action.is-backup-action:hover{background:#ffefc6!important}
    .daily-option-cautions>strong{font-size:.68rem;color:#7f5a1f}.daily-option-cautions{padding:8px 10px;border-radius:10px;background:#fffaf0}
    .shift-current-assignment{border:1px solid #dfe3f3!important;background:#f7f8ff!important;padding:7px 9px!important;border-radius:10px!important}
    .shift-current-assignment.is-source{border-color:#aebce9!important;background:#eef2ff!important}
    .shift-current-assignment.is-source>span{color:#4d5f9e!important;font-weight:950!important}
    .shift-transfer-result{display:block!important;margin-top:6px!important;padding:8px 10px!important;border:1px solid #b8c6ee!important;border-radius:10px!important;background:#f1f4ff!important;color:#445485!important;line-height:1.5!important}
    .shift-transfer-result strong{display:block;margin-bottom:2px;color:#35477d}
    .v026-selected-employee-action small strong{display:block!important;margin-bottom:2px!important;color:#454b62!important}
    @media(max-width:820px){
      #dailySuggestionsDialog{width:calc(100% - 8px)!important}
      #dailySuggestionsDialog .modal-card{max-height:96vh!important;padding-inline:10px!important}
      #dailySuggestionsList.daily-coverage-results{max-height:calc(96vh - 155px)!important}
      .daily-coverage-option{grid-template-columns:1fr!important;grid-template-areas:"decision" "main" "source" "reasons" "cautions" "action"!important}
      .daily-option-decision{display:grid!important;gap:3px!important}
      .daily-backup-warning{display:grid!important;gap:4px!important}
      .daily-backup-warning strong{white-space:normal!important}
      .daily-cover-action{width:100%!important;max-width:none!important;min-width:0!important}
    }
    /* hf12 — coverage safety hierarchy + unmistakable cross-class assignment state */
    .daily-coverage-status.warn{border:1px solid #e3b85d!important;background:#fff4d8!important;color:#704d13!important}
    .daily-coverage-status.warn strong{font-size:.88rem!important}
    .daily-no-safe-option{display:grid!important;gap:6px!important;padding:16px 18px!important;border:2px solid #e3b85d!important;background:#fff8e8!important}
    .daily-no-safe-option strong{font-size:.92rem!important;color:#6f4d16!important}
    .daily-no-safe-option p{font-size:.76rem!important;line-height:1.55!important}
    .daily-emergency-options{width:100%!important;border:1px solid #e1b85f!important;border-radius:16px!important;background:#fffaf0!important;overflow:hidden!important}
    .daily-emergency-options>summary{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;padding:13px 15px!important;cursor:pointer!important;list-style:none!important;color:#714f18!important}
    .daily-emergency-options>summary::-webkit-details-marker{display:none!important}
    .daily-emergency-options>summary>div{display:grid!important;gap:2px!important}
    .daily-emergency-options>summary strong{font-size:.82rem!important}
    .daily-emergency-options>summary small{font-size:.66rem!important;color:#8a6b36!important;line-height:1.45!important}
    .daily-emergency-options>summary>b{display:grid!important;place-items:center!important;min-width:28px!important;height:28px!important;padding:0 7px!important;border-radius:999px!important;background:#f3d990!important;color:#684811!important}
    .daily-emergency-options[open]>summary{border-bottom:1px solid #ead39c!important;background:#fff5dc!important}
    .daily-emergency-options>.daily-modern-grid{padding:12px!important}
    .daily-coverage-option.is-backup{border:2px solid #e4bf68!important;background:#fffaf0!important}
    .daily-coverage-option.is-backup .daily-option-type{background:#fff0c7!important;color:#7a5718!important}
    .shift-current-assignment{display:grid!important;grid-template-columns:auto minmax(0,1fr)!important;align-items:center!important;gap:5px 9px!important;margin-top:7px!important;padding:9px 10px!important;border:2px solid #efb58e!important;background:#fff4eb!important}
    .shift-current-assignment>span{font-size:.68rem!important;font-weight:950!important;color:#8a431b!important;white-space:nowrap!important}
    .shift-current-assignment>strong{font-size:.76rem!important;color:#5f331b!important}
    .shift-current-assignment.is-source{border-color:#9fb2ea!important;background:#eef3ff!important}
    .shift-current-assignment.is-source>span{color:#3f5394!important}
    .shift-current-assignment.is-source>strong{color:#31447f!important}
    .rejected-worker-row [data-manual-override]{border:1px solid #d6a248!important;background:#fff7df!important;color:#745116!important;font-weight:900!important}
    .rejected-worker-row [data-manual-override]::after{content:" · חריגה";font-size:.58rem;opacity:.78}
    .employee-picker-current{border-width:2px!important}
    .employee-picker-current .shift-current-assignment{margin-top:8px!important}
    @media(max-width:820px){
      .daily-emergency-options>summary{align-items:flex-start!important;padding:12px!important}
      .daily-emergency-options>.daily-modern-grid{padding:9px!important}
      .shift-current-assignment{grid-template-columns:1fr!important;gap:2px!important}
      .shift-current-assignment>span{white-space:normal!important}
      .rejected-worker-row [data-manual-override]{width:100%!important}
    }
    #v036PrintRoot{display:none}
    @media print{
      @page{size:A4 landscape;margin:0}
      html,body{margin:0!important;padding:0!important;background:#fff!important}
      body.v036-printing>*:not(#v036PrintRoot){display:none!important}
      body.v036-printing #v036PrintRoot{display:block!important;position:static!important;width:auto!important;height:auto!important;margin:0!important;padding:0!important;background:#fff!important}
      body.v036-printing #v036PrintRoot .v036-print-page{display:flex!important;width:297mm!important;height:210mm!important;margin:0!important;padding:0!important;align-items:center!important;justify-content:center!important;background:#fff!important;break-after:page!important;page-break-after:always!important;overflow:hidden!important}
      body.v036-printing #v036PrintRoot .v036-print-page:last-child{break-after:auto!important;page-break-after:auto!important}
      body.v036-printing #v036PrintRoot img{display:block!important;width:100%!important;height:100%!important;object-fit:contain!important}
    }
    @media(max-width:820px){
      .v026-selected-employee{gap:10px!important;padding:12px!important}
      .v026-selected-employee-copy{gap:6px!important}
      .shift-worker-reasons{gap:5px}
      .shift-worker-reason{font-size:.74rem;white-space:normal;text-align:right}
      .rejected-worker-row{align-items:stretch!important}
      .rejected-worker-row>button{width:100%!important;justify-content:center!important}

      .daily-matching-intro{align-items:stretch;flex-direction:column;padding:11px!important}
      .daily-matching-counts{justify-content:flex-start}
      .daily-modern-grid{grid-template-columns:1fr!important}
      .daily-modern-candidate{padding:12px!important}
      .daily-modern-candidate .card-heading{gap:8px!important}
      .daily-rejected-worker{grid-template-columns:1fr!important;align-items:start!important}
      .daily-matching-rejected>summary{font-size:.78rem!important}

      #dailySuggestionsDialog{width:calc(100% - 12px)!important}
      #dailySuggestionsDialog .modal-card{padding-inline:12px!important}
      .daily-coverage-summary{grid-template-columns:1fr!important;gap:10px!important;padding:12px!important}
      .daily-coverage-status{min-width:0!important;text-align:right!important}
      .daily-coverage-option{width:100%!important;max-width:100%!important;min-width:0!important;grid-template-columns:minmax(0,1fr)!important;grid-template-areas:"decision" "main" "source" "reasons" "cautions" "action"!important;padding:12px!important;gap:9px!important;overflow:hidden!important;box-sizing:border-box!important}
      .daily-option-decision{grid-area:decision!important;width:100%!important;max-width:100%!important;min-width:0!important;box-sizing:border-box!important}
      .daily-cover-action{grid-area:action!important;width:100%!important;min-width:0!important;max-width:none!important;min-height:46px!important;box-sizing:border-box!important}
      .daily-option-main{grid-area:main!important;display:grid!important;grid-template-columns:minmax(0,1fr) 72px!important;align-items:start!important;gap:8px!important;min-width:0!important;width:100%!important;max-width:100%!important}
      .daily-option-identity{width:100%!important;max-width:100%!important;min-width:0!important}
      .daily-option-identity h3,.daily-option-identity p{max-width:100%!important;word-break:normal!important;overflow-wrap:normal!important;white-space:normal!important}
      .daily-option-identity p bdi{white-space:nowrap!important}
      .daily-option-badges{display:flex!important;flex-wrap:wrap!important;width:100%!important;max-width:100%!important;min-width:0!important;gap:5px!important}
      .daily-option-badges>span{display:inline-flex!important;width:auto!important;max-width:100%!important;min-width:0!important;white-space:nowrap!important;word-break:normal!important;overflow-wrap:normal!important}
      .daily-score-badge{width:72px!important;min-width:72px!important;max-width:72px!important;box-sizing:border-box!important;justify-self:end!important}
      .daily-rejected-worker{grid-template-columns:1fr!important}
      .daily-matching-rejected>summary{align-items:flex-start!important}
      .daily-rejected-toggle{white-space:normal!important}
      .shift-current-assignment{align-items:flex-start!important;display:grid!important;gap:3px!important}
      .shift-blocked-action{max-width:none!important;width:100%!important;justify-content:center!important}
      .v026-selected-employee-action{max-width:none!important;width:100%!important;justify-items:stretch!important}
      .v026-selected-employee-action small{text-align:center!important;max-width:none!important}

      #appVersionBadge{display:block!important;visibility:visible!important;opacity:1!important;position:fixed!important;top:auto!important;right:auto!important;left:7px!important;bottom:calc(var(--mobile-nav-height, 70px) + env(safe-area-inset-bottom) + 6px)!important;z-index:140!important;background:rgba(255,255,255,.96)!important;font-size:.66rem!important;padding:4px 8px!important}
      .schedule-secondary-actions #v036PdfBtn{grid-column:1/-1!important;min-height:44px!important;font-size:.76rem!important;width:100%!important;justify-content:center!important}
      .schedule-tools-menu:not([open])>.schedule-secondary-actions{display:none!important}
      .mobile-week-day>.v036-mobile-day-toggle{appearance:none!important;-webkit-appearance:none!important;width:100%!important;border:0!important;margin:0!important;display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;grid-template-areas:"name chevron" "stats status"!important;align-items:center!important;gap:6px 9px!important;min-height:76px!important;padding:11px 13px!important;background:linear-gradient(135deg,#fff,#fafaff)!important;color:inherit!important;text-align:right!important;font:inherit!important;cursor:pointer!important;touch-action:manipulation!important}
      .mobile-week-day.is-open>.v036-mobile-day-toggle{border-bottom:1px solid #e8e9f2!important;background:#f0efff!important}
      .mobile-week-day.is-open .mobile-week-chevron{transform:rotate(180deg)!important}
      .mobile-week-day-body[hidden]{display:none!important}
      .v036-mobile-holiday-status{background:#fff0c8!important;color:#7e5b18!important}
      .v036-mobile-holiday-body{display:grid;gap:5px;place-items:center;padding:18px 12px;border:1px solid #ecd49a;border-radius:14px;background:#fff8e8;color:#79581d;text-align:center}
      .v036-mobile-holiday-body strong{font-size:1rem}.v036-mobile-holiday-body span{font-size:.82rem;font-weight:900}.v036-mobile-holiday-body small{font-size:.68rem;line-height:1.4;color:#93763f}

      .v036-pdf-dialog{width:98vw;max-height:96vh;border-radius:18px}.v036-pdf-shell{max-height:95vh}.v036-pdf-shell>header{padding:12px}.v036-pdf-shell>header strong{font-size:1.08rem}.v036-pdf-shell>header small{font-size:.72rem}
      .v036-pdf-options{align-items:stretch;flex-direction:column;padding:9px 10px}.v036-pdf-tabs{width:100%}.v036-pdf-tabs button{flex:1;min-height:42px}.v036-month-field{justify-content:space-between}
      .v036-pdf-shell>footer{grid-template-columns:1fr 1fr;padding:10px;gap:7px}.v036-pdf-shell>footer [data-pdf-action="print"]{grid-column:1/-1}
      .v036-pdf-preview{margin-inline:7px;padding:6px;display:block;max-height:54vh}.v036-pdf-canvas{width:820px!important;max-width:none!important}.v036-pdf-status{padding-inline:10px;font-size:.73rem}.v036-mobile-copy{min-height:36px!important}.v036-copy-hint{display:none!important}
    }
    @media(max-width:430px){.v036-pdf-canvas{width:760px!important}.v036-pdf-shell>footer button{font-size:.73rem!important;padding-inline:6px!important}}
  `;
  document.head.append(v036Style);

  requestAnimationFrame(apply);
  window.__hadasV0342BootstrapPromise = Promise.resolve(true);
})();
