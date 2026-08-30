/* מערכת ניהול שיבוצים מעון הדס — שכבת ממשק 0.31.0 */
(() => {
  const VERSION = '0.31.0';
  const PREVIOUS_PATCH = '/patch-v030.js?v=0310';
  const EXPORT_SCALE = 3;

  function pinVersion() {
    window.__HADAS_RELEASE_VERSION = VERSION;
    const badge = document.querySelector('#appVersionBadge');
    if (badge) {
      badge.textContent = `v${VERSION}`;
      badge.title = `גרסת מערכת ${VERSION}`;
      badge.setAttribute('aria-label', `גרסת מערכת ${VERSION}`);
    }
    const login = document.querySelector('#loginVersion');
    if (login) login.textContent = `גרסה ${VERSION}`;
    document.documentElement.dataset.hadasVersion = VERSION;
  }

  function installVersionGuard() {
    if (window.__hadasV031VersionGuard) return;
    window.__hadasV031VersionGuard = true;
    pinVersion();
    const observer = new MutationObserver(() => {
      const badge = document.querySelector('#appVersionBadge');
      const login = document.querySelector('#loginVersion');
      if (badge && badge.textContent !== `v${VERSION}`) badge.textContent = `v${VERSION}`;
      if (login && login.textContent !== `גרסה ${VERSION}`) login.textContent = `גרסה ${VERSION}`;
      if (document.documentElement.dataset.hadasVersion !== VERSION) document.documentElement.dataset.hadasVersion = VERSION;
    });
    observer.observe(document.documentElement, { subtree:true, childList:true, characterData:true });
  }

  function loadPreviousPatch() {
    if (document.querySelector('script[data-v031-v030-loader]')) return;
    const script = document.createElement('script');
    script.src = PREVIOUS_PATCH;
    script.async = false;
    script.dataset.v031V030Loader = 'true';
    script.onload = waitForV030;
    script.onerror = () => console.error('Hadas v0.31: previous UI patch could not be loaded');
    document.head.append(script);
  }

  function waitForV030() {
    const started = Date.now();
    const timer = setInterval(() => {
      if (window.__hadasV030Installed || Date.now() - started > 9000) {
        clearInterval(timer);
        installV031();
      }
    }, 40);
  }

  function tourKey() {
    return state?.profile?.id ? `hadas-onboarding-complete:${state.profile.id}` : '';
  }

  function localTourDone() {
    const key = tourKey();
    if (!key) return false;
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
  }

  function rememberTourDone() {
    const key = tourKey();
    if (!key) return;
    try { localStorage.setItem(key, '1'); } catch {}
    if (state.profile) state.profile.onboarding_completed = true;
  }

  async function completeTour() {
    rememberTourDone();
    try {
      await apiFetch('/api/auth-me', { method:'PATCH', body:{ action:'complete_onboarding' }, timeout:8000 });
    } catch (error) {
      console.warn('Hadas v0.31 onboarding completion sync failed', error);
    }
  }

  function tourSteps() {
    const manager = isManager();
    return [
      { tab:'dashboard', icon:'⌂', title:'המסך הראשי', text:'כאן רואים בקצרה מה חשוב היום: השיבוץ שלך, עדכונים, בקשות וקיצורי דרך.' },
      { tab:'schedule', icon:'▦', title:'שיבוצים', text:manager ? 'כאן בונים את השבוע, בודקים תקינות, מוסיפים עובדים ומפרסמים לצוות.' : 'כאן רואים את השיבוץ שלך ואת השיבוץ המורשה לך לפי התפקיד.' },
      { tab:'requests', icon:'↔', title:'בקשות', text:manager ? 'כאן מטפלים בחופשות, מחלה והחלפות ומזרימים אותן לשיבוץ.' : 'מכאן מגישים חופשה, מחלה, שינוי שעות או החלפה ועוקבים אחרי הסטטוס.' },
      { tab:'announcements', icon:'◉', title:'הודעות ועדכונים', text:'כאן מרוכזות הודעות המעון. הודעות חשובות יכולות לקפוץ גם מיד בכניסה.' },
      { tab:'calendar', icon:'◫', title:'לוח שנה ועוד', text:manager ? 'בלוח השנה רואים אירועים וחופשות; בתפריט “עוד” נמצאים גם עובדים, נוכחות ותפעול יומי.' : 'בלוח השנה רואים אירועים וחופשות; בתפריט “עוד” נמצאים גם משימות ונוכחות.' },
    ];
  }

  function ensureTourDialog() {
    let dialog = document.querySelector('#v031TourDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'v031TourDialog';
    dialog.className = 'v031-tour-dialog';
    dialog.innerHTML = `
      <section class="v031-tour-card">
        <div class="v031-tour-top"><span id="v031TourIcon">⌂</span><div><small id="v031TourCounter"></small><h3 id="v031TourTitle"></h3></div></div>
        <p id="v031TourText"></p>
        <div id="v031TourDots" class="v031-tour-dots"></div>
        <div class="v031-tour-actions"><button type="button" class="ghost-btn" data-v031-tour-skip>דלג על ההדרכה</button><button type="button" class="primary-btn" data-v031-tour-next>הבא</button></div>
      </section>`;
    document.body.append(dialog);
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    dialog.addEventListener('click', async (event) => {
      if (event.target.closest('[data-v031-tour-skip]')) {
        await completeTour();
        clearTourHighlight();
        dialog.close();
        return;
      }
      if (!event.target.closest('[data-v031-tour-next]')) return;
      const steps = tourSteps();
      const index = Number(dialog.dataset.step || 0);
      if (index >= steps.length - 1) {
        await completeTour();
        clearTourHighlight();
        dialog.close();
        return;
      }
      showTourStep(index + 1);
    });
    return dialog;
  }

  function clearTourHighlight() {
    document.querySelectorAll('.v031-tour-highlight').forEach((item) => item.classList.remove('v031-tour-highlight'));
  }

  function showTourStep(index) {
    const dialog = ensureTourDialog();
    const steps = tourSteps();
    const step = steps[Math.max(0, Math.min(index, steps.length - 1))];
    dialog.dataset.step = String(index);
    clearTourHighlight();
    try { switchTab(step.tab); } catch {}
    requestAnimationFrame(() => {
      document.querySelector(`.main-nav [data-tab="${step.tab}"]`)?.classList.add('v031-tour-highlight');
    });
    document.querySelector('#v031TourIcon').textContent = step.icon;
    document.querySelector('#v031TourCounter').textContent = `${index + 1} מתוך ${steps.length}`;
    document.querySelector('#v031TourTitle').textContent = step.title;
    document.querySelector('#v031TourText').textContent = step.text;
    document.querySelector('#v031TourDots').innerHTML = steps.map((_, i) => `<i class="${i === index ? 'active' : ''}"></i>`).join('');
    const next = dialog.querySelector('[data-v031-tour-next]');
    next.textContent = index === steps.length - 1 ? 'סיום' : 'הבא';
    if (!dialog.open) dialog.showModal();
  }

  function maybeStartTour() {
    if (!state?.profile || localTourDone() || state.profile.onboarding_completed !== false) return;
    if (!document.querySelector('#appShell:not(.hidden)') || document.querySelector('#passwordScreen:not(.hidden)')) return;
    const dialog = ensureTourDialog();
    if (dialog.open || dialog.dataset.started === 'true') return;
    dialog.dataset.started = 'true';
    setTimeout(() => showTourStep(0), 450);
  }

  function installGuidedTour() {
    if (window.__v031TourInstalled) return;
    window.__v031TourInstalled = true;
    const previousRenderAll = renderAll;
    renderAll = function v031RenderAll(...args) {
      const result = previousRenderAll(...args);
      requestAnimationFrame(() => { pinVersion(); maybeStartTour(); });
      return result;
    };
    requestAnimationFrame(maybeStartTour);
  }

  function isFixedDayOff(employeeId, dateValue) {
    const employee = employeeById(employeeId);
    if (!employee) return false;
    const weekday = parseDateValue(dateValue).getDay();
    const pattern = (employee.weekly_patterns || []).find((row) => Number(row.weekday) === weekday);
    if (pattern) return pattern.day_type === 'day_off';
    return employee.fixed_day_off !== null && employee.fixed_day_off !== undefined && Number(employee.fixed_day_off) === weekday;
  }

  function exportAvailabilityRows(payload = schedulePayloadFromState()) {
    const shifts = payload.shifts || state.shifts || [];
    const source = payload.scheduleAbsences || state.scheduleAbsences || [];
    const rows = source.filter((item) => ['day_off_worked','leave','day_off','sick'].includes(item.absence_type)).map((item) => ({ ...item }));
    const keys = new Set(rows.map((item) => `${item.absence_date}|${item.employee_id}|${item.absence_type}`));
    for (const shift of shifts) {
      if (!shift?.employee_id || !shift?.shift_date || !isFixedDayOff(shift.employee_id, shift.shift_date)) continue;
      const key = `${shift.shift_date}|${shift.employee_id}|day_off_worked`;
      if (keys.has(key)) continue;
      keys.add(key);
      rows.push({ absence_date:shift.shift_date, employee_id:shift.employee_id, absence_type:'day_off_worked', absence_kind:'fixed_day_off_worked' });
    }
    return rows.sort((a,b) => String(a.absence_date).localeCompare(String(b.absence_date)) || String(employeeById(a.employee_id)?.full_name || '').localeCompare(String(employeeById(b.employee_id)?.full_name || ''), 'he'));
  }

  function installExportAndPrint() {
    if (window.__v031ExportsInstalled) return;
    window.__v031ExportsInstalled = true;
    const previousDraw = drawWeeklyScheduleCanvas;

    function drawV031(payload = schedulePayloadFromState(), weekStart = state.weekStart, title = 'שיבוץ שבועי', scale = EXPORT_SCALE) {
      const nextPayload = { ...payload, scheduleAbsences:exportAvailabilityRows(payload) };
      return previousDraw(nextPayload, weekStart, title, scale);
    }
    drawWeeklyScheduleCanvas = drawV031;

    async function pngFile(canvas, filename) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('לא ניתן להכין את התמונה');
      return new File([blob], filename, { type:'image/png', lastModified:Date.now() });
    }

    function replaceButton(id, handler) {
      const current = document.querySelector(`#${id}`);
      if (!current) return null;
      const clone = current.cloneNode(true);
      current.replaceWith(clone);
      clone.addEventListener('click', handler);
      return clone;
    }

    async function exportWeek(event) {
      const button = event.currentTarget;
      setBusy(button, true, 'מכין תמונה חדה…');
      try {
        await document.fonts?.ready;
        const canvas = drawV031(schedulePayloadFromState(), state.weekStart, 'שיבוץ שבועי', EXPORT_SCALE);
        const file = await pngFile(canvas, `שיבוץ-שבועי-${dateISO(state.weekStart)}.png`);
        const mode = await shareOrDownloadFiles([file], `שיבוץ שבועי ${formatDate(state.weekStart)}–${formatDate(addDays(state.weekStart,5))}`);
        if (mode === 'downloaded') showToast('התמונה נשמרה ברזולוציה גבוהה', 'success');
      } catch (error) { if (error?.name !== 'AbortError') showToast(error.message, 'error'); }
      finally { setBusy(button, false); }
    }

    async function exportMonth(event) {
      const button = event.currentTarget;
      setBusy(button, true, 'מכין תמונות חודשיות חדות…');
      try {
        await document.fonts?.ready;
        const monthDate = monthStart(state.weekStart);
        const weeks = await monthSchedulePayloads(monthDate);
        const monthLabel = formatDate(monthDate, { month:'long', year:'numeric' });
        const files = [];
        for (let index = 0; index < weeks.length; index += 1) {
          const { week, payload } = weeks[index];
          const canvas = drawV031(payload, week, `${monthLabel} · שבוע ${index + 1}`, EXPORT_SCALE);
          files.push(await pngFile(canvas, `שיבוץ-${monthParam(monthDate)}-שבוע-${index + 1}.png`));
        }
        const mode = await shareOrDownloadFiles(files, `שיבוץ חודשי מעון הדס · ${monthLabel}`);
        if (mode === 'downloaded') showToast(`נשמרו ${files.length} תמונות ברזולוציה גבוהה`, 'success');
      } catch (error) { if (error?.name !== 'AbortError') showToast(error.message, 'error'); }
      finally { setBusy(button, false); }
    }

    async function printWeek(event) {
      const button = event.currentTarget;
      const printWindow = window.open('', '_blank');
      if (!printWindow) return showToast('הדפדפן חסם את חלון ההדפסה. יש לאפשר חלונות קופצים ולנסות שוב.', 'error');
      setBusy(button, true, 'מכין להדפסה…');
      try {
        await document.fonts?.ready;
        const canvas = drawV031(schedulePayloadFromState(), state.weekStart, 'שיבוץ שבועי', 2.5);
        const image = canvas.toDataURL('image/png', 1);
        printWindow.document.open();
        printWindow.document.write(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>שיבוץ שבועי מעון הדס</title><style>@page{size:A4 landscape;margin:7mm}html,body{margin:0;background:#fff}body{display:flex;align-items:center;justify-content:center;min-height:100vh}.sheet{width:283mm;height:196mm;display:flex;align-items:center;justify-content:center;overflow:hidden}.sheet img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;image-rendering:auto}@media print{body{min-height:0}.sheet{page-break-after:avoid}}</style></head><body><div class="sheet"><img src="${image}" alt="שיבוץ שבועי"></div><script>const img=document.querySelector('img');img.onload=()=>setTimeout(()=>{window.focus();window.print();},180);<\/script></body></html>`);
        printWindow.document.close();
      } catch (error) {
        try { printWindow.close(); } catch {}
        showToast(error.message, 'error');
      } finally { setBusy(button, false); }
    }

    const weekly = replaceButton('imageBtn', exportWeek);
    if (weekly) { weekly.textContent = '📷 שבוע כתמונה'; weekly.title = 'תמונה שבועית ברזולוציה גבוהה'; }
    const monthly = replaceButton('monthImageBtn', exportMonth);
    if (monthly) { monthly.textContent = '🗓️ חודש כתמונות'; monthly.title = 'תמונות חודשיות ברזולוציה גבוהה'; }

    function ensurePrintButton() {
      const actions = document.querySelector('.schedule-secondary-actions');
      if (!actions || document.querySelector('#v031PrintBtn')) return;
      const button = document.createElement('button');
      button.id = 'v031PrintBtn';
      button.type = 'button';
      button.className = 'ghost-btn v031-print-btn';
      button.textContent = '🖨️ הדפסה A4';
      button.title = 'הדפסת השיבוץ השבועי בעמוד A4 לרוחב';
      button.addEventListener('click', printWeek);
      const image = document.querySelector('#imageBtn');
      if (image) image.insertAdjacentElement('afterend', button); else actions.append(button);
    }
    ensurePrintButton();
    window.__hadasV031EnsurePrintButton = ensurePrintButton;
  }

  function issueDisplayText(issue = {}) {
    return issue.message || issue.text || '';
  }

  function installValidationUx() {
    if (window.__v031ValidationUxInstalled) return;
    window.__v031ValidationUxInstalled = true;

    function validationSnapshot() {
      const result = validateScheduleClient();
      return {
        errors: result.errors || [],
        approved: (result.warnings || []).filter((item) => item._v030Approved),
        warnings: (result.warnings || []).filter((item) => !item._v030Approved),
      };
    }

    function focusIssue(issue) {
      if (issue.date && (issue.classId || issue.class_id)) {
        try { focusScheduleIssue({ ...issue, classId:issue.classId || issue.class_id }); } catch {}
        return;
      }
      if (issue.employeeId || issue.employee_id) {
        try { switchTab('employees'); } catch {}
      }
    }

    function card(issue, kind) {
      const approved = kind === 'approved';
      const warning = kind === 'warning';
      const key = issue._v030ApprovalKey || issue.approval_key || issue.id || '';
      return `<article class="v031-validation-card ${kind}">
        <div class="v031-validation-icon">${approved ? '✓' : warning ? 'i' : '!'}</div>
        <div class="v031-validation-copy"><span>${approved ? 'חריגה מאושרת' : warning ? 'הערה' : 'נדרשת החלטה'}</span><strong>${escapeHtml(issue.title || 'בדיקת תקינות')}</strong><p>${escapeHtml(issueDisplayText(issue))}</p></div>
        <div class="v031-validation-actions">
          ${issue.date || issue.classId || issue.class_id || issue.employeeId || issue.employee_id ? `<button type="button" class="ghost-btn" data-v031-focus-issue="${escapeHtml(issue.id || key)}">הצג בשיבוץ</button>` : ''}
          ${approved ? `<button type="button" class="secondary-btn" data-v031-validation-action="revoke" data-v031-key="${escapeHtml(key)}">ביטול אישור</button>` : !warning ? `<button type="button" class="primary-btn" data-v031-validation-action="approve" data-v031-key="${escapeHtml(key)}">אישור למרות החריגה</button>` : ''}
        </div>
      </article>`;
    }

    function renderPanel() {
      const panel = document.querySelector('#scheduleWarnings');
      const toggle = document.querySelector('#scheduleIssuesToggle');
      const count = document.querySelector('#scheduleIssuesCount');
      if (!panel || !toggle || !count || !isManager()) return;
      const data = validationSnapshot();
      const total = data.errors.length + data.approved.length + data.warnings.length;
      count.textContent = data.errors.length ? `${data.errors.length} בעיות · ${data.approved.length} אושרו` : data.approved.length ? `${data.approved.length} חריגות אושרו` : data.warnings.length ? `${data.warnings.length} הערות` : 'הכול תקין';
      toggle.classList.toggle('has-errors', data.errors.length > 0);
      toggle.classList.toggle('v027-all-good', total === 0);
      toggle.setAttribute('aria-expanded', String(Boolean(state.scheduleIssuesOpen)));
      panel.classList.toggle('hidden', !state.scheduleIssuesOpen);
      if (!state.scheduleIssuesOpen) return;
      const map = new Map([...data.errors, ...data.approved, ...data.warnings].map((item) => [String(item.id || item._v030ApprovalKey || item.approval_key || ''), item]));
      state.v031ValidationIssueMap = map;
      panel.innerHTML = total ? `<section class="v031-validation-panel"><header><div><strong>בדיקות תקינות לשבוע</strong><small>אפשר לאשר חריגה נקודתית ולבטל את האישור בכל רגע.</small></div><b>${data.errors.length ? `${data.errors.length} דורשות טיפול` : 'אין בעיות פתוחות'}</b></header><div class="v031-validation-list">${data.errors.map((item) => card(item,'error')).join('')}${data.approved.map((item) => card(item,'approved')).join('')}${data.warnings.map((item) => card(item,'warning')).join('')}</div></section>` : '<div class="v027-validation-success"><span>✓</span><div><strong>השיבוץ עבר את בדיקות התקינות</strong><small>לא נמצאו בעיות או חריגות בשבוע הנבחר.</small></div></div>';
    }

    function installToggle() {
      const current = document.querySelector('#scheduleIssuesToggle');
      if (!current || current.dataset.v031Installed) return;
      const clone = current.cloneNode(true);
      clone.dataset.v031Installed = 'true';
      clone.dataset.v027Installed = 'true';
      current.replaceWith(clone);
      clone.addEventListener('click', async (event) => {
        event.preventDefault();
        state.scheduleIssuesOpen = !state.scheduleIssuesOpen;
        if (state.scheduleIssuesOpen) {
          const count = document.querySelector('#scheduleIssuesCount');
          if (count) count.textContent = 'בודק…';
          try { await window.__hadasV030RefreshValidation?.({ force:true, rerender:false }); } catch {}
        }
        renderPanel();
        if (state.scheduleIssuesOpen) requestAnimationFrame(() => document.querySelector('#scheduleWarnings')?.scrollIntoView({ behavior:'smooth', block:'nearest' }));
      });
    }

    const panel = document.querySelector('#scheduleWarnings');
    if (panel && !panel.dataset.v031Events) {
      panel.dataset.v031Events = 'true';
      panel.addEventListener('click', async (event) => {
        const focus = event.target.closest('[data-v031-focus-issue]');
        if (focus) {
          const issue = state.v031ValidationIssueMap?.get(focus.dataset.v031FocusIssue);
          if (issue) focusIssue(issue);
          return;
        }
        const action = event.target.closest('[data-v031-validation-action]');
        if (!action) return;
        const approve = action.dataset.v031ValidationAction === 'approve';
        setBusy(action, true, approve ? 'מאשר…' : 'מבטל…');
        try {
          await apiFetch('/api/shifts', { method:'POST', body:{ action:approve ? 'approve_issue' : 'revoke_issue', week_start:dateISO(state.weekStart), approval_key:action.dataset.v031Key }, timeout:10000 });
          if (state.v030ValidationKey !== undefined) state.v030ValidationKey = '';
          await window.__hadasV030RefreshValidation?.({ force:true, rerender:false });
          state.scheduleValidationCache = { key:'', value:null };
          renderSchedule();
          state.scheduleIssuesOpen = true;
          requestAnimationFrame(renderPanel);
          showToast(approve ? 'החריגה אושרה ולא תסומן באדום' : 'אישור החריגה בוטל', 'success');
        } catch (error) { showToast(error.message, 'error'); }
        finally { setBusy(action, false); }
      });
    }

    installToggle();
    requestAnimationFrame(renderPanel);
    window.__hadasV031RenderValidation = () => { installToggle(); renderPanel(); };
  }

  function installShiftPicker() {
    if (window.__v031PickerInstalled) return;
    window.__v031PickerInstalled = true;
    state.v031PickerFilter = 'available';
    const previousOpen = openShiftDialog;

    function matchesQuery(candidate, query) {
      const employee = employeeById(candidate.employee_id);
      return !query || `${candidate.full_name || employee?.full_name || ''} ${candidate.job_title || employee?.job_title || ''} ${fixedClassLabel(candidate.employee_id)} ${candidate.reason || ''}`.toLowerCase().includes(query);
    }

    function candidateRow(candidate, selectedId) {
      const score = normalizeDisplayScore(candidate.score);
      const recommended = candidate.recommended !== false && score >= 62;
      const selected = candidate.employee_id === selectedId;
      return `<button type="button" class="v031-picker-row ${recommended ? 'recommended' : ''} ${selected ? 'selected' : ''}" data-picker-employee="${candidate.employee_id}" data-picker-role="${candidate.suggested_role || 'staff'}"><div class="v031-picker-main"><span><strong>${escapeHtml(candidate.full_name)}</strong>${recommended ? '<b>מומלץ</b>' : '<b class="available">זמין</b>'}</span><small>${escapeHtml([candidate.job_title, fixedClassLabel(candidate.employee_id)].filter(Boolean).join(' · '))}</small><em>${escapeHtml((candidate.reasons || []).slice(0,2).join(' · ') || 'עבר את בדיקות הזמינות')}</em></div><span class="v031-picker-score"><strong>${score}</strong><small>/100</small></span></button>`;
    }

    function rejectedRow(item) {
      const employee = employeeById(item.employee_id);
      const name = item.full_name || employee?.full_name || 'עובד';
      const reason = item.reason || 'לא זמין כרגע';
      return `<div class="v031-picker-row blocked"><div class="v031-picker-main"><span><strong>${escapeHtml(name)}</strong><b class="blocked-badge">לא זמין</b></span><small>${escapeHtml([employee?.job_title, fixedClassLabel(item.employee_id)].filter(Boolean).join(' · '))}</small><em>${escapeHtml(reason)}</em></div>${isManager() ? `<button type="button" class="ghost-btn" data-manual-override="${item.employee_id}" data-override-reason="${escapeHtml(reason)}">בחירה כחריגה</button>` : ''}</div>`;
    }

    renderShiftEmployeePicker = function v031RenderShiftEmployeePicker() {
      const form = document.querySelector('#shiftForm');
      const target = document.querySelector('#shiftEmployeeOptionsList');
      if (!form || !target) return;
      const selectedId = form.elements.employee_id.value;
      const query = String(state.shiftPickerQuery || '').trim().toLowerCase();
      const candidates = (state.shiftPickerCandidates || []).filter((item) => matchesQuery(item,query)).sort((a,b) => normalizeDisplayScore(b.score) - normalizeDisplayScore(a.score) || String(a.full_name || '').localeCompare(String(b.full_name || ''),'he'));
      const rejected = (state.shiftPickerRejected || []).filter((item) => matchesQuery(item,query));
      const leaveRejected = rejected.filter((item) => /חופש|חופשה|מחלה|היעדר|לא זמין.*יום|יום חופשי/i.test(String(item.reason || '')));
      const filter = state.v031PickerFilter || 'available';
      let body = '';
      if (filter === 'available') body = candidates.length ? candidates.map((item) => candidateRow(item,selectedId)).join('') : '<div class="empty-state compact">אין עובדים זמינים לטווח השעות שנבחר.</div>';
      else if (filter === 'leave') body = leaveRejected.length ? leaveRejected.map(rejectedRow).join('') : '<div class="empty-state compact">לא נמצאו עובדים בחופשה או ביום חופשי בתאריך הזה.</div>';
      else body = `${candidates.map((item)=>candidateRow(item,selectedId)).join('')}${rejected.map(rejectedRow).join('') || (!candidates.length ? '<div class="empty-state compact">לא נמצאו עובדים.</div>' : '')}`;
      target.innerHTML = `<div class="v031-picker-filter" role="group" aria-label="סינון עובדים"><button type="button" data-v031-picker-filter="available" class="${filter==='available'?'active':''}">זמינים</button><button type="button" data-v031-picker-filter="leave" class="${filter==='leave'?'active':''}">בחופשה</button><button type="button" data-v031-picker-filter="all" class="${filter==='all'?'active':''}">כולם</button></div><div class="v031-picker-summary">${filter==='available' ? `${candidates.length} זמינים · מסודרים לפי רמת התאמה` : filter==='leave' ? `${leaveRejected.length} בחופשה / יום חופשי` : `${candidates.length + rejected.length} עובדים בתצוגה`}</div><div class="v031-picker-list">${body}</div>`;
      const selected = state.shiftPickerCandidates.find((item) => item.employee_id === selectedId);
      const pill = document.querySelector('#shiftEmployeeSelectedScore');
      if (pill) {
        if (selected) { pill.textContent = `${normalizeDisplayScore(selected.score)}/100`; pill.classList.remove('hidden'); }
        else pill.classList.add('hidden');
      }
    };

    openShiftDialog = function v031OpenShiftDialog(shift = {}) {
      state.v031PickerFilter = 'available';
      return previousOpen(shift);
    };

    const target = document.querySelector('#shiftEmployeeOptionsList');
    if (target && !target.dataset.v031FilterEvents) {
      target.dataset.v031FilterEvents = 'true';
      target.addEventListener('click', (event) => {
        const button = event.target.closest('[data-v031-picker-filter]');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        state.v031PickerFilter = button.dataset.v031PickerFilter;
        renderShiftEmployeePicker();
      });
    }
    renderShiftEmployeePicker();
  }

  function installScheduleHook() {
    if (window.__v031ScheduleHookInstalled) return;
    window.__v031ScheduleHookInstalled = true;
    const previousRender = renderSchedule;
    renderSchedule = function v031RenderSchedule(...args) {
      const result = previousRender(...args);
      requestAnimationFrame(() => {
        pinVersion();
        window.__hadasV031EnsurePrintButton?.();
        window.__hadasV031RenderValidation?.();
      });
      return result;
    };
  }

  function installV031() {
    if (window.__hadasV031Installed) { pinVersion(); return; }
    window.__hadasV031Installed = true;
    installVersionGuard();
    installGuidedTour();
    installExportAndPrint();
    installValidationUx();
    installShiftPicker();
    installScheduleHook();
    pinVersion();
    requestAnimationFrame(() => {
      try { renderSchedule(); } catch {}
      try { renderAll(); } catch {}
      pinVersion();
    });
    setTimeout(pinVersion, 1200);
  }

  window.__HADAS_RELEASE_VERSION = VERSION;
  pinVersion();
  loadPreviousPatch();
})();