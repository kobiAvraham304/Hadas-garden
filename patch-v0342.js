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
      text(ctx, name, x + width - 9, y + height / 2, { size: 17.5, weight: 900, maxWidth: width * 0.59 });
      text(ctx, time, x + 9, y + height / 2, { size: 15.5, weight: 800, color: '#565d73', align: 'left', maxWidth: width * 0.36 });
      return;
    }
    text(ctx, name, x + width - 9, y + height * 0.35, { size: 20.5, weight: 900, maxWidth: width - 18 });
    text(ctx, `${time}${role ? ` · ${role}` : ''}`, x + width - 9, y + height * 0.72, { size: 16.5, weight: 800, color: '#61677b', maxWidth: width - 18 });
  }

  function absenceNamesForDate(iso) {
    return filterSubstituteAbsences(state.scheduleAbsences)
      .filter((item) => item.absence_date === iso && item.absence_type !== 'day_off_worked')
      .map((item) => employeeById(item.employee_id)?.full_name || item.employee_name || '')
      .filter(Boolean);
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
    const dayHeaderHeight = 78;
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
      const generalOff = generalDayOffFor(date);
      text(ctx, DAY_NAMES[date.getDay()], x + dayWidth / 2, dayHeaderTop + 17, { size: 20, weight: 900, align: 'center' });
      text(ctx, shortDate(date), x + dayWidth / 2, dayHeaderTop + 39, { size: 17, weight: 800, color: '#70758a', align: 'center' });
      if (generalOff) {
        text(ctx, generalOff.title || 'חופש כללי', x + dayWidth / 2, dayHeaderTop + 58, { size: 13.8, weight: 900, color: '#8a5c18', align: 'center', maxWidth: dayWidth - 12 });
        if (generalOff.description) text(ctx, compactReason(generalOff.description, 42), x + dayWidth / 2, dayHeaderTop + 73, { size: 10.8, weight: 700, color: '#9a7a49', align: 'center', maxWidth: dayWidth - 10 });
      }
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
        const generalOff = generalDayOffFor(iso);
        if (generalOff) {
          ctx.fillStyle = '#fff8e8';
          ctx.fillRect(x + 1, y + 1, dayWidth - 2, actualHeight - 2);
          text(ctx, 'חופש כללי', x + dayWidth / 2, y + actualHeight / 2 - 10, { size: 16, weight: 900, color: '#8a5c18', align: 'center', maxWidth: dayWidth - 16 });
          text(ctx, compactReason(generalOff.title || generalOff.description || '', 28), x + dayWidth / 2, y + actualHeight / 2 + 13, { size: 11.5, weight: 700, color: '#987749', align: 'center', maxWidth: dayWidth - 16 });
          return;
        }
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
  async function monthSchedulePayload(monthKey) {
    const dates = monthDates(monthKey);
    if (!dates.length) return { shifts: [], generalDaysOff: [] };
    const firstSunday = startOfWeek(dates[0]);
    const lastSunday = startOfWeek(dates[dates.length - 1]);
    const weeks = [];
    for (let cursor = firstSunday; cursor <= lastSunday; cursor = addDays(cursor, 7)) weeks.push(new Date(cursor));
    const payloads = await Promise.all(weeks.map((week) => fetchScheduleWeek(week, { force: false, apply: false })));
    const shiftMap = new Map();
    const dayOffMap = new Map();
    for (const payload of payloads) {
      for (const row of payload?.shifts || []) shiftMap.set(row.id || [row.shift_date,row.class_id,row.employee_id,row.start_time].join('|'), row);
      for (const row of payload?.generalDaysOff || []) dayOffMap.set(row.id || row.event_date, row);
    }
    return { shifts: [...shiftMap.values()], generalDaysOff: [...dayOffMap.values()] };
  }
  function buildMonthlyA4Canvas(monthKey, payload) {
    const logicalWidth = 1754, logicalHeight = 1240;
    const canvas = document.createElement('canvas');
    canvas.width = logicalWidth * SCALE; canvas.height = logicalHeight * SCALE;
    const ctx = canvas.getContext('2d', { alpha:false }); ctx.scale(SCALE,SCALE);
    ctx.fillStyle='#fff';ctx.fillRect(0,0,logicalWidth,logicalHeight);
    const margin=28, titleH=82, headerH=46, footerH=22;
    const dates=monthDates(monthKey), classes=classRows();
    const tableTop=margin+titleH, tableBottom=logicalHeight-margin-footerH;
    const rowH=(tableBottom-tableTop-headerH)/Math.max(1,dates.length);
    const dayCol=165, tableW=logicalWidth-margin*2, classW=(tableW-dayCol)/Math.max(1,classes.length);
    const [yy,mm]=monthKey.split('-').map(Number);
    const monthLabel=new Intl.DateTimeFormat('he-IL',{month:'long',year:'numeric'}).format(new Date(yy,mm-1,1,12));
    roundRect(ctx,margin,margin,tableW,titleH-8,18,'#f5f4ff','#dedff0',1.1);
    text(ctx,'שיבוץ חודשי · מעון הדס',logicalWidth-margin-24,margin+26,{size:28,weight:900});
    text(ctx,monthLabel,logicalWidth-margin-24,margin+55,{size:20,weight:800,color:'#666b80'});
    text(ctx,'A4 לרוחב · עמוד אחד',margin+22,margin+40,{size:14,weight:750,color:'#777b8e',align:'left'});
    ctx.fillStyle='#f0f1f8';ctx.fillRect(margin,tableTop,dayCol,headerH);
    text(ctx,'יום',margin+dayCol/2,tableTop+headerH/2,{size:16,weight:900,align:'center'});
    classes.forEach((classItem,index)=>{const x=margin+dayCol+index*classW;ctx.fillStyle=index%2?'#fafaff':'#f6f6fd';ctx.fillRect(x,tableTop,classW,headerH);ctx.strokeStyle='#dde0eb';ctx.strokeRect(x,tableTop,classW,headerH);text(ctx,classItem.name||'כיתה',x+classW/2,tableTop+headerH/2,{size:15,weight:900,align:'center',maxWidth:classW-10});});
    const offByDate=new Map((payload.generalDaysOff||[]).map((row)=>[String(row.event_date),row]));
    dates.forEach((date,rowIndex)=>{
      const iso=dateISO(date),y=tableTop+headerH+rowIndex*rowH,off=offByDate.get(iso);
      ctx.fillStyle=off?'#fff8e8':(rowIndex%2?'#fff':'#fdfdff');ctx.fillRect(margin,y,tableW,rowH);ctx.strokeStyle='#e2e4ed';ctx.strokeRect(margin,y,tableW,rowH);
      text(ctx,`${DAY_NAMES[date.getDay()]} · ${shortDate(date)}`,margin+dayCol-8,y+rowH/2,{size:Math.max(12,Math.min(14.5,rowH*.39)),weight:900,maxWidth:dayCol-16});
      if(off){
        text(ctx,`חופש כללי — ${compactReason(off.title||'',34)}`,margin+dayCol+10,y+rowH/2-6,{size:Math.max(11.5,Math.min(14,rowH*.36)),weight:900,color:'#8a5c18',maxWidth:tableW-dayCol-20});
        if(off.description) text(ctx,compactReason(off.description,92),margin+dayCol+10,y+rowH/2+10,{size:Math.max(9.8,Math.min(11.8,rowH*.29)),weight:700,color:'#987749',maxWidth:tableW-dayCol-20});
        return;
      }
      classes.forEach((classItem,index)=>{
        const x=margin+dayCol+index*classW;ctx.strokeStyle='#e8e9ef';ctx.strokeRect(x,y,classW,rowH);
        const rows=(payload.shifts||[]).filter((shift)=>shift.shift_date===iso&&shift.class_id===classItem.id);
        if(!rows.length){text(ctx,'—',x+classW/2,y+rowH/2,{size:11,weight:650,color:'#b0b3bf',align:'center'});return;}
        const labels=rows.slice(0,4).map((shift)=>`${employeeById(shift.employee_id)?.full_name||'עובד'} ${trimTime(shift.start_time)}–${trimTime(shift.end_time)}`);
        const line=labels.join(' · ')+(rows.length>4?` · +${rows.length-4}`:'');
        text(ctx,line,x+classW-7,y+rowH/2,{size:Math.max(10.5,Math.min(13.2,rowH*.34)),weight:800,color:'#3f4355',maxWidth:classW-14});
      });
    });
    text(ctx,`מעון הדס · ${monthLabel}`,logicalWidth-margin,logicalHeight-15,{size:10.5,weight:650,color:'#8c8f9e'});
    return canvas;
  }
  function ensureUnifiedPdfDialog() {
    let dialog=document.querySelector('#hadasUnifiedPdfDialog');
    if(dialog)return dialog;
    dialog=document.createElement('dialog'); dialog.id='hadasUnifiedPdfDialog'; dialog.className='v036-pdf-dialog';
    dialog.innerHTML=`<form method="dialog" class="v036-pdf-shell"><header><div><strong>שיבוץ PDF</strong><small>תצוגה מקדימה והדפסה A4 לרוחב בעמוד אחד</small></div><button value="cancel" class="icon-round-btn" aria-label="סגירה">×</button></header><div class="v036-pdf-options"><div class="v036-pdf-tabs"><button type="button" data-pdf-mode="week" class="active">שבוע</button><button type="button" data-pdf-mode="month">חודש</button></div><label class="v036-month-field hidden">חודש <input type="month" value="${monthKeyFromWeek()}"></label></div><div class="v036-pdf-status">מכין תצוגה…</div><div class="v036-pdf-preview"></div><footer><button type="button" class="secondary-btn" data-pdf-action="save">⬇ שמירה</button><button type="button" class="secondary-btn" data-pdf-action="share">↗ שיתוף / WhatsApp</button><button type="button" class="primary-btn" data-pdf-action="print">🖨 הדפסה A4</button></footer></form>`;
    document.body.append(dialog);
    const context={mode:'week',canvas:null,blob:null,month:monthKeyFromWeek(),busy:false};
    async function refreshPreview(){
      if(context.busy)return;context.busy=true;context.canvas=null;context.blob=null;
      const status=dialog.querySelector('.v036-pdf-status'),preview=dialog.querySelector('.v036-pdf-preview');status.textContent='מכין תצוגה…';preview.innerHTML='';
      try{
        await document.fonts?.ready;
        if(context.mode==='week') context.canvas=buildA4ScheduleCanvas();
        else {const payload=await monthSchedulePayload(context.month);context.canvas=buildMonthlyA4Canvas(context.month,payload);}
        context.blob=await pdfFromCanvas(context.canvas);
        context.canvas.classList.add('v036-pdf-canvas'); preview.append(context.canvas); status.textContent=context.mode==='week'?'שבוע · A4 לרוחב · עמוד אחד':'חודש · A4 לרוחב · עמוד אחד';
      }catch(error){status.textContent=error?.message||'הכנת התצוגה נכשלה'; if(typeof showToast==='function')showToast(status.textContent,'error');}
      finally{context.busy=false;}
    }
    function filename(){return context.mode==='week'?`שיבוץ-מעון-הדס-${dateISO(state.weekStart)}.pdf`:`שיבוץ-מעון-הדס-${context.month}.pdf`;}
    function saveBlob(){if(!context.blob)return;const url=URL.createObjectURL(context.blob),a=document.createElement('a');a.href=url;a.download=filename();document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
    dialog.addEventListener('click',async(event)=>{
      const mode=event.target.closest('[data-pdf-mode]'); if(mode){context.mode=mode.dataset.pdfMode;dialog.querySelectorAll('[data-pdf-mode]').forEach((b)=>b.classList.toggle('active',b===mode));dialog.querySelector('.v036-month-field').classList.toggle('hidden',context.mode!=='month');await refreshPreview();return;}
      const action=event.target.closest('[data-pdf-action]')?.dataset.pdfAction;if(!action)return;
      if(!context.canvas||!context.blob){await refreshPreview();if(!context.canvas||!context.blob)return;}
      if(action==='save'){saveBlob();showToast?.('קובץ ה-PDF נשמר','success');return;}
      if(action==='share'){
        const file=new File([context.blob],filename(),{type:'application/pdf'});
        if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){try{await navigator.share({files:[file],title:'שיבוץ מעון הדס'});}catch(error){if(error?.name!=='AbortError')throw error;}}
        else {saveBlob();showToast?.('השיתוף הישיר לא זמין במכשיר הזה — הקובץ נשמר וניתן לשלוח אותו ב-WhatsApp','success');}
        return;
      }
      if(action==='print'){
        const win=window.open('','_blank');if(!win){showToast?.('יש לאפשר חלונות קופצים לצורך הדפסה','error');return;}
        const src=context.canvas.toDataURL('image/jpeg',.98);
        win.document.write(`<!doctype html><html dir="rtl"><head><title>שיבוץ מעון הדס</title><style>@page{size:A4 landscape;margin:5mm}html,body{margin:0}img{width:100%;height:auto;display:block}</style></head><body><img src="${src}" onload="window.print();window.onafterprint=()=>window.close()"></body></html>`);win.document.close();
      }
    });
    dialog.querySelector('input[type="month"]').addEventListener('change',async(event)=>{context.month=event.target.value||monthKeyFromWeek();await refreshPreview();});
    dialog.__hadasRefresh=refreshPreview; dialog.__hadasContext=context;
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
        const summary=day.querySelector('summary');
        if(summary) summary.insertAdjacentHTML('beforeend',`<span class="v036-mobile-general">חופש כללי · ${escapeHtml(off.title||'')}</span>`);
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
    .v036-pdf-status{padding:0 16px 8px;color:#6b6f83;font-size:.82rem;font-weight:800}.v036-pdf-preview{overflow:auto;margin:0 14px 12px;padding:10px;border:1px solid #dfe1e9;border-radius:16px;background:#d9dbe2;display:grid;place-items:center;overscroll-behavior:contain}.v036-pdf-canvas{display:block!important;width:min(100%,1040px)!important;height:auto!important;box-shadow:0 8px 25px rgba(31,33,58,.18);background:#fff}
    .v036-pdf-shell>footer{display:grid;grid-template-columns:1fr 1fr 1.2fr;gap:9px;padding:13px 16px;background:#fff;border-top:1px solid #e4e5ed}.v036-pdf-shell>footer button{min-height:44px!important;font-size:.86rem!important}
    html[data-hadas-role="manager"] #v036PdfBtn,html[data-hadas-role="teacher"] #v036PdfBtn,html[data-hadas-role="full"] #v036PdfBtn,html[data-hadas-role="lead"] #v036PdfBtn{display:inline-flex!important;visibility:visible!important}
    @media(max-width:820px){
      #appVersionBadge{display:block!important;visibility:visible!important;opacity:1!important;position:fixed!important;top:calc(env(safe-area-inset-top) + 66px)!important;left:7px!important;bottom:auto!important;z-index:140!important;background:rgba(255,255,255,.96)!important;font-size:.66rem!important;padding:4px 8px!important}
      .schedule-secondary-actions #v036PdfBtn{grid-column:1/-1!important;min-height:44px!important;font-size:.76rem!important;width:100%!important;justify-content:center!important}
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
