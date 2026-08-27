from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]

def read(p): return (ROOT/p).read_text(encoding='utf-8')
def write(p,s):
    q=ROOT/p; q.parent.mkdir(parents=True,exist_ok=True); q.write_text(s,encoding='utf-8')
def replace_once(p,old,new):
    s=read(p); n=s.count(old)
    if n!=1: raise SystemExit(f'{p}: expected one match, found {n}: {old[:90]!r}')
    write(p,s.replace(old,new,1))
def regex_once(p,pattern,repl,flags=re.S):
    s=read(p); out,n=re.subn(pattern,repl,s,count=1,flags=flags)
    if n!=1: raise SystemExit(f'{p}: regex guard failed: {pattern[:100]!r}')
    write(p,out)

# ---------------------------------------------------------------------------
# Version metadata
# ---------------------------------------------------------------------------
replace_once('package.json','"version": "0.20.0"','"version": "0.21.0"')
replace_once('app.js','/* מערכת ניהול שיבוצים מעון הדס — גרסה 0.20.0 */','/* מערכת ניהול שיבוצים מעון הדס — גרסה 0.21.0 */')
replace_once('app.js',"state.config.version || '0.20.0'","state.config.version || '0.21.0'")
replace_once('handlers/health.js','update-v0.20.0.sql','update-v0.21.0.sql')
replace_once('handlers/health.js',"meta.data.schema_version === '0.20.0'","meta.data.schema_version === '0.21.0'")
replace_once('handlers/health.js',"databaseVersion:'0.20.0'","databaseVersion:'0.21.0'")
replace_once('health.js','supabase/update-v0.20.0.sql','supabase/update-v0.21.0.sql')

# ---------------------------------------------------------------------------
# HTML: explicit manual override, true week selector, simpler employee days,
# and a practical feedback-management toolbar.
# ---------------------------------------------------------------------------
replace_once('index.html',
'''      <input type="hidden" name="id" /><input type="hidden" name="override_day_off" value="false" />''',
'''      <input type="hidden" name="id" /><input type="hidden" name="override_day_off" value="false" /><input type="hidden" name="override_rules" value="false" /><input type="hidden" name="override_reason" value="" />''')
replace_once('index.html',
'''<small>מומלצים, עובדים פנויים והעברות בטוחות בין כיתות</small>''',
'''<small>כל הצוות מוצג: מומלצים תחילה, ובהמשך מי שנחסם עם הסיבה ואפשרות לחריגה ידנית</small>''')
replace_once('index.html',
'''<small id="shiftEmployeeHint">מוצגים רק עובדים שעברו בדיקות זמינות ותקינה. העברה מכיתה אחרת תוצע רק אם כיתת המקור נשארת תקינה.</small>''',
'''<small id="shiftEmployeeHint">בחירה רגילה מכבדת את כל הכללים. מנהלת יכולה לבחור במפורש “שיבוץ ידני חריג” לעובד שנחסם, והחריגה תישמר ותסומן.</small>''')
replace_once('index.html',
'''<label class="auto-week-picker"><span>שבוע לשיבוץ</span><input id="autoScheduleWeek" name="auto_schedule_week" type="date" /><small>אפשר לבחור כל יום בשבוע — המערכת תעבוד על השבוע שמתחיל ביום ראשון.</small></label>''',
'''<label class="auto-week-picker"><span>שבוע לשיבוץ</span><select id="autoScheduleWeek" name="auto_schedule_week"></select><small>בוחרים שבוע שלם באופן ישיר — בלי לבחור יום אקראי בתוך השבוע.</small></label>''')
replace_once('index.html',
'''<details id="employeeScheduleSection" class="employee-form-details" open><summary><span class="section-number">4</span><span><strong>ימי עבודה ושעות</strong><small>אפשר לקבוע לכל יום שעות שונות או יום חופשי.</small></span><i>⌄</i></summary><fieldset class="weekly-patterns-box"><legend class="sr-only">ימי עבודה וחופשה קבועים</legend><p class="field-help">לכל יום אפשר לבחור יום עבודה עם שעות משלו, יום חופשי קבוע, או להשאיר ללא קביעה.</p><div id="weeklyPatternFields" class="weekly-pattern-grid"></div></fieldset></details>''',
'''<details id="employeeScheduleSection" class="employee-form-details" open><summary><span class="section-number">4</span><span><strong>ימי עבודה ושעות</strong><small>לכל יום יש כלל חד-משמעי שהשיבוץ האוטומטי חייב לכבד.</small></span><i>⌄</i></summary><fieldset class="weekly-patterns-box"><legend class="sr-only">ימי עבודה וחופשה קבועים</legend><p class="field-help"><strong>יום עבודה (קבוע)</strong> — משבצים לפי השעות; <strong>יום חופשי</strong> — אסור לשיבוץ אוטומטי; <strong>לפי צורך</strong> — רק אם חסר כוח אדם ובעדיפות נמוכה.</p><div id="weeklyPatternFields" class="weekly-pattern-grid"></div></fieldset></details>''')
replace_once('index.html',
'''<section id="feedbackManagement" class="feedback-management hidden"><div class="feedback-management-head"><div><strong>משובים שהתקבלו</strong><small>רק לינור רואה את כל המשובים ויכולה להגיב.</small></div><button id="feedbackRefreshBtn" type="button" class="ghost-btn">רענון</button></div><div id="feedbackList" class="feedback-list"></div></section>''',
'''<section id="feedbackManagement" class="feedback-management hidden"><div class="feedback-management-head"><div><strong>ניהול משובים</strong><small>פתוחים בראש הרשימה, עם חיפוש וסינון מהיר.</small></div><button id="feedbackRefreshBtn" type="button" class="ghost-btn">רענון</button></div><div class="feedback-manager-toolbar"><label class="feedback-search"><span>⌕</span><input id="feedbackSearch" type="search" placeholder="חיפוש עובד, נושא או טקסט" autocomplete="off" /></label><div id="feedbackStatusChips" class="filter-chips compact-chips"><button type="button" class="filter-chip active" data-feedback-status="open">לטיפול</button><button type="button" class="filter-chip" data-feedback-status="replied">נענו</button><button type="button" class="filter-chip" data-feedback-status="closed">סגורים</button><button type="button" class="filter-chip" data-feedback-status="all">הכול</button></div></div><div id="feedbackManagerSummary" class="feedback-manager-summary"></div><div id="feedbackList" class="feedback-list manager-list"></div></section>''')

# ---------------------------------------------------------------------------
# app.js helpers and state
# ---------------------------------------------------------------------------
replace_once('app.js',
'''  feedback: [],
  feedbackCanManage: false,''',
'''  feedback: [],
  feedbackCanManage: false,
  feedbackStatusFilter: 'open',
  feedbackSearch: '', ''')
replace_once('app.js',
'''function employeeById(id) { return state.employees.find((item) => item.id === id); }
function classById(id) { return state.classes.find((item) => item.id === id); }''',
'''function employeeById(id) { return state.employees.find((item) => item.id === id); }
function classById(id) { return state.classes.find((item) => item.id === id); }
function shiftRoleRank(role) { return ({ teacher:0, lead:1, staff:2, replacement:3 })[role] ?? 9; }
function sortScheduleRows(rows=[]) { return [...rows].sort((a,b)=>shiftRoleRank(a.shift_role)-shiftRoleRank(b.shift_role)||timeToMinutes(a.start_time)-timeToMinutes(b.start_time)||String(employeeById(a.employee_id)?.full_name||'').localeCompare(String(employeeById(b.employee_id)?.full_name||''),'he')); }
function activeTaskAssignments(employeeId=state.profile?.id) { const activeIds=new Set(state.tasks.filter((task)=>task.active).map((task)=>task.id)); return state.taskAssignees.filter((assignment)=>assignment.employee_id===employeeId&&assignment.status!=='done'&&activeIds.has(assignment.task_id)); }
function fixedClassLabel(employeeId) { const employee=employeeById(employeeId); return employee?.primary_class_id ? (classById(employee.primary_class_id)?.name || '') : ''; }''')

# Bindings: week select no longer normalizes arbitrary date; feedback filters.
replace_once('app.js',
'''  $('#autoScheduleWeek')?.addEventListener('change', normalizeAutoScheduleWeekInput);''',
'''  $('#autoScheduleWeek')?.addEventListener('change', () => {});''')
replace_once('app.js',
'''  $('#feedbackRefreshBtn')?.addEventListener('click', () => loadFeedback({ force:true }));
  $('#feedbackList')?.addEventListener('click', handleFeedbackAction);''',
'''  $('#feedbackRefreshBtn')?.addEventListener('click', () => loadFeedback({ force:true }));
  $('#feedbackSearch')?.addEventListener('input', debounce((event)=>{ state.feedbackSearch=event.target.value; renderFeedback(); },120));
  $('#feedbackStatusChips')?.addEventListener('click',(event)=>{ const button=event.target.closest('[data-feedback-status]'); if(!button)return; state.feedbackStatusFilter=button.dataset.feedbackStatus; renderFeedback(); });
  $('#feedbackList')?.addEventListener('click', handleFeedbackAction);''')

