/* מערכת ניהול שיבוצים מעון הדס — שכבת ממשק 0.30.0 */
(() => {
  const VERSION = '0.30.0';
  const PREVIOUS_PATCH = '/patch-v029.js?v=0300';

  function forceVersion() {
    const badge = document.querySelector('#appVersionBadge');
    if (badge) badge.textContent = `v${VERSION}`;
    const login = document.querySelector('#loginVersion');
    if (login) login.textContent = `גרסה ${VERSION}`;
    document.documentElement.dataset.hadasVersion = VERSION;
  }

  function loadPreviousPatch() {
    if (document.querySelector('script[data-v030-v029-loader]')) return;
    const script = document.createElement('script');
    script.src = PREVIOUS_PATCH;
    script.async = false;
    script.dataset.v030V029Loader = 'true';
    script.onload = waitForV029;
    script.onerror = () => console.error('Hadas v0.30: previous UI patch could not be loaded');
    document.head.append(script);
  }

  function waitForV029() {
    const started = Date.now();
    const timer = setInterval(() => {
      if (window.__hadasV029Installed) {
        clearInterval(timer); installV030();
      } else if (Date.now() - started > 8000) {
        clearInterval(timer); installV030();
      }
    }, 40);
  }

  function issueTitle(issue = {}) {
    return ({
      understaffed: 'חוסר בכוח אדם',
      missing_leader: 'חסר/ה אחראי/ת כיתה',
      max_daily_staff: 'חריגה ממקסימום התקינה',
      fixed_day_off: 'שיבוץ ביום חופשי קבוע',
      approved_absence: 'שיבוץ בזמן חופשה / היעדרות מאושרת',
      max_weekly_hours: 'חריגה ממקסימום שעות שבועיות',
      max_weekly_days: 'חריגה ממספר ימי עבודה',
      outside_opening_hours: 'שיבוץ מחוץ לשעות המעון',
      overlap: 'חפיפת שיבוצים',
      teacher_fixed_class: 'גננת מחוץ לכיתה הקבועה',
      forbidden_class: 'אילוץ כיתה',
      outside_fixed_hours: 'חריגה מהשעות הקבועות',
      manual_rule_override: 'שיבוץ ידני חריג',
    })[issue.code] || 'בדיקת תקינות';
  }

  function installValidationApprovals() {
    if (window.__v030ValidationInstalled) return;
    window.__v030ValidationInstalled = true;
    state.v030Validation = null;
    state.v030ValidationKey = '';
    state.v030ValidationLoading = false;
    state.v030IssueMap = new Map();

    const previousValidate = validateScheduleClient;
    const previousRender = renderSchedule;
    const previousRefreshWeek = refreshScheduleWeek;

    function currentValidationKey() {
      return `${dateISO(state.weekStart)}|${state.shifts.map((row) => `${row.id}:${row.updated_at || ''}:${row.shift_date}:${row.class_id}:${row.employee_id}:${trimTime(row.start_time)}:${trimTime(row.end_time)}`).sort().join(';')}`;
    }

    function mapIssue(item, status) {
      const key = item.approval_key || item.id || `${item.code || 'issue'}:${item.date || ''}:${item.class_id || ''}:${item.employee_id || ''}:${item.time || ''}`;
      const mapped = {
        ...item,
        id: key,
        classId: item.class_id || item.classId || null,
        title: issueTitle(item),
        text: item.message || item.text || '',
        _v030Status: status,
        _v030ApprovalKey: item.approval_key || key,
        _v030Approved: status === 'approved',
      };
      state.v030IssueMap.set(key, mapped);
      return mapped;
    }

    validateScheduleClient = function v030ValidateScheduleClient() {
      if (!state.v030Validation || state.v030Validation.weekStart !== dateISO(state.weekStart)) return previousValidate();
      state.v030IssueMap = new Map();
      const errors = (state.v030Validation.errors || []).map((item) => mapIssue(item, 'error'));
      const warnings = (state.v030Validation.warnings || []).map((item) => mapIssue(item, 'warning'));
      const approved = (state.v030Validation.approved || []).map((item) => mapIssue(item, 'approved'));
      return { errors, warnings: [...approved, ...warnings] };
    };

    async function refreshValidation({ force = false, rerender = true } = {}) {
      if (!isManager() || state.v030ValidationLoading) return;
      const key = currentValidationKey();
      if (!force && state.v030ValidationKey === key && state.v030Validation) return;
      state.v030ValidationLoading = true;
      try {
        const result = await apiFetch('/api/shifts', {
          method: 'POST',
          body: { action: 'validate', week_start: dateISO(state.weekStart) },
          timeout: 12000,
        });
        state.v030Validation = {
          weekStart: result.weekStart || dateISO(state.weekStart),
          errors: result.errors || [], warnings: result.warnings || [], approved: result.approved || [],
        };
        state.v030ValidationKey = currentValidationKey();
        state.scheduleValidationCache = { key: '', value: null };
        if (rerender && state.activeTab === 'schedule') renderSchedule();
      } catch (error) {
        console.warn('Hadas v0.30 validation refresh failed', error);
      } finally { state.v030ValidationLoading = false; }
    }

    function decorateValidationRows() {
      const panel = document.querySelector('#scheduleWarnings');
      if (!panel || !isManager()) return;
      panel.querySelectorAll('.v027-validation-item[data-issue-id]').forEach((row) => {
        row.querySelector('.v030-validation-action')?.remove();
        const issue = state.v030IssueMap.get(row.dataset.issueId);
        if (!issue) return;
        row.classList.toggle('v030-approved-issue', issue._v030Approved);
        if (issue._v030Approved) {
          const icon = row.querySelector(':scope > span'); if (icon) icon.textContent = '✓';
          row.insertAdjacentHTML('beforeend', `<span class="v030-validation-action approved" data-v030-validation-action="revoke" data-v030-key="${escapeHtml(issue._v030ApprovalKey)}"><b>אושר כחריגה</b><em>ביטול אישור</em></span>`);
        } else if (issue._v030Status === 'error') {
          row.insertAdjacentHTML('beforeend', `<span class="v030-validation-action" data-v030-validation-action="approve" data-v030-key="${escapeHtml(issue._v030ApprovalKey)}"><b>אישור למרות הבעיה</b></span>`);
        }
      });
    }

    const warningPanel = document.querySelector('#scheduleWarnings');
    if (warningPanel && !warningPanel.dataset.v030ApprovalEvents) {
      warningPanel.dataset.v030ApprovalEvents = 'true';
      warningPanel.addEventListener('click', async (event) => {
        const action = event.target.closest('[data-v030-validation-action]');
        if (!action) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const approve = action.dataset.v030ValidationAction === 'approve';
        const label = action.querySelector('b') || action;
        const old = label.textContent;
        label.textContent = approve ? 'מאשר…' : 'מבטל…';
        try {
          await apiFetch('/api/shifts', {
            method: 'POST',
            body: { action: approve ? 'approve_issue' : 'revoke_issue', week_start: dateISO(state.weekStart), approval_key: action.dataset.v030Key },
          });
          state.v030ValidationKey = '';
          await refreshValidation({ force: true, rerender: true });
          showToast(approve ? 'הבעיה אושרה כחריגה ולא תסומן באדום' : 'אישור החריגה בוטל', 'success');
        } catch (error) { showToast(error.message, 'error'); label.textContent = old; }
      }, true);
    }

    renderSchedule = function v030RenderSchedule(...args) {
      const result = previousRender(...args);
      requestAnimationFrame(() => {
        decorateValidationRows();
        queueMicrotask(() => refreshValidation({ force: false, rerender: true }));
      });
      return result;
    };

    refreshScheduleWeek = async function v030RefreshScheduleWeek(...args) {
      const result = await previousRefreshWeek(...args);
      state.v030ValidationKey = '';
      await refreshValidation({ force: true, rerender: false });
      if (state.activeTab === 'schedule') renderSchedule();
      return result;
    };

    window.__hadasV030RefreshValidation = refreshValidation;
    requestAnimationFrame(() => refreshValidation({ force: true, rerender: true }));
  }

  function installRequestPreapproval() {
    if (window.__v030RequestPreapprovalInstalled) return;
    window.__v030RequestPreapprovalInstalled = true;
    const previousOpen = openRequestDialog;

    function syncPreapprovalField(options = {}) {
      const form = document.querySelector('#requestForm');
      const field = document.querySelector('#v026PreApprovedField');
      if (!form || !field) return;
      const requesterVisible = !document.querySelector('#requestRequesterField')?.classList.contains('hidden');
      const onBehalf = Boolean(isManager() && requesterVisible);
      field.classList.toggle('hidden', !onBehalf);
      const checkbox = field.querySelector('input[name="pre_approved"]');
      const strong = field.querySelector('strong');
      const small = field.querySelector('small');
      if (strong) strong.textContent = 'אושר מראש';
      if (!onBehalf) {
        if (checkbox) { checkbox.checked = false; checkbox.disabled = true; }
        return;
      }
      if (checkbox) {
        checkbox.disabled = Boolean(options.applyNow);
        if (options.applyNow) checkbox.checked = true;
      }
      const type = selectedRequestType();
      if (small) small.textContent = type === 'swap'
        ? 'אישור ההנהלה ניתן מראש. העובד שנבחר עדיין חייב לאשר את ההחלפה; לאחר אישורו לא יידרש אישור הנהלה נוסף.'
        : 'הבקשה תישמר כמאושרת על ידי ההנהלה ולא תעבור שוב למסלול אישור. ניתן יהיה להזרים אותה לשיבוץ לפי הצורך.';
    }

    openRequestDialog = function v030OpenRequestDialog(options = {}) {
      const result = previousOpen(options);
      requestAnimationFrame(() => syncPreapprovalField(options));
      return result;
    };
    document.querySelector('#requestForm')?.addEventListener('change', (event) => {
      if (event.target.name === 'request_type') requestAnimationFrame(() => syncPreapprovalField({}));
    });
  }

  function installRequestDeletion() {
    if (window.__v030RequestDeletionInstalled) return;
    window.__v030RequestDeletionInstalled = true;
    const previousRenderRequests = renderRequests;
    renderRequests = function v030RenderRequests(...args) {
      const result = previousRenderRequests(...args);
      if (!isManager()) return result;
      document.querySelectorAll('[data-v028-delete-approved]').forEach((button) => button.remove());
      for (const request of state.requests.filter((item) => ['approved','applied'].includes(item.status))) {
        const zone = document.querySelector(`[data-request-id="${request.id}"] .request-action-zone`);
        if (!zone || zone.querySelector(`[data-v030-delete-request="${request.id}"]`)) continue;
        const applied = request.status === 'applied';
        zone.insertAdjacentHTML('afterbegin', `<button type="button" class="danger-btn v030-delete-request" data-v030-delete-request="${request.id}">${applied ? 'מחיקה וביטול ההזרמה' : 'מחיקת הבקשה'}</button>`);
      }
      return result;
    };

    document.querySelector('#requestsList')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-v030-delete-request]');
      if (!button) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const request = state.requests.find((item) => item.id === button.dataset.v030DeleteRequest);
      const applied = request?.status === 'applied';
      const message = applied
        ? 'למחוק את הבקשה שכבר הוזרמה? המערכת תנסה להחזיר אוטומטית את השיבוץ למצב שלפני ההזרמה ולהסיר את החופשה מלוח השנה. אם השיבוץ השתנה מאז, המחיקה תיחסם כדי לא לדרוס נתונים.'
        : 'למחוק את הבקשה שאושרה? היא תוסר גם מזמינות הצוות ומלוח השנה.';
      if (!confirm(message)) return;
      setBusy(button, true, applied ? 'מבטל ומוחק…' : 'מוחק…');
      try {
        const result = await apiFetch('/api/requests', { method:'POST', body:{ action:'delete_request', id:button.dataset.v030DeleteRequest }, timeout:16000 });
        state.weekCache.clear(); state.calendarCache.clear();
        await refreshAll();
        showToast(result.restored_shifts ? `הבקשה נמחקה והוחזרו ${result.restored_shifts} שיבוצים` : 'הבקשה נמחקה והמערכת סונכרנה', 'success');
      } catch (error) { showToast(error.message, 'error'); }
      finally { setBusy(button, false); }
    }, true);
  }

  function installCalendarRequestDeletion() {
    if (window.__v030CalendarDeleteInstalled) return;
    window.__v030CalendarDeleteInstalled = true;
    const previousOpenEvent = openCalendarEvent;
    openCalendarEvent = function v030OpenCalendarEvent(event) {
      previousOpenEvent(event);
      if (!isManager() || event?.source !== 'approved_leave' || !event.request_id) return;
      const actions = document.querySelector('#calendarEventActions');
      if (!actions) return;
      actions.innerHTML = `<button type="button" class="danger-btn" data-v030-calendar-delete-request="${event.request_id}" data-v030-calendar-event-id="${escapeHtml(event.id || '')}">מחיקת החופשה / הבקשה</button><button type="button" class="ghost-btn close-dialog-inline">סגירה</button>`;
    };
    document.querySelector('#calendarEventActions')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-v030-calendar-delete-request]');
      if (!button) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!confirm('למחוק את החופשה המאושרת? אם היא כבר הוזרמה לשיבוץ, המערכת תחזיר את השיבוץ למצב שלפני ההזרמה.')) return;
      setBusy(button, true, 'מוחק ומסנכרן…');
      try {
        const result = await apiFetch('/api/calendar', {
          method:'DELETE',
          body:{ request_id:button.dataset.v030CalendarDeleteRequest, id:button.dataset.v030CalendarEventId },
          timeout:16000,
        });
        document.querySelector('#calendarEventDialog')?.close();
        state.calendarCache.clear(); state.weekCache.clear();
        await refreshAll();
        showToast(result.restored_shifts ? `החופשה נמחקה והוחזרו ${result.restored_shifts} שיבוצים` : 'החופשה והבקשה נמחקו', 'success');
      } catch (error) { showToast(error.message, 'error'); }
      finally { setBusy(button, false); }
    }, true);
  }

  function installImageExports() {
    if (window.__v030ImageExportsInstalled) return;
    window.__v030ImageExportsInstalled = true;
    const previousDraw = drawWeeklyScheduleCanvas;
    const EXPORT_SCALE = 2.4;

    function exportAbsences(payload) {
      return (payload.scheduleAbsences || state.scheduleAbsences || []).filter((item) => ['day_off_worked','leave','day_off','sick'].includes(item.absence_type));
    }
    function canvasText(ctx, text, x, y, size = 15, weight = 600, align = 'right', color = '#35384a', maxWidth = undefined) {
      ctx.save(); ctx.direction = 'rtl'; ctx.textAlign = align; ctx.textBaseline = 'middle';
      ctx.font = `${weight} ${size}px Arial, sans-serif`; ctx.fillStyle = color;
      if (maxWidth) ctx.fillText(String(text ?? ''), x, y, maxWidth); else ctx.fillText(String(text ?? ''), x, y);
      ctx.restore();
    }

    function drawV030WeeklyCanvas(payload = schedulePayloadFromState(), weekStart = state.weekStart, title = 'שיבוץ שבועי', scale = EXPORT_SCALE) {
      const desired = exportAbsences(payload);
      const transformed = desired.map((item) => item.absence_type === 'day_off_worked' ? { ...item, absence_type:'v030_worked_day_off' } : item);
      const nextPayload = { ...payload, scheduleAbsences: transformed };
      const canvas = previousDraw(nextPayload, weekStart, title, scale);

      const dates = Array.from({length:6}, (_,index)=>addDays(weekStart,index));
      const classes = (payload.classes || state.classes || []).filter((item)=>item.active !== false);
      const shifts = payload.shifts || state.shifts || [];
      const logicalWidth=1680, margin=34, classWidth=138, headerHeight=112, dayHeaderHeight=62;
      const dayWidth=(logicalWidth-margin*2-classWidth)/6;
      const rowHeights=classes.map((classItem)=>{
        let max=0; for(const date of dates) max=Math.max(max,shifts.filter((row)=>row.shift_date===dateISO(date)&&row.class_id===classItem.id).length);
        return Math.max(76,18+max*44);
      });
      let absenceMax=0; for(const date of dates) absenceMax=Math.max(absenceMax,desired.filter((row)=>row.absence_date===dateISO(date)).length);
      const absenceHeight=Math.max(82,22+absenceMax*28);
      const y=margin+headerHeight+dayHeaderHeight+rowHeights.reduce((a,b)=>a+b,0);
      const ctx=canvas.getContext('2d'); ctx.setTransform(scale,0,0,scale,0,0); ctx.direction='rtl';
      ctx.fillStyle='#fffaf0'; ctx.fillRect(margin,y,logicalWidth-margin*2,absenceHeight);
      ctx.strokeStyle='#eadfc9'; ctx.strokeRect(margin,y,logicalWidth-margin*2,absenceHeight);
      ctx.fillStyle='#fff2d8'; ctx.fillRect(logicalWidth-margin-classWidth,y,classWidth,absenceHeight);
      canvasText(ctx,'חופש / היעדרות',logicalWidth-margin-classWidth/2,y+absenceHeight/2,15,900,'center','#7c5d24');
      dates.forEach((date,index)=>{
        const iso=dateISO(date),right=logicalWidth-margin-classWidth-index*dayWidth,left=right-dayWidth;
        ctx.strokeStyle='#eadfc9';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(left,y+absenceHeight);ctx.stroke();
        const items=desired.filter((row)=>row.absence_date===iso);
        if(!items.length){canvasText(ctx,'אין',left+dayWidth/2,y+absenceHeight/2,12,600,'center','#a39a87');return;}
        items.forEach((item,itemIndex)=>{
          const name=employeeById(item.employee_id)?.full_name||item.employee_name||'עובד';
          const worked=item.absence_type==='day_off_worked';
          const rowY=y+8+itemIndex*28;
          ctx.fillStyle=worked?'#e7f7ed':'#fdecec';ctx.fillRect(left+6,rowY,dayWidth-12,22);
          ctx.strokeStyle=worked?'#a6d8b8':'#efb1b1';ctx.strokeRect(left+6,rowY,dayWidth-12,22);
          const line=worked?name:`${name} · ${absenceLabel(item.absence_type)}`;
          canvasText(ctx,line,right-11,rowY+11,11,800,'right',worked?'#247347':'#9a3434',dayWidth-24);
        });
      });
      return canvas;
    }

    drawWeeklyScheduleCanvas = drawV030WeeklyCanvas;

    function replaceButton(id, handler) {
      const current=document.querySelector(`#${id}`); if(!current)return null;
      const clone=current.cloneNode(true); clone.removeAttribute('data-v027-export'); clone.dataset.v030Export='true';
      current.replaceWith(clone); clone.addEventListener('click',handler); return clone;
    }
    async function pngFile(canvas, filename) {
      const blob=await new Promise((resolve)=>canvas.toBlob(resolve,'image/png'));
      if(!blob)throw new Error('לא ניתן להכין את התמונה');
      return new File([blob],filename,{type:'image/png',lastModified:Date.now()});
    }
    async function exportWeekImage(event) {
      const button=event.currentTarget;setBusy(button,true,'מכין תמונה באיכות גבוהה…');
      try{await document.fonts?.ready;const canvas=drawV030WeeklyCanvas(schedulePayloadFromState(),state.weekStart,'שיבוץ שבועי',EXPORT_SCALE);const file=await pngFile(canvas,`שיבוץ-שבועי-${dateISO(state.weekStart)}.png`);const mode=await shareOrDownloadFiles([file],'שיבוץ שבועי – מעון הדס');if(mode==='downloaded')showToast('התמונה נשמרה באיכות גבוהה','success');}
      catch(error){if(error?.name!=='AbortError')showToast(error.message,'error');}finally{setBusy(button,false);}
    }
    async function exportMonthImages(event) {
      const button=event.currentTarget;setBusy(button,true,'מכין תמונות חודשיות באיכות גבוהה…');
      try{await document.fonts?.ready;const monthDate=monthStart(state.weekStart);const weeks=await monthSchedulePayloads(monthDate);const monthLabel=formatDate(monthDate,{month:'long',year:'numeric'});const files=[];for(let index=0;index<weeks.length;index+=1){const {week,payload}=weeks[index];const canvas=drawV030WeeklyCanvas(payload,week,`${monthLabel} · שבוע ${index+1}`,EXPORT_SCALE);files.push(await pngFile(canvas,`שיבוץ-${monthParam(monthDate)}-שבוע-${index+1}.png`));}const mode=await shareOrDownloadFiles(files,`שיבוץ חודשי מעון הדס · ${monthLabel}`);if(mode==='downloaded')showToast(`נשמרו ${files.length} תמונות באיכות גבוהה`,'success');}
      catch(error){if(error?.name!=='AbortError')showToast(error.message,'error');}finally{setBusy(button,false);}
    }

    const weekly=replaceButton('imageBtn',exportWeekImage);if(weekly){weekly.classList.remove('hidden');weekly.textContent='📷 שבוע כתמונה';weekly.title='תמונה שבועית ברזולוציה גבוהה';}
    const monthly=replaceButton('monthImageBtn',exportMonthImages);if(monthly){monthly.textContent='🗓️ חודש כתמונות';monthly.title='תמונות חודשיות ברזולוציה גבוהה';}
  }

  function removeWeeklyPdf() {
    const button=document.querySelector('#printBtn');
    if(button)button.remove();
  }

  function installV030() {
    if (window.__hadasV030Installed) { forceVersion(); return; }
    window.__hadasV030Installed = true;
    forceVersion();
    removeWeeklyPdf();
    installValidationApprovals();
    installRequestPreapproval();
    installRequestDeletion();
    installCalendarRequestDeletion();
    installImageExports();
    requestAnimationFrame(() => {
      forceVersion(); removeWeeklyPdf();
      try { renderRequests(); } catch {}
      try { renderSchedule(); } catch {}
    });
    setTimeout(() => { forceVersion(); removeWeeklyPdf(); }, 1100);
  }

  forceVersion();
  loadPreviousPatch();
})();