# Task badge and dashboard count only active tasks.
replace_once('app.js',
'''  const openTasks = state.taskAssignees.filter((assignment) => assignment.employee_id === state.profile.id && assignment.status !== 'done').length;''',
'''  const openTasks = activeTaskAssignments().length;''')
replace_once('app.js',
'''  const dueTasks=state.taskAssignees.filter((assignment)=>assignment.employee_id===state.profile.id&&assignment.status!=='done').length;''',
'''  const dueTasks=activeTaskAssignments().length;''')

# Staff availability: include fixed classroom.
replace_once('app.js',
'''<small>${absenceLabel(item.absence_type)}</small>''',
'''<small>${absenceLabel(item.absence_type)}${fixedClassLabel(item.employee_id)?` · כיתה קבועה: ${escapeHtml(fixedClassLabel(item.employee_id))}`:''}</small>''')

# Weekly-pattern editor: exactly 3 meanings and every day explicit.
new_weekly=r'''function syncWeeklyPatternRow(row) {
  const type = $('.weekly-day-type', row).value;
  row.classList.toggle('is-work', type === 'work');
  row.classList.toggle('is-day-off', type === 'day_off');
  row.classList.toggle('is-as-needed', type === 'as_needed');
  $$('.weekly-time', row).forEach((field) => { field.classList.toggle('hidden', type !== 'work'); field.querySelector('input').required = type === 'work'; });
  const note=$('.weekly-day-off-note',row); if(note) note.textContent=type==='as_needed'?'רק אם באמת חסר כוח אדם · עדיפות נמוכה':type==='day_off'?'אסור לשיבוץ אוטומטי':'שעות עבודה קבועות';
}
function renderWeeklyPatternFields(employee = {}) {
  const patterns = employee.weekly_patterns || [];
  $('#weeklyPatternFields').innerHTML = Array.from({ length: 6 }, (_, weekday) => {
    const pattern = patterns.find((row) => Number(row.weekday) === weekday);
    const type = ['work','day_off','as_needed'].includes(pattern?.day_type) ? pattern.day_type : (pattern?.day_type === 'avoid' ? 'as_needed' : 'day_off');
    const start = trimTime(pattern?.start_time) || trimTime(employee.default_start) || '07:30';
    const fallbackEnd=weekday===5?'12:00':trimTime(employee.default_end)||'15:30';
    let end = trimTime(pattern?.end_time) || fallbackEnd;
    if (weekday===5 && timeToMinutes(end)>720) end='12:00';
    return `<article class="weekly-pattern-row" data-weekday="${weekday}"><div class="weekly-pattern-head"><strong>${DAY_NAMES[weekday]}</strong><select class="weekly-day-type" aria-label="הגדרת יום ${DAY_NAMES[weekday]}"><option value="work" ${type==='work'?'selected':''}>יום עבודה (קבוע)</option><option value="day_off" ${type==='day_off'?'selected':''}>יום חופשי (אסור לשבץ)</option><option value="as_needed" ${type==='as_needed'?'selected':''}>לפי צורך (עדיפות נמוכה)</option></select></div><label class="weekly-time">התחלה<input class="weekly-start" type="time" value="${start}"/></label><label class="weekly-time">סיום<input class="weekly-end" type="time" value="${end}" ${weekday===5?'max="12:00"':''}/></label><span class="weekly-day-off-note"></span></article>`;
  }).join('');
  $$('.weekly-pattern-row').forEach((row) => { syncWeeklyPatternRow(row); $('.weekly-day-type', row).addEventListener('change', () => syncWeeklyPatternRow(row)); });
}'''
regex_once('app.js',r"function syncWeeklyPatternRow\(row\) \{.*?\n\}\nfunction renderWeeklyPatternFields\(employee = \{\}\) \{.*?\n\}",new_weekly)

# Real week picker with understandable labels.
new_auto=r'''function syncAutoScheduleModeCards() {
  $$('.auto-mode-card').forEach((card) => card.classList.toggle('selected', Boolean(card.querySelector('input:checked'))));
}
function relativeWeekLabel(offset) { return offset===0?'השבוע הנוכחי':offset===1?'שבוע הבא':offset===-1?'שבוע שעבר':offset>1?`בעוד ${offset} שבועות`:`לפני ${Math.abs(offset)} שבועות`; }
function populateAutoScheduleWeeks() {
  const input=$('#autoScheduleWeek'); if(!input)return;
  const current=startOfWeek(new Date()); const selected=dateISO(startOfWeek(state.weekStart));
  input.innerHTML=Array.from({length:17},(_,i)=>i-4).map((offset)=>{ const start=addDays(current,offset*7),end=addDays(start,5),value=dateISO(start); return `<option value="${value}" ${value===selected?'selected':''}>${relativeWeekLabel(offset)} · ${formatDate(start,{day:'2-digit',month:'2-digit'})}–${formatDate(end,{day:'2-digit',month:'2-digit'})}</option>`; }).join('');
  if(!input.value) input.value=selected;
}
function autoSelectedWeekStart() {
  const input = $('#autoScheduleWeek');
  return input?.value ? parseDateValue(input.value) : startOfWeek(state.weekStart);
}'''
regex_once('app.js',r"function syncAutoScheduleModeCards\(\) \{.*?\n\}\nfunction autoSelectedWeekStart\(\) \{.*?\n\}\nfunction normalizeAutoScheduleWeekInput\(\) \{.*?\n\}",new_auto)
replace_once('app.js',
'''  const weekInput=$('#autoScheduleWeek'); if(weekInput) weekInput.value=dateISO(state.weekStart);
  syncAutoScheduleModeCards();''',
'''  populateAutoScheduleWeeks();
  syncAutoScheduleModeCards();''')
replace_once('app.js',
'''  const weekStart=autoSelectedWeekStart(); const weekInput=$('#autoScheduleWeek'); if(weekInput)weekInput.value=dateISO(weekStart);''',
'''  const weekStart=autoSelectedWeekStart();''')

# Schedule issue panel is truly on-demand, and closes when changing week.
replace_once('app.js',
'''  state.weekStart = target; state.expandedWeekDay = null;''',
'''  state.weekStart = target; state.expandedWeekDay = null; state.scheduleIssuesOpen = false;''')
replace_once('app.js',
'''  panel.classList.toggle('hidden', !state.scheduleIssuesOpen);
  if (!total) {''',
'''  panel.classList.toggle('hidden', !state.scheduleIssuesOpen);
  if (!state.scheduleIssuesOpen) { panel.innerHTML=''; return; }
  if (!total) {''')

# Schedule cards: fixed role order and compact actions.
replace_once('app.js',
'''const employee = employeeById(shift.employee_id); const managerActions = isManager() ? `<div class="shift-actions"><button class="replace-shift" data-action="suggest" data-id="${shift.id}">מציאת מחליף/ה</button><button class="mini-btn" data-action="edit" data-id="${shift.id}">עריכה</button><button class="delete-shift" data-action="delete" data-id="${shift.id}" aria-label="מחיקת שיבוץ">×</button></div>` : '';''',
'''const employee = employeeById(shift.employee_id); const managerActions = isManager() ? `<div class="shift-actions"><button class="replace-shift compact-shift-action" data-action="suggest" data-id="${shift.id}" title="מציאת מחליף/ה" aria-label="מציאת מחליף/ה">↔ <span>מחליף</span></button><button class="mini-btn compact-shift-action" data-action="edit" data-id="${shift.id}" title="עריכה" aria-label="עריכת שיבוץ">✎ <span>עריכה</span></button><button class="delete-shift" data-action="delete" data-id="${shift.id}" aria-label="מחיקת שיבוץ">×</button></div>` : '';''')
replace_once('app.js',
'''  const rows = state.shifts.filter((shift) => shift.shift_date === iso && shift.class_id === classItem.id);''',
'''  const rows = sortScheduleRows(state.shifts.filter((shift) => shift.shift_date === iso && shift.class_id === classItem.id));''')
replace_once('app.js',
'''const shifts = state.shifts.filter((shift) => shift.shift_date === iso && shift.class_id === classItem.id); return `<td>''',
'''const shifts = sortScheduleRows(state.shifts.filter((shift) => shift.shift_date === iso && shift.class_id === classItem.id)); return `<td>''')
replace_once('app.js',
'''const rows = state.shifts.filter((shift) => shift.shift_date === iso && shift.class_id === classItem.id); const coverage = coverageFor(rows, iso); return `<article class="day-class-card"''',
'''const rows = sortScheduleRows(state.shifts.filter((shift) => shift.shift_date === iso && shift.class_id === classItem.id)); const coverage = coverageFor(rows, iso); return `<article class="day-class-card"''')
replace_once('app.js',
'''const classCards=visibleClasses.map((item,index)=>{ const rows=shifts.filter((shift)=>shift.class_id===item.id);''',
'''const classCards=visibleClasses.map((item,index)=>{ const rows=sortScheduleRows(shifts.filter((shift)=>shift.class_id===item.id));''')
replace_once('app.js',
'''      const classRows = rows.filter((row) => row.class_id === classItem.id);''',
'''      const classRows = sortScheduleRows(rows.filter((row) => row.class_id === classItem.id));''')

# PDF/export colors: teacher green, lead purple.
replace_once('app.js',
'''  if (role === 'teacher') return { fill: '#eef1ff', border: '#cfd5ff', accent: '#565ec0' };
  if (role === 'lead') return { fill: '#eefaf6', border: '#c9e8da', accent: '#2f8066' };''',
'''  if (role === 'teacher') return { fill: '#e8f6ef', border: '#b9dfca', accent: '#267454' };
  if (role === 'lead') return { fill: '#f1ecfa', border: '#d7c8ee', accent: '#6b4aa0' };''')
# Sort PDF cell items by role before drawing.
replace_once('app.js',
'''      const items = shifts.filter((shift) => shift.shift_date === dateISO(date) && shift.class_id === classItem.id);''',
'''      const items = sortScheduleRows(shifts.filter((shift) => shift.shift_date === dateISO(date) && shift.class_id === classItem.id));''')

# Full rejected list + explicit manual override button, searchable on mobile.
new_rejected=r'''function rejectedReasonsHtml(rejected = []) {
  const query=String(state.shiftPickerQuery||'').trim().toLowerCase();
  const rows=rejected.filter((item)=>{ const employee=employeeById(item.employee_id); const hay=`${item.full_name||''} ${employee?.job_title||''} ${fixedClassLabel(item.employee_id)} ${item.reason||''}`.toLowerCase(); return !query||hay.includes(query); });
  if (!rows.length) return '';
  return `<details class="matching-rejected-details"><summary>עובדים שלא עברו את הכללים <b>${rows.length}</b></summary><div class="rejected-worker-list">${rows.map((item)=>{ const employee=employeeById(item.employee_id); const className=fixedClassLabel(item.employee_id); return `<article class="rejected-worker-row"><div><strong>${escapeHtml(item.full_name||employee?.full_name||'עובד')}</strong><small>${escapeHtml([employee?.job_title,className?`כיתה קבועה: ${className}`:''].filter(Boolean).join(' · '))}</small><em>${escapeHtml(item.reason||'לא עבר/ה את בדיקות ההתאמה')}</em></div><button type="button" data-manual-override="${item.employee_id}" data-override-reason="${escapeHtml(item.reason||'חריגה ידנית')}">שיבוץ ידני חריג</button></article>`; }).join('')}</div></details>`;
}'''
regex_once('app.js',r"function rejectedReasonsHtml\(rejected = \[\]\) \{.*?\n\}",new_rejected)
replace_once('app.js',
'''  const rows = state.shiftPickerCandidates.filter((candidate) => !query || `${candidate.full_name} ${candidate.job_title}`.toLowerCase().includes(query));''',
'''  const rows = state.shiftPickerCandidates.filter((candidate) => !query || `${candidate.full_name} ${candidate.job_title} ${fixedClassLabel(candidate.employee_id)}`.toLowerCase().includes(query));''')
replace_once('app.js',
'''  const rejectedSummary = rejectedReasonsHtml(state.shiftPickerRejected);''',
'''  const rejectedSummary = rejectedReasonsHtml(state.shiftPickerRejected);''')
# Handle normal and override picker clicks.
new_picker_click=r'''function handleShiftEmployeePickerClick(event) {
  const override = event.target.closest('[data-manual-override]');
  const form=$('#shiftForm');
  if (override) {
    form.elements.employee_id.value=override.dataset.manualOverride;
    form.elements.override_rules.value='true'; form.elements.override_reason.value=override.dataset.overrideReason||'חריגה ידנית';
    syncShiftRoleFromEmployee(true); syncShiftHoursFromPattern(); renderShiftEmployeePicker(); updateShiftEmployeeHint(); return;
  }
  const button = event.target.closest('[data-picker-employee]'); if (!button) return;
  form.elements.employee_id.value = button.dataset.pickerEmployee;
  form.elements.override_rules.value='false'; form.elements.override_reason.value='';
  if (button.dataset.pickerRole && form.dataset.roleTouched !== 'true') form.elements.shift_role.value = button.dataset.pickerRole;
  renderShiftEmployeePicker(); syncShiftHoursFromPattern(); syncShiftRoleFromEmployee(true); updateShiftEmployeeHint();
}'''
regex_once('app.js',r"function handleShiftEmployeePickerClick\(event\) \{.*?\n\}",new_picker_click)
replace_once('app.js',
'''  hint.textContent = candidate ? `התאמה ${normalizeDisplayScore(candidate.score)} מתוך 100: ${candidate.reasons.slice(0,3).join(" · ")}` : employee ? `${employee.job_title} אינו מופיע כרגע כמועמד זמין לשיבוץ הזה.` : "בחרו עובד מתוך הרשימה.";''',
'''  const manual=form.elements.override_rules.value==='true'; hint.textContent = manual ? `חריגה ידנית: ${form.elements.override_reason.value}. השיבוץ יסומן כחריגה ולא ישפיע על המלצות אוטומטיות.` : candidate ? `התאמה ${normalizeDisplayScore(candidate.score)} מתוך 100: ${candidate.reasons.slice(0,3).join(" · ")}` : employee ? `${employee.job_title} אינו מופיע כרגע כמועמד רגיל. אפשר לבחור אותו רק דרך “שיבוץ ידני חריג”.` : "בחרו עובד מתוך הרשימה.";''')
replace_once('app.js',
'''  form.elements.override_day_off.value = "false";''',
'''  form.elements.override_day_off.value = "false"; form.elements.override_rules.value = shift.rule_override ? "true" : "false"; form.elements.override_reason.value = shift.rule_override_note || "";''')
# Manual override save confirmation and no suggestion shortcut.
replace_once('app.js',
'''  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[value="default"]'); const data = formObject(form); data.override_day_off = data.override_day_off === 'true'; const wasPublished=isPublishedWeekDate(data.shift_date); const employeeName=employeeById(data.employee_id)?.full_name || 'העובד'; setBusy(button, true);''',
'''  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[value="default"]'); const data = formObject(form); data.override_day_off = data.override_day_off === 'true'; data.override_rules=data.override_rules==='true'; const wasPublished=isPublishedWeekDate(data.shift_date); const employeeName=employeeById(data.employee_id)?.full_name || 'העובד'; if(data.override_rules&&!confirm(`זהו שיבוץ ידני חריג עבור ${employeeName}.\nהכלל שנעקף: ${data.override_reason||'כלל שיבוץ'}\nלהמשיך ולשמור?`)) return; setBusy(button, true);''')
replace_once('app.js',
'''    if (candidate && candidate.employee_id === data.employee_id) {''',
'''    if (!data.override_rules && candidate && candidate.employee_id === data.employee_id) {''')

# Feedback: practical manager list, filters, summary and ordering.
new_feedback=r'''function renderFeedback() {
  const manager=state.feedbackCanManage;
  $('#feedbackManagement')?.classList.toggle('hidden',!manager);
  if(manager) {
    $$('#feedbackStatusChips [data-feedback-status]').forEach((button)=>button.classList.toggle('active',button.dataset.feedbackStatus===state.feedbackStatusFilter));
    const query=String(state.feedbackSearch||'').trim().toLowerCase();
    const rank={open:0,replied:1,closed:2};
    const rows=[...state.feedback].filter((item)=>(state.feedbackStatusFilter==='all'||(state.feedbackStatusFilter==='open'?(item.status==='open'):item.status===state.feedbackStatusFilter))&&(!query||`${item.employee_name||''} ${item.topic||''} ${item.content||''} ${item.response_text||''}`.toLowerCase().includes(query))).sort((a,b)=>(rank[a.status]??9)-(rank[b.status]??9)||new Date(b.created_at)-new Date(a.created_at));
    const counts={open:state.feedback.filter((i)=>i.status==='open').length,replied:state.feedback.filter((i)=>i.status==='replied').length,closed:state.feedback.filter((i)=>i.status==='closed').length};
    $('#feedbackManagerSummary').innerHTML=`<span><strong>${counts.open}</strong> לטיפול</span><span><strong>${counts.replied}</strong> נענו</span><span><strong>${counts.closed}</strong> סגורים</span><span><strong>${rows.length}</strong> מוצגים</span>`;
    $('#feedbackList').innerHTML=rows.length?rows.map((item)=>feedbackCardHtml(item,{manager:true})).join(''):'<div class="empty-state compact">אין משובים בסינון הזה.</div>';
  }
  const mine=state.feedback.filter((item)=>item.employee_id===state.profile?.id);
  $('#myFeedbackList').innerHTML=mine.length?mine.map((item)=>feedbackCardHtml(item)).join(''):'<div class="empty-state compact">עדיין לא שלחת משוב.</div>';
  $('#myFeedback')?.classList.toggle('hidden',manager && !mine.length);
}'''
regex_once('app.js',r"function renderFeedback\(\) \{.*?\n\}
async function loadFeedback",new_feedback+'\nasync function loadFeedback')

# ---------------------------------------------------------------------------
# Matching: an unconfigured day is unavailable; as-needed is real last resort.
# ---------------------------------------------------------------------------
replace_once('lib/matching.js',
'''  if (pattern?.day_type === 'as_needed') return {
    start: short(pattern.start_time) || short(employee.default_start) || '07:30',
    end: short(pattern.end_time) || short(employee.default_end) || (friday ? '12:00' : '15:30'),
    source: 'as_needed',
  };
  if (pattern?.day_type === 'avoid') return {
    start: short(employee.default_start) || '07:30',
    end: short(employee.default_end) || (friday ? '12:00' : '15:30'),
    source: 'avoid',
  };
  return {
    start: short(employee.default_start) || '07:30',
    end: short(employee.default_end) || (friday ? '12:00' : '15:30'),
    source: 'default',
  };''',
'''  if (pattern?.day_type === 'as_needed' || pattern?.day_type === 'avoid') return {
    start: short(employee.default_start) || '07:30',
    end: short(employee.default_end) || (friday ? '12:00' : '15:30'),
    source: 'as_needed',
  };
  return { start:null, end:null, source:'not_configured' };''')
replace_once('lib/matching.js',
'''  if (pattern?.day_type === 'as_needed') { score += 15; reasons.push('מוגדר/ת לפי צורך ביום זה'); }
  if (pattern?.day_type === 'avoid') { score -= 24; cautions.push('היום סומן בכרטיס כעדיף להימנע'); }
  if (availability?.source === 'default' && !pattern) cautions.push('אין יום עבודה מפורש בכרטיס');''',
'''  if (pattern?.day_type === 'as_needed' || pattern?.day_type === 'avoid') { score -= 34; reasons.push('זמין/ה לפי צורך בלבד'); cautions.push('עדיפות נמוכה — לבחור רק אם אין חלופה ביום עבודה קבוע'); }''')
replace_once('lib/matching.js',
'''    const pattern = dayPattern(mergedContext, employee.id, date);
    if (pattern?.day_type === 'day_off' || (!pattern && employee.fixed_day_off != null && Number(employee.fixed_day_off) === dayOf(date))) { reject('יום חופשי קבוע'); continue; }
    const availability = availabilityFor(mergedContext, employee, pattern, date);''',
'''    const pattern = dayPattern(mergedContext, employee.id, date);
    if (!pattern) { reject('היום אינו מוגדר כיום עבודה או לפי צורך'); continue; }
    if (pattern?.day_type === 'day_off' || (!pattern && employee.fixed_day_off != null && Number(employee.fixed_day_off) === dayOf(date))) { reject('יום חופשי קבוע — אסור לשיבוץ אוטומטי'); continue; }
    const availability = availabilityFor(mergedContext, employee, pattern, date);''')

# Return every rejected worker, not arbitrary first 20.
replace_once('handlers/suggestions.js','''      rejected: ranking.rejected.slice(0, 20),''','''      rejected: ranking.rejected,''')

# ---------------------------------------------------------------------------
# Automatic scheduler: explicit day rules only; as-needed strongly last.
# ---------------------------------------------------------------------------
replace_once('lib/auto-schedule.js',
'''  const pattern = patternFor(patterns, employee.id, weekday);
  if (pattern?.day_type === 'day_off' || (!pattern && employee.fixed_day_off != null && Number(employee.fixed_day_off) === weekday)) return null;''',
'''  const pattern = patternFor(patterns, employee.id, weekday);
  if (!pattern) return null;
  if (pattern?.day_type === 'day_off' || (!pattern && employee.fixed_day_off != null && Number(employee.fixed_day_off) === weekday)) return null;''')
replace_once('lib/auto-schedule.js',
'''  } else if (pattern?.day_type === 'as_needed') {
    source = 'as_needed';
    asNeeded = true;
    confidence = 18;
  } else if (pattern?.day_type === 'avoid') {
    source = 'avoid';
    confidence = -10;
  } else if (employee.assignment_mode === 'substitute' || employee.assignment_mode === 'rotation') {
    confidence = 12;
  } else {
    confidence = 2;
  }''',
'''  } else if (pattern?.day_type === 'as_needed' || pattern?.day_type === 'avoid') {
    source = 'as_needed';
    asNeeded = true;
    confidence = -38;
  } else {
    return null;
  }''')
replace_once('lib/auto-schedule.js',
'''  if (availability.asNeeded) reasons.push('זמין/ה לפי צורך');
  if (availability.source === 'avoid') { score -= 42; reasons.push('היום סומן כעדיף להימנע'); }''',
'''  if (availability.asNeeded) { score -= 42; reasons.push('לפי צורך בלבד — עדיפות נמוכה'); }''')

# ---------------------------------------------------------------------------
# Employee save: unambiguous 6-day rules, and no 5-query reload after PATCH.
# ---------------------------------------------------------------------------
new_normalize=r'''function normalizeWeeklyPatterns(patterns, assignmentMode) {
  if (!Array.isArray(patterns)) return null;
  if (assignmentMode === 'no_schedule') return [];
  const rows = [];
  const seen = new Set();
  for (const item of patterns) {
    const weekday = Number(item.weekday);
    const dayType = String(item.day_type || '');
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 5) throw httpError(400,'יום בשבוע אינו תקין');
    if (seen.has(weekday)) throw httpError(400,'יום בשבוע הוגדר יותר מפעם אחת');
    seen.add(weekday);
    if (!['work','day_off','as_needed'].includes(dayType)) throw httpError(400,'יש לבחור לכל יום: יום עבודה, יום חופשי או לפי צורך');
    if (dayType === 'day_off' || dayType === 'as_needed') { rows.push({ weekday, day_type:dayType, start_time:null, end_time:null }); continue; }
    const start = String(item.start_time || '').slice(0,5); const end = String(item.end_time || '').slice(0,5);
    if (!start || !end || timeToMinutes(end) <= timeToMinutes(start)) throw httpError(400,'יש להזין שעות תקינות לכל יום עבודה קבוע');
    if (weekday === 5 && timeToMinutes(end) > timeToMinutes('12:00')) throw httpError(400,'ביום שישי ניתן להגדיר עבודה עד 12:00');
    rows.push({ weekday, day_type:'work', start_time:start, end_time:end });
  }
  if (seen.size !== 6 || [0,1,2,3,4,5].some((day)=>!seen.has(day))) throw httpError(400,'יש להגדיר כלל לכל אחד מימי ראשון–שישי');
  return rows;
}

async function replaceWeeklyPatterns(employeeId, patterns, assignmentMode) {
  const rows = normalizeWeeklyPatterns(patterns, assignmentMode);
  if (rows === null) return null;
  assertDb(await db().from('hadas_employee_weekly_patterns').delete().eq('employee_id',employeeId), 'לא ניתן לעדכן את ימי העבודה הקבועים');
  if (rows.length) assertDb(await db().from('hadas_employee_weekly_patterns').insert(rows.map((row) => ({ ...row, employee_id:employeeId }))), 'לא ניתן לשמור את ימי העבודה הקבועים');
  return rows.map((row)=>({ ...row, employee_id:employeeId }));
}'''
regex_once('handlers/employees.js',r"function normalizeWeeklyPatterns\(patterns, assignmentMode\) \{.*?\n\}\n\nasync function replaceWeeklyPatterns\(employeeId, patterns, assignmentMode\) \{.*?\n\}",new_normalize)
# replaceConstraints returns rows for fast response.
replace_once('handlers/employees.js',
'''  if (rows.length) assertDb(await db().from('hadas_employee_class_constraints').insert(rows), 'לא ניתן לשמור אילוצים');
}''',
'''  if (rows.length) assertDb(await db().from('hadas_employee_class_constraints').insert(rows), 'לא ניתן לשמור אילוצים');
  return rows;
}''')
# Parallel initial reads.
replace_once('handlers/employees.js',
'''      const employee = assertDb(await db().from('hadas_employees').select('*').eq('id',employeeId).maybeSingle(), 'העובד לא נמצא');
      if (!employee) throw httpError(404,'העובד לא נמצא');
      const user = assertDb(await db().from('hadas_users').select('*').eq('employee_id',employeeId).maybeSingle(), 'המשתמש לא נמצא');
      if (!user) throw httpError(404,'לא נמצא משתמש לכרטיס העובד');''',
'''      const [employeeR,userR] = await Promise.all([
        db().from('hadas_employees').select('*').eq('id',employeeId).maybeSingle(),
        db().from('hadas_users').select('*').eq('employee_id',employeeId).maybeSingle(),
      ]);
      const employee=assertDb(employeeR,'העובד לא נמצא'); if(!employee) throw httpError(404,'העובד לא נמצא');
      const user=assertDb(userR,'המשתמש לא נמצא'); if(!user) throw httpError(404,'לא נמצא משתמש לכרטיס העובד');''')
# Replace PATCH write/result block.
old_patch='''      await Promise.all([
        Object.keys(employeeUpdate).length ? db().from('hadas_employees').update(employeeUpdate).eq('id',employeeId).then((r)=>assertDb(r,'לא ניתן לעדכן עובד')) : Promise.resolve(),
        Object.keys(userUpdate).length ? db().from('hadas_users').update(userUpdate).eq('id',user.id).then((r)=>assertDb(r,'לא ניתן לעדכן הרשאה')) : Promise.resolve(),
        Array.isArray(body.weekly_patterns) ? replaceWeeklyPatterns(employeeId,body.weekly_patterns,employeeUpdate.assignment_mode || employee.assignment_mode) : Promise.resolve(),
        Array.isArray(body.constraints) ? replaceConstraints(employeeId,body.constraints,caller.employee.id) : Promise.resolve(),
        upsertPrivate(employeeId,body.admin_notes),
      ]);
      if (body.reset_password || body.active === false) await revokeUserSessions(user.id);
      await audit(caller.employee.id,'update','employee',employeeId,{ fields:Object.keys(body) });
      await emitEvent('employees');
      const result = await employeeResult(employeeId);
      return send(res,200,{ ok:true,...result });'''
new_patch='''      const [, , savedPatterns, savedConstraints] = await Promise.all([
        Object.keys(employeeUpdate).length ? db().from('hadas_employees').update(employeeUpdate).eq('id',employeeId).then((r)=>assertDb(r,'לא ניתן לעדכן עובד')) : Promise.resolve(),
        Object.keys(userUpdate).length ? db().from('hadas_users').update(userUpdate).eq('id',user.id).then((r)=>assertDb(r,'לא ניתן לעדכן הרשאה')) : Promise.resolve(),
        Array.isArray(body.weekly_patterns) ? replaceWeeklyPatterns(employeeId,body.weekly_patterns,employeeUpdate.assignment_mode || employee.assignment_mode) : Promise.resolve(null),
        Array.isArray(body.constraints) ? replaceConstraints(employeeId,body.constraints,caller.employee.id) : Promise.resolve(null),
        upsertPrivate(employeeId,body.admin_notes),
      ]);
      if (body.reset_password || body.active === false) await revokeUserSessions(user.id);
      await Promise.all([audit(caller.employee.id,'update','employee',employeeId,{ fields:Object.keys(body) }),emitEvent('employees')]);
      const mergedEmployee={ ...employee, ...employeeUpdate, id:employeeId, phone:displayPhone(userUpdate.phone || user.phone || employeeUpdate.contact_phone || employee.contact_phone), role:userUpdate.role || user.role, user_active:userUpdate.active ?? user.active, must_change_password:userUpdate.must_change_password ?? user.must_change_password, last_login_at:user.last_login_at || null, admin_notes:body.admin_notes === undefined ? '' : String(body.admin_notes || ''), weekly_patterns:savedPatterns || body.weekly_patterns || [] };
      return send(res,200,{ ok:true,employee:mergedEmployee,constraints:savedConstraints || body.constraints || [] });'''
replace_once('handlers/employees.js',old_patch,new_patch)

# ---------------------------------------------------------------------------
# Shift validation with explicit, persisted manager overrides.
# ---------------------------------------------------------------------------
new_validate=r'''async function validateShift(payload, id, overrideDayOff = false, overrideRules = false) {
  if (!payload.shift_date || !payload.class_id || !payload.employee_id) throw httpError(400, 'חסרים פרטי שיבוץ');
  if (!payload.start_time || !payload.end_time || timeToMinutes(payload.end_time) <= timeToMinutes(payload.start_time)) throw httpError(400, 'שעות השיבוץ אינן תקינות');
  const [employeeR, classR, settingsR, patternR, requestsR] = await Promise.all([
    db().from('hadas_employees').select('*').eq('id', payload.employee_id).maybeSingle(),
    db().from('hadas_classes').select('*').eq('id', payload.class_id).maybeSingle(),
    db().from('hadas_app_settings').select('*').eq('id', 1).maybeSingle(),
    db().from('hadas_employee_weekly_patterns').select('*').eq('employee_id', payload.employee_id),
    db().from('hadas_requests').select('request_type,request_date,request_end_date,status').eq('requester_id',payload.employee_id).in('request_type',['leave','day_off','sick']).in('status',['approved','applied']).lte('request_date',payload.shift_date),
  ]);
  const employee = assertDb(employeeR, 'העובד לא נמצא'); const classItem = assertDb(classR, 'הכיתה לא נמצאה'); const settings = assertDb(settingsR, 'הגדרות המערכת לא נמצאו');
  const weeklyPatterns = assertDb(patternR, 'לא ניתן לבדוק את ימי העבודה הקבועים') || []; const requests=assertDb(requestsR,'לא ניתן לבדוק חופשות')||[];
  if (!employee?.active) throw httpError(409, 'העובד אינו פעיל');
  if (employee.is_schedulable === false) throw httpError(409, 'העובד אינו מוגדר כחלק ממערך השיבוצים');
  if (['teacher', 'lead'].includes(payload.shift_role) && !employeeCanLead(employee)) throw httpError(409, 'העובד אינו מורשה לשמש גננת/גנן או מוביל/ת כיתה');
  if (!classItem?.active) throw httpError(409, 'הכיתה אינה פעילה');
  const dayClosing = closingTimeForDate(settings, payload.shift_date);
  if (timeToMinutes(payload.start_time) < timeToMinutes(settings.opening_time) || timeToMinutes(payload.end_time) > timeToMinutes(dayClosing)) throw httpError(409, `השיבוץ חייב להיות בין ${String(settings.opening_time).slice(0,5)} ל-${dayClosing}`);
  const existingQuery = db().from('hadas_shifts').select('id').eq('employee_id', payload.employee_id).eq('shift_date', payload.shift_date).lt('start_time', payload.end_time).gt('end_time', payload.start_time); if (id) existingQuery.neq('id', id);
  const overlaps = assertDb(await existingQuery, 'בדיקת חפיפה נכשלה') || []; if (overlaps.length) throw httpError(409, 'העובד כבר משובץ בשעות חופפות');

  if (!overrideRules) {
    if (employee.job_title === 'גננת' && employee.primary_class_id && employee.primary_class_id !== payload.class_id) throw httpError(409, 'גננת ניתנת לשיבוץ רק בכיתה הקבועה שלה');
    const constraintRows = assertDb(await db().from('hadas_employee_class_constraints').select('id,reason,valid_from,valid_to').eq('employee_id', payload.employee_id).eq('class_id', payload.class_id).eq('constraint_type', 'forbidden'), 'בדיקת אילוצים נכשלה') || [];
    const forbidden = constraintRows.find((item) => (!item.valid_from || item.valid_from <= payload.shift_date) && (!item.valid_to || item.valid_to >= payload.shift_date));
    if (forbidden) throw httpError(409, forbidden.reason ? `קיים איסור שיבוץ בכיתה: ${forbidden.reason}` : 'קיים איסור לשבץ את העובד בכיתה זו');
    const approvedAbsence=requests.find((row)=>row.request_date<=payload.shift_date&&payload.shift_date<=String(row.request_end_date||row.request_date));
    if(approvedAbsence) throw httpError(409, `לעובד יש ${approvedAbsence.request_type==='sick'?'מחלה':'חופשה/יום חופשי'} מאושרים בתאריך זה`);
    const day = new Date(`${payload.shift_date}T12:00:00Z`).getUTCDay(); const pattern = weeklyPatterns.find((row) => Number(row.weekday) === day);
    if (!pattern) throw httpError(409, 'היום אינו מוגדר בכרטיס העובד. יש לעדכן יום עבודה/חופשי/לפי צורך או לבחור שיבוץ ידני חריג');
    const fixedDayOff = pattern.day_type === 'day_off'; if (fixedDayOff && !(overrideDayOff||overrideRules)) throw httpError(409, 'זהו יום חופשי קבוע של העובד. ניתן לשמור רק כשיבוץ ידני חריג');
    if (pattern.day_type==='work' && (timeToMinutes(payload.start_time)<timeToMinutes(pattern.start_time)||timeToMinutes(payload.end_time)>timeToMinutes(pattern.end_time))) throw httpError(409, `השעות חורגות מהשעות הקבועות ${String(pattern.start_time).slice(0,5)}–${String(pattern.end_time).slice(0,5)}`);
  }
  return { employee, classItem };
}'''
regex_once('handlers/shifts.js',r"async function validateShift\(payload, id, overrideDayOff = false\) \{.*?\n\}



async function loadAutomaticScheduleData",new_validate+'\n\nasync function loadAutomaticScheduleData')
# snapshot fields.
replace_once('handlers/shifts.js',
'''const keys = ['id', 'shift_date', 'class_id', 'employee_id', 'start_time', 'end_time', 'shift_role', 'status', 'public_note', 'created_at', 'updated_at'];''',
'''const keys = ['id', 'shift_date', 'class_id', 'employee_id', 'start_time', 'end_time', 'shift_role', 'status', 'public_note', 'rule_override', 'rule_override_note', 'created_at', 'updated_at'];''')
# New shift payload override fields + validate call.
replace_once('handlers/shifts.js',
'''        public_note: String(body.public_note || '').trim() || null,
        created_by: caller.employee.id,
      };
      await validateShift(payload, null, Boolean(body.override_day_off));''',
'''        public_note: String(body.public_note || '').trim() || null,
        rule_override:Boolean(body.override_rules),
        rule_override_note:Boolean(body.override_rules) ? (String(body.override_reason||'חריגה ידנית').trim().slice(0,500)||'חריגה ידנית') : null,
        created_by: caller.employee.id,
      };
      await validateShift(payload, null, Boolean(body.override_day_off), Boolean(body.override_rules));''')
# Update payload + validate call.
replace_once('handlers/shifts.js',
'''        public_note: body.public_note === undefined ? current.public_note : (String(body.public_note || '').trim() || null),
      };
      await validateShift(payload, id, Boolean(body.override_day_off));''',
'''        public_note: body.public_note === undefined ? current.public_note : (String(body.public_note || '').trim() || null),
        rule_override:body.override_rules === undefined ? Boolean(current.rule_override) : Boolean(body.override_rules),
        rule_override_note:body.override_rules === undefined ? current.rule_override_note : (Boolean(body.override_rules)?(String(body.override_reason||'חריגה ידנית').trim().slice(0,500)||'חריגה ידנית'):null),
      };
      await validateShift(payload, id, Boolean(body.override_day_off), Boolean(payload.rule_override));''')
# Restore override fields in rollback/auto restore.
replace_once('handlers/shifts.js',
'''    public_note: shift.public_note ?? null,
    created_by: shift.created_by ?? null,''',
'''    public_note: shift.public_note ?? null,
    rule_override:Boolean(shift.rule_override),
    rule_override_note:shift.rule_override_note ?? null,
    created_by: shift.created_by ?? null,''')

# ---------------------------------------------------------------------------
# Week validation respects explicitly persisted overrides and flags missing day
# rules for normal shifts.
# ---------------------------------------------------------------------------
replace_once('lib/schedule.js',
'''    const forbidden = constraints.find((item) => item.employee_id === shift.employee_id && item.class_id === shift.class_id && item.constraint_type === 'forbidden' && (!item.valid_from || item.valid_from <= shift.shift_date) && (!item.valid_to || item.valid_to >= shift.shift_date));
    if (forbidden) errors.push({ code: 'forbidden_class', date: shift.shift_date, employee_id: shift.employee_id, class_id: shift.class_id, message: `לא ניתן לשבץ את ${employee?.full_name || 'העובד'} בכיתת ${classItem?.name || ''}` });
    if (employee?.job_title === 'גננת' && employee.primary_class_id && employee.primary_class_id !== shift.class_id) {
      errors.push({ code:'teacher_fixed_class', date:shift.shift_date, employee_id:shift.employee_id, class_id:shift.class_id, message:`${employee.full_name}: גננת יכולה להשתבץ רק בכיתה הקבועה שלה` });
    }

    const weekday = weekdayOf(shift.shift_date);
    const pattern = (patternsByEmployee.get(shift.employee_id) || []).find((row) => Number(row.weekday) === weekday);
    if (pattern?.day_type === 'day_off') {
      errors.push({ code: 'fixed_day_off', date: shift.shift_date, employee_id: shift.employee_id, class_id: shift.class_id, message: `${employee?.full_name || 'העובד'} משובץ ביום חופשי קבוע` });
    } else if (pattern?.day_type === 'work' && (timeToMinutes(shift.start_time) < timeToMinutes(pattern.start_time) || timeToMinutes(shift.end_time) > timeToMinutes(pattern.end_time))) {
      warnings.push({ code: 'outside_fixed_hours', date: shift.shift_date, employee_id: shift.employee_id, class_id: shift.class_id, message: `${employee?.full_name || 'העובד'} שובץ מחוץ לשעות הקבועות ${String(pattern.start_time).slice(0,5)}–${String(pattern.end_time).slice(0,5)}` });
    } else if (pattern?.day_type === 'avoid') {
      warnings.push({ code:'avoid_day', date:shift.shift_date, employee_id:shift.employee_id, class_id:shift.class_id, message:`${employee?.full_name || 'העובד'} שובץ ביום שסומן "עדיף להימנע"` });
    }''',
'''    const manualOverride=Boolean(shift.rule_override);
    if (!manualOverride) {
      const forbidden = constraints.find((item) => item.employee_id === shift.employee_id && item.class_id === shift.class_id && item.constraint_type === 'forbidden' && (!item.valid_from || item.valid_from <= shift.shift_date) && (!item.valid_to || item.valid_to >= shift.shift_date));
      if (forbidden) errors.push({ code: 'forbidden_class', date: shift.shift_date, employee_id: shift.employee_id, class_id: shift.class_id, message: `לא ניתן לשבץ את ${employee?.full_name || 'העובד'} בכיתת ${classItem?.name || ''}` });
      if (employee?.job_title === 'גננת' && employee.primary_class_id && employee.primary_class_id !== shift.class_id) errors.push({ code:'teacher_fixed_class', date:shift.shift_date, employee_id:shift.employee_id, class_id:shift.class_id, message:`${employee.full_name}: גננת יכולה להשתבץ רק בכיתה הקבועה שלה` });
      const weekday = weekdayOf(shift.shift_date); const pattern = (patternsByEmployee.get(shift.employee_id) || []).find((row) => Number(row.weekday) === weekday);
      if (!pattern) errors.push({ code:'missing_day_rule', date:shift.shift_date, employee_id:shift.employee_id, class_id:shift.class_id, message:`${employee?.full_name||'העובד'}: היום אינו מוגדר בכרטיס העובד` });
      else if (pattern.day_type === 'day_off') errors.push({ code: 'fixed_day_off', date: shift.shift_date, employee_id: shift.employee_id, class_id: shift.class_id, message: `${employee?.full_name || 'העובד'} משובץ ביום חופשי קבוע` });
      else if (pattern.day_type === 'work' && (timeToMinutes(shift.start_time) < timeToMinutes(pattern.start_time) || timeToMinutes(shift.end_time) > timeToMinutes(pattern.end_time))) warnings.push({ code: 'outside_fixed_hours', date: shift.shift_date, employee_id: shift.employee_id, class_id: shift.class_id, message: `${employee?.full_name || 'העובד'} שובץ מחוץ לשעות הקבועות ${String(pattern.start_time).slice(0,5)}–${String(pattern.end_time).slice(0,5)}` });
    } else warnings.push({ code:'manual_rule_override',date:shift.shift_date,employee_id:shift.employee_id,class_id:shift.class_id,message:`${employee?.full_name||'העובד'}: שיבוץ ידני חריג${shift.rule_override_note?` — ${shift.rule_override_note}`:''}` });''')
# Maximum weekly hours can only be warning if manager explicitly overrode at least one shift.
replace_once('lib/schedule.js',
'''      errors.push({ code: 'max_weekly_hours', employee_id: employee.id, message: `${employee.full_name}: שובץ ${actual} שעות ועבר את המקסימום השבועי ${maxHours}` });''',
'''      const hasOverride=employeeShifts.some((shift)=>shift.rule_override); const item={ code: 'max_weekly_hours', employee_id: employee.id, message: `${employee.full_name}: שובץ ${actual} שעות ועבר את המקסימום השבועי ${maxHours}` }; (hasOverride?warnings:errors).push(item);''')

# ---------------------------------------------------------------------------
# Clean schema and production migration 0.21.
# ---------------------------------------------------------------------------
schema=read('supabase/schema.sql')
schema=schema.replace('גרסה 0.20.0 (סכמת נתונים 0.20.0)','גרסה 0.21.0 (סכמת נתונים 0.21.0)',1)
schema=schema.replace("values (1, '0.20.0', '0.20.0')","values (1, '0.21.0', '0.21.0')",1)
schema=schema.replace("day_type text not null check (day_type in ('work','day_off','as_needed','avoid'))","day_type text not null check (day_type in ('work','day_off','as_needed'))",1)
schema=schema.replace("(day_type in ('work','avoid') and start_time is not null and end_time is not null and end_time > start_time)","(day_type = 'work' and start_time is not null and end_time is not null and end_time > start_time)",1)
schema=schema.replace("check (day_type in ('work','day_off','as_needed','avoid'));","check (day_type in ('work','day_off','as_needed'));",1)
schema=schema.replace("  public_note text,\n  created_by uuid references public.hadas_employees(id) on delete set null,","  public_note text,\n  rule_override boolean not null default false,\n  rule_override_note text,\n  created_by uuid references public.hadas_employees(id) on delete set null,",1)
write('supabase/schema.sql',schema)

migration=r'''-- מערכת ניהול שיבוצים מעון הדס — גרסה 0.21.0
-- יישור כללי זמינות, חריגה ידנית מפורשת וניקוי מצב משימות ישן. ללא מחיקת שיבוצים או עובדים.

alter table public.hadas_shifts add column if not exists rule_override boolean not null default false;
alter table public.hadas_shifts add column if not exists rule_override_note text;

-- `avoid` הישן מתאחד עם "לפי צורך"; אין יותר מצב רביעי מבלבל.
update public.hadas_employee_weekly_patterns set day_type='as_needed',start_time=null,end_time=null where day_type='avoid';

-- יום שלא הוגדר בעבר נחשב מעתה יום חופשי בטוח. כך אין זמינות משתמעת.
insert into public.hadas_employee_weekly_patterns(employee_id,weekday,day_type,start_time,end_time)
select e.id,d.weekday,'day_off',null,null
from public.hadas_employees e cross join generate_series(0,5) as d(weekday)
where e.active and e.is_schedulable and e.assignment_mode<>'no_schedule'
on conflict (employee_id,weekday) do nothing;

alter table public.hadas_employee_weekly_patterns drop constraint if exists hadas_employee_weekly_patterns_day_type_check;
alter table public.hadas_employee_weekly_patterns add constraint hadas_employee_weekly_patterns_day_type_check check (day_type in ('work','day_off','as_needed'));
alter table public.hadas_employee_weekly_patterns drop constraint if exists hadas_employee_weekly_patterns_times_check;
alter table public.hadas_employee_weekly_patterns add constraint hadas_employee_weekly_patterns_times_check check (
  (day_type in ('day_off','as_needed') and start_time is null and end_time is null)
  or (day_type='work' and start_time is not null and end_time is not null and end_time>start_time)
);

-- שיוכים של משימות שכבר הוסרו אינם אמורים להדליק badge.
delete from public.hadas_task_assignees a using public.hadas_tasks t where a.task_id=t.id and t.active=false;
update public.hadas_notifications n set action_required=false,read_at=coalesce(read_at,now())
where n.entity_type='task' and exists(select 1 from public.hadas_tasks t where t.id::text=n.entity_id and t.active=false);

insert into public.hadas_app_meta(id,schema_version,app_version,updated_at)
values(1,'0.21.0','0.21.0',now())
on conflict(id) do update set schema_version=excluded.schema_version,app_version=excluded.app_version,updated_at=now();
'''
write('supabase/update-v0.21.0.sql',migration)

# ---------------------------------------------------------------------------
# CSS: denser desktop table, no mobile overflow, practical picker/feedback.
# ---------------------------------------------------------------------------
css=r'''

/* ========================================================================== 
   גרסה 0.21.0 — שיבוץ צפוף, בחירת עובדים ומשובים
   ========================================================================== */
.schedule-table{min-width:930px;table-layout:fixed}
.schedule-table thead th{min-width:0;width:13.7%;padding:7px 6px}
.schedule-table .class-name{min-width:80px;width:82px;padding:8px 6px}
.schedule-table td{padding:6px}
.schedule-cell{min-height:122px}
.shift-item{padding:7px 8px;margin-bottom:5px;border-radius:11px}
.shift-main strong{font-size:.86rem;line-height:1.2}.shift-main small{font-size:.72rem;line-height:1.25}.shift-time{font-size:.82rem}
.shift-actions{gap:4px;margin-top:5px}.compact-shift-action{min-height:30px!important;padding:4px 7px!important;font-size:.7rem!important;border-radius:9px!important}.delete-shift{width:29px!important;height:29px!important}
.schedule-issues-panel{padding:11px!important}.schedule-issue-card{padding:10px!important;gap:9px!important}.schedule-issue-card .issue-copy p{margin:3px 0;font-size:.82rem}.schedule-issue-card .issue-actions button{min-height:34px;padding:5px 9px;font-size:.75rem}
.shift-employee-options{max-height:42vh;overflow:auto;overscroll-behavior:contain}.matching-rejected-details{margin-top:10px}.rejected-worker-list{display:grid;gap:7px;padding-top:8px}.rejected-worker-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px;border:1px solid #ead5d5;border-radius:12px;background:#fffafa}.rejected-worker-row>div{min-width:0}.rejected-worker-row strong,.rejected-worker-row small,.rejected-worker-row em{display:block}.rejected-worker-row small{color:var(--muted);font-size:.74rem}.rejected-worker-row em{color:#93484f;font-size:.73rem;font-style:normal}.rejected-worker-row button{flex:0 0 auto;border:1px solid #e5babe;background:#fff;color:#9a4149;border-radius:9px;padding:6px 8px;font-weight:850;font-size:.72rem}
.feedback-manager-toolbar{display:flex;gap:10px;align-items:center;justify-content:space-between;margin:12px 0}.feedback-search{position:relative;min-width:min(330px,100%);flex:1}.feedback-search>span{position:absolute;right:12px;top:50%;transform:translateY(-50%);z-index:1}.feedback-search input{padding-right:34px}.feedback-manager-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:10px 0}.feedback-manager-summary span{background:var(--surface-soft);border:1px solid var(--border);padding:9px;border-radius:12px;text-align:center;font-size:.75rem}.feedback-manager-summary strong{display:block;font-size:1.2rem}.feedback-list.manager-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.feedback-list.manager-list .feedback-card{margin:0}
@media(max-width:900px){.schedule-table{min-width:850px}.feedback-list.manager-list{grid-template-columns:1fr}}
@media(max-width:760px){
  .schedule-wrap{max-width:100%;overflow-x:hidden}.schedule-wrap.mode-week .schedule-table{display:none}
  .mobile-week-day,.mobile-week-class,.day-class-card{max-width:100%;min-width:0}.mobile-week-class{padding:10px}.mobile-week-class-shifts{display:grid;gap:5px}.shift-card{margin:0!important;padding:8px!important}.shift-actions{display:grid;grid-template-columns:1fr 1fr 34px;width:100%;gap:5px}.compact-shift-action{width:100%;min-height:38px!important}.delete-shift{width:34px!important;height:38px!important}
  .shift-employee-picker{min-width:0}.shift-employee-options{max-height:38vh}.shift-employee-option{grid-template-columns:36px minmax(0,1fr) auto!important;padding:9px!important}.employee-picker-search{position:sticky;top:0;z-index:3;background:#fff;padding-bottom:6px}.rejected-worker-row{align-items:stretch;flex-direction:column}.rejected-worker-row button{width:100%;min-height:40px}
  .feedback-manager-toolbar{align-items:stretch;flex-direction:column}.feedback-manager-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.feedback-list.manager-list{grid-template-columns:1fr}
  #scheduleWarnings.hidden{display:none!important}.schedule-issues-panel header{align-items:stretch;flex-direction:column}.schedule-issue-card{grid-template-columns:30px minmax(0,1fr)!important}.schedule-issue-card .issue-actions{grid-column:1/-1;display:flex;flex-wrap:wrap}.schedule-issue-card .issue-actions button{flex:1}
}
'''
s=read('styles.css')
if 'גרסה 0.21.0 — שיבוץ צפוף' in s: raise SystemExit('CSS v0.21 already present')
write('styles.css',s.rstrip()+css+'\n')

# ---------------------------------------------------------------------------
# Tests: historical 0.20 assertions remain historical; add 0.21 regression set.
# ---------------------------------------------------------------------------
v020=read('tests/v020.test.js')
v020=v020.replace("  assert.equal(JSON.parse(read('package.json')).version,'0.20.0');\n  assert.match(read('handlers/health.js'),/schema_version === '0\\.20\\.0'/);\n  assert.match(read('health.js'),/update-v0\\.20\\.0\\.sql/);\n  assert.match(read('supabase/schema.sql'),/'0\\.20\\.0'/);","  assert.match(read('supabase/update-v0.20.0.sql'),/'0\\.20\\.0'/);")
v020=v020.replace("  const schema=read('supabase/schema.sql');\n  assert.match(schema,/day_type in \\('day_off','as_needed'\\) and start_time is null and end_time is null/);\n  assert.match(schema,/day_type in \\('work','avoid'\\) and start_time is not null/);\n  assert.doesNotMatch(schema,/day_type in \\('work','as_needed','avoid'\\) and start_time is not null/);","  const schema=read('supabase/update-v0.20.0.sql');\n  assert.match(schema,/day_type in \\('day_off','as_needed'\\) and start_time is null and end_time is null/);")
write('tests/v020.test.js',v020)
# Current exact version assertions in static/API/router.
for p in ['tests/static.test.js','tests/api.test.js','tests/router.test.js']:
    s=read(p).replace("'0.20.0'","'0.21.0'")
    s=s.replace('update-v0\\.20\\.0\\.sql','update-v0\\.21\\.0\\.sql').replace("/'0\\.20\\.0'/","/'0\\.21\\.0'/")
    write(p,s)

v021=r'''const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'); const path=require('node:path'); const root=path.resolve(__dirname,'..'); const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const { employeeAvailability, generateAutomaticSchedule }=require('../lib/auto-schedule');
const { rankCandidates }=require('../lib/matching');

test('0.21 metadata and migration are aligned',()=>{ assert.equal(JSON.parse(read('package.json')).version,'0.21.0'); assert.match(read('handlers/health.js'),/schema_version === '0\.21\.0'/); assert.match(read('supabase/update-v0.21.0.sql'),/values\(1,'0\.21\.0','0\.21\.0'/); });

test('employee day editor has exactly work, day off and as-needed semantics',()=>{ const app=read('app.js'); assert.match(app,/יום עבודה \(קבוע\)/); assert.match(app,/יום חופשי \(אסור לשבץ\)/); assert.match(app,/לפי צורך \(עדיפות נמוכה\)/); assert.doesNotMatch(app,/>לא קבוע</); assert.doesNotMatch(app,/>עדיף להימנע</); const handler=read('handlers/employees.js'); assert.match(handler,/\['work','day_off','as_needed'\]/); assert.match(handler,/seen\.size !== 6/); });

test('missing weekly pattern is unavailable and as-needed is a low-priority fallback',()=>{ const employee={id:'e',active:true,is_schedulable:true,assignment_mode:'substitute',default_start:'07:30',default_end:'15:30'}; const settings={opening_time:'07:30',closing_time:'15:30',friday_closing_time:'12:00'}; assert.equal(employeeAvailability({employee,date:'2026-08-31',patterns:[],requests:[],settings}),null); const need=employeeAvailability({employee,date:'2026-09-01',patterns:[{employee_id:'e',weekday:2,day_type:'as_needed'}],requests:[],settings}); assert.equal(need.source,'as_needed'); assert.ok(need.confidence<0); });

test('matching rejects an unconfigured day and keeps the reason visible',()=>{ const result=rankCandidates({employees:[{id:'e',full_name:'שרון',active:true,is_schedulable:true,assignment_mode:'substitute',job_title:'סייעת/ סייע',default_start:'07:30',default_end:'15:30'}],shifts:[],requests:[],constraints:[],patterns:[],operations:[],attendance:[],classes:[{id:'c',name:'סיני'}],settings:{opening_time:'07:30',closing_time:'15:30',required_staff:1,closing_required_staff:1,require_leader:false},date:'2026-08-31',classId:'c',start:'07:30',end:'12:00',neededRole:'staff'}); assert.equal(result.candidates.length,0); assert.match(result.rejected[0].reason,/אינו מוגדר/); assert.doesNotMatch(read('handlers/suggestions.js'),/rejected\.slice\(0, 20\)/); });

test('automatic scheduler never invents availability on a missing day',()=>{ const plan=generateAutomaticSchedule({weekStart:'2026-08-30',employees:[{id:'sharon',full_name:'שרון',active:true,is_schedulable:true,assignment_mode:'substitute',job_title:'סייעת/ סייע',default_start:'07:30',default_end:'15:30',max_weekly_hours:50}],classes:[{id:'c',name:'כיתה',active:true}],patterns:[{employee_id:'sharon',weekday:0,day_type:'as_needed'},{employee_id:'sharon',weekday:2,day_type:'as_needed'},{employee_id:'sharon',weekday:3,day_type:'as_needed'}],constraints:[],requests:[],settings:{opening_time:'07:30',closing_time:'15:30',friday_closing_time:'12:00',morning_required_staff:1,required_staff:1,closing_required_staff:1,closing_window_minutes:30,validation_slot_minutes:30,require_leader:false},existingShifts:[],previousShifts:[]}); assert.equal(plan.finalRows.some((row)=>row.employee_id==='sharon'&&row.shift_date==='2026-08-31'),false); });

test('manual scheduling override is explicit and persisted',()=>{ const html=read('index.html'),app=read('app.js'),handler=read('handlers/shifts.js'),schema=read('supabase/schema.sql'); assert.match(html,/name="override_rules"/); assert.match(app,/שיבוץ ידני חריג/); assert.match(handler,/rule_override:Boolean\(body\.override_rules\)/); assert.match(schema,/rule_override boolean not null default false/); assert.match(read('lib/schedule.js'),/manual_rule_override/); });

test('task badge ignores assignments belonging to inactive tasks',()=>{ const app=read('app.js'); assert.match(app,/function activeTaskAssignments/); assert.match(app,/activeIds\.has\(assignment\.task_id\)/); assert.equal((app.match(/activeTaskAssignments\(\)\.length/g)||[]).length>=2,true); });

test('schedule rows have fixed role order and PDF colors are teacher green lead purple',()=>{ const app=read('app.js'); assert.match(app,/teacher:0, lead:1, staff:2, replacement:3/); assert.match(app,/role === 'teacher'.*#e8f6ef/); assert.match(app,/role === 'lead'.*#f1ecfa/); assert.ok((app.match(/sortScheduleRows\(/g)||[]).length>=6); });

test('automatic scheduling chooses a whole week, not an arbitrary date',()=>{ const html=read('index.html'); assert.match(html,/<select id="autoScheduleWeek"/); assert.doesNotMatch(html,/id="autoScheduleWeek"[^>]*type="date"/); assert.match(read('app.js'),/function populateAutoScheduleWeeks/); });

test('absence availability shows fixed classroom and schedule checks stay click-to-open',()=>{ const app=read('app.js'); assert.match(app,/כיתה קבועה:/); assert.match(app,/if \(!state\.scheduleIssuesOpen\) \{ panel\.innerHTML=''; return; \}/); });

test('feedback manager has search, status filters and summary',()=>{ const html=read('index.html'),app=read('app.js'); assert.match(html,/id="feedbackSearch"/); assert.match(html,/id="feedbackStatusChips"/); assert.match(html,/id="feedbackManagerSummary"/); assert.match(app,/feedbackStatusFilter: 'open'/); });

test('employee PATCH avoids post-save five-query reload',()=>{ const handler=read('handlers/employees.js'); const patch=handler.slice(handler.indexOf("if (req.method === 'PATCH')"),handler.indexOf("if (req.method === 'DELETE')")); assert.match(patch,/\[employeeR,userR\] = await Promise\.all/); assert.doesNotMatch(patch,/employeeResult\(employeeId\)/); });

test('0.21 migration normalizes old avoid days, fills missing days and removes stale task badges',()=>{ const sql=read('supabase/update-v0.21.0.sql'); assert.match(sql,/set day_type='as_needed'/); assert.match(sql,/generate_series\(0,5\)/); assert.match(sql,/delete from public\.hadas_task_assignees/); assert.doesNotMatch(sql,/drop table/i); });

test('schedule and picker have dense responsive controls',()=>{ const css=read('styles.css'); assert.match(css,/schedule-table\{min-width:930px/); assert.match(css,/rejected-worker-row/); assert.match(css,/grid-template-columns:1fr 1fr 34px/); });
'''
write('tests/v021.test.js',v021)

# Documentation
write('VERSION.md','''# מערכת ניהול שיבוצים מעון הדס — גרסה 0.21.0\n\n## שיבוץ אמין יותר\n- ימי עובד הם כעת חד-משמעיים: יום עבודה קבוע, יום חופשי אסור לשיבוץ אוטומטי, או לפי צורך בעדיפות נמוכה.\n- יום שלא הוגדר אינו נחשב יותר לזמין. נתונים ישנים משלימים יום חסר כיום חופשי בטוח.\n- השיבוץ האוטומטי משתמש בכרטיס העובד כמקור אמת ולא ממציא זמינות.\n- בחירה ידנית יכולה לעקוף כלל רק כחריגה מפורשת, שמסומנת ונשמרת בשיבוץ.\n- בחירת השבוע לשיבוץ אוטומטי היא בחירת שבוע שלם וברורה.\n\n## מסך השיבוצים\n- סדר קבוע: גננת, מובילה, צוות, החלפה — בכל תצוגה ובייצוא.\n- ב-PDF גננת בירוק ומובילה בסגול.\n- טבלה צפופה יותר וכפתורי החלפה/עריכה קומפקטיים.\n- בדיקות התקינה נפתחות רק בלחיצה.\n- זמינות צוות מציגה גם כיתה קבועה ליד חופשה/היעדרות.\n- בחירת עובד מציגה גם את כל מי שנחסם, עם סיבה ברורה ואפשרות חריגה ידנית.\n\n## עובדים, משימות ומשובים\n- שמירת כרטיס עובד חוסכת טעינה חוזרת של חמש שאילתות ומחזירה את המידע שכבר נשמר.\n- badge משימות מתעלם ממשימות שהוסרו; נתוני שיוך ישנים מנוקים במיגרציה.\n- לינור מקבלת ניהול משובים עם חיפוש, סינון, מוני סטטוס וסדר טיפול ברור.\n''')
for p in ['README.md','QA-REPORT.md','DEPLOY-VERCEL.md']:
    if (ROOT/p).exists(): write(p,read(p).replace('0.20.0','0.21.0'))

print('v0.21.0 scheduling patch applied')
