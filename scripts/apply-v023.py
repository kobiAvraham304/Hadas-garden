from pathlib import Path
import re, json

ROOT=Path('.')

def read(path): return (ROOT/path).read_text(encoding='utf-8')
def write(path,text): (ROOT/path).write_text(text,encoding='utf-8')
def rep(text,old,new,label,count=1):
    if old not in text: raise SystemExit(f'missing marker {label}')
    return text.replace(old,new,count)
def rex(text,pattern,new,label,count=1):
    out,n=re.subn(pattern,new,text,count=count,flags=re.S)
    if n!=count: raise SystemExit(f'regex marker {label}: {n}')
    return out

# ---------- versions ----------
for path in ['package.json','handlers/health.js','health.js','README.md','DEPLOY-VERCEL.md','QA-REPORT.md']:
    p=ROOT/path
    if p.exists():
        s=p.read_text(encoding='utf-8').replace('0.22.0','0.23.0').replace('update-v0.22.0.sql','update-v0.23.0.sql')
        p.write_text(s,encoding='utf-8')

# ---------- index.html ----------
s=read('index.html')
s=s.replace('styles.css?v=0220','styles.css?v=0230').replace('app.js?v=0220','app.js?v=0230')
s=rep(s,
'''          <button id="newRequestBtn" class="primary-btn"><span>＋</span> בקשה חדשה</button>''',
'''          <div class="request-heading-actions"><button id="newEmployeeRequestBtn" class="secondary-btn manager-only hidden"><span>＋</span> בקשה חדשה לעובד</button><button id="newRequestBtn" class="primary-btn"><span>＋</span> בקשה חדשה</button></div>''','request manager button')
s=rep(s,
'''      <div class="modal-heading"><div><p class="eyebrow">בקשה חדשה</p><h3>מה תרצו לבקש?</h3><p id="requestTypeHelp" class="muted">חופשה מתוכננת מראש למספר ימים.</p></div><button type="button" class="icon-btn close-dialog" aria-label="סגירה">×</button></div>
      <div class="request-step"><span>1</span><div><strong>בחירת סוג הבקשה</strong><small>כל סוג מציג רק את השדות שנחוצים לו.</small></div></div>''',
'''      <div class="modal-heading"><div><p class="eyebrow">בקשה חדשה</p><h3 id="requestDialogTitle">מה תרצו לבקש?</h3><p id="requestTypeHelp" class="muted">חופשה מתוכננת מראש למספר ימים.</p></div><button type="button" class="icon-btn close-dialog" aria-label="סגירה">×</button></div>
      <label id="requestRequesterField" class="request-on-behalf-field manager-only hidden"><span>הבקשה עבור</span><select name="requester_id"><option value="">בחירת עובד</option></select><small>הבקשה תתועד בכרטיס העובד ותסומן כהוזנה על ידי הנהלת המעון.</small></label>
      <input type="hidden" name="manager_apply_now" value="false" />
      <div class="request-step"><span>1</span><div><strong>בחירת סוג הבקשה</strong><small>כל סוג מציג רק את השדות שנחוצים לו.</small></div></div>''','request requester field')
s=rep(s,
'''        <label class="full-field">תפקיד בשיבוץ הזה<select name="shift_role"><option value="teacher">גננת/גנן — אחראי/ת כיתה</option><option value="lead">מוביל/ת כיתה — אחראי/ת כיתה</option><option value="staff" selected>צוות כיתה</option><option value="replacement">מילוי מקום / החלפה</option></select><small>הבחירה משפיעה על מנוע ההתאמה. זהו התפקיד באותו יום בלבד.</small></label>''',
'''        <input type="hidden" name="shift_role" value="staff" />''','remove manual shift role')
s=rep(s,
'''      <div class="modal-actions shift-modal-actions"><button id="deleteShiftFromDialogBtn" type="button" class="danger-btn hidden">מחיקת השיבוץ</button><span class="modal-action-spacer"></span><button type="button" class="ghost-btn close-dialog">ביטול</button><button class="primary-btn" value="default">שמירת השיבוץ</button></div>''',
'''      <div class="modal-actions shift-modal-actions"><button id="deleteShiftFromDialogBtn" type="button" class="danger-btn hidden">מחיקת השיבוץ</button><button id="addLeaveFromShiftBtn" type="button" class="secondary-btn manager-only hidden">☀ הוספת חופשה</button><span class="modal-action-spacer"></span><button type="button" class="ghost-btn close-dialog">ביטול</button><button class="primary-btn" value="default">שמירת השיבוץ</button></div>''','add leave from shift')
write('index.html',s)

# ---------- styles.css ----------
s=read('styles.css')
s += r'''

/* v0.23.0 — צפיפות לוח, תיקון stepper, שיחות בבקשות ותיקון שיבוץ אוטומטי */
.schedule-table{min-width:980px}
.schedule-table th,.schedule-table td{padding:6px}
.schedule-table thead th{min-width:140px}
.schedule-table .class-name{min-width:88px;width:88px}
.schedule-cell{min-height:136px;padding:5px}
.shift-item{padding:6px 7px;margin-bottom:5px;border-radius:10px;gap:3px}
.shift-main strong{font-size:.76rem;line-height:1.15}.shift-main small{font-size:.63rem}.shift-time{font-size:.72rem}
.cell-footer .cell-action{min-height:30px;padding:4px 6px;font-size:.69rem}
.request-heading-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.request-on-behalf-field{display:grid;gap:6px;padding:12px 14px;margin:0 0 14px;border:1px solid #dfe2ee;border-radius:14px;background:#f8f9fd}
.request-on-behalf-field span{font-weight:800}.request-on-behalf-field small{color:#73788b}
.request-conversation{margin-top:12px;padding-top:10px;border-top:1px solid #e6e8ef;display:grid;gap:8px}
.request-conversation-thread{display:grid;gap:7px;max-height:210px;overflow:auto;padding:2px}
.request-message{max-width:88%;padding:8px 10px;border-radius:12px;background:#f0f2f8;display:grid;gap:3px}
.request-message.mine{justify-self:start;background:#eef7f2}.request-message.manager{background:#f3effb}
.request-message small{font-size:.68rem;color:#777b8d}.request-message p{margin:0;white-space:pre-wrap;font-size:.78rem}
.request-reply-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px}.request-reply-row input{min-width:0}
.auto-issue-card.decision-fixing{border-color:#7b82da;box-shadow:0 0 0 2px rgba(123,130,218,.1)}
.auto-issue-correction{margin-top:10px;padding:10px;border-radius:12px;background:#f7f8ff;display:grid;gap:8px}
.auto-correction-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px;border:1px solid #e0e3ef;border-radius:10px;background:#fff}
.auto-correction-row button,.auto-correction-add{min-height:36px}.auto-correction-row small{display:block;color:#73788a}
.auto-issue-actions button[disabled]{opacity:.45;cursor:not-allowed}
.staffing-stepper-card{grid-template-columns:auto minmax(0,1fr);overflow:hidden;min-width:0}
.staffing-stepper-card .number-stepper{grid-column:1/-1;width:min(100%,220px);max-width:100%;justify-self:end;grid-template-columns:minmax(38px,1fr) 56px minmax(38px,1fr)}
.number-stepper{max-width:100%;min-width:0}.number-stepper button{width:100%;min-width:0}
.calendar-event.approved_leave,.agenda-event.approved_leave{background:#fff0f0;border-color:#efb4b4;color:#8d3030}
@media(max-width:820px){
 .schedule-table{min-width:820px}.schedule-table thead th{min-width:118px}.schedule-table .class-name{min-width:78px;width:78px}.schedule-cell{min-height:118px}.shift-item{padding:5px 6px}
 .request-heading-actions{width:100%}.request-heading-actions>*{flex:1 1 160px}
 .request-reply-row{grid-template-columns:1fr}.request-reply-row button{width:100%}
 .staffing-stepper-card .number-stepper{justify-self:stretch;width:100%}
}
'''
write('styles.css',s)

# ---------- app.js ----------
s=read('app.js')
s=s.replace('גרסה 0.22.0','גרסה 0.23.0',1)
s=rep(s,'  requests: [],','  requests: [],\n  requestMessages: [],','state request messages')
s=rep(s,'  autoScheduleSelectedDates: [],','  autoScheduleSelectedDates: [],\n  autoScheduleManualGenerated: [],','state auto manual')
s=rep(s,'      requests: data.requests,','      requests: data.requests,\n      requestMessages: data.requestMessages || [],','load request messages')
s=s.replace('function timeHtml(start, end) { return `<bdi class="time-value">${escapeHtml(trimTime(start) || \'—\')}${end ? `–${escapeHtml(trimTime(end))}` : \'\'}</bdi>`; }',
'''function timeHtml(start, end) { return `<bdi class="time-value">${escapeHtml(trimTime(start) || '—')}${end ? `-${escapeHtml(trimTime(end))}` : ''}</bdi>`; }''')

# Shift dialog: preserve preview hours and mark preview mode.
s=rep(s,
'''function openShiftDialog(shift = {}) {
  const form = $("#shiftForm"); form.reset();
  form.elements.id.value = shift.id || "";''',
'''function openShiftDialog(shift = {}) {
  const form = $("#shiftForm"); form.reset();
  const previewIndex = Number.isInteger(shift._autoPreviewIndex) ? shift._autoPreviewIndex : null;
  form.dataset.autoPreviewMode = shift._autoPreview ? 'true' : 'false';
  form.dataset.autoPreviewIndex = previewIndex === null ? '' : String(previewIndex);
  form.elements.id.value = shift._autoPreview ? "" : (shift.id || "");''','open shift preview mode')
s=rep(s,
'''  if (shift.id) {
    form.elements.start_time.value = trimTime(shift.start_time) || "07:30";
    form.elements.end_time.value = trimTime(shift.end_time) || closingTimeForDate(form.elements.shift_date.value);
    form.elements.end_time.max = closingTimeForDate(form.elements.shift_date.value);
  } else syncShiftHoursFromPattern();
  form.dataset.roleTouched = shift.id ? "true" : "false";''',
'''  if (shift.id || shift._autoPreview || (shift.start_time && shift.end_time)) {
    form.elements.start_time.value = trimTime(shift.start_time) || "07:30";
    form.elements.end_time.value = trimTime(shift.end_time) || closingTimeForDate(form.elements.shift_date.value);
    form.elements.end_time.max = closingTimeForDate(form.elements.shift_date.value);
  } else syncShiftHoursFromPattern();
  form.dataset.roleTouched = "false";''','preserve preview hours')
s=rep(s,
'''  const deleteButton=$('#deleteShiftFromDialogBtn'); if(deleteButton) deleteButton.classList.toggle('hidden',!shift.id);
  $("#shiftDialog").showModal(); queueShiftRecommendations();''',
'''  const deleteButton=$('#deleteShiftFromDialogBtn'); if(deleteButton) deleteButton.classList.toggle('hidden',!(shift.id || shift._autoPreview));
  const saveButton=form.querySelector('button[value="default"]'); if(saveButton) saveButton.textContent=shift._autoPreview?'שמירת התיקון בתצוגה':'שמירת השיבוץ';
  $("#shiftDialog").showModal(); queueShiftRecommendations();''','preview delete/save button')

# Save shift preview branch + always derive role.
s=rep(s,
'''async function saveShift(event) {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[value="default"]'); const data = formObject(form); data.override_day_off = data.override_day_off === 'true'; data.override_rules=data.override_rules==='true'; const wasPublished=isPublishedWeekDate(data.shift_date);''',
'''async function saveShift(event) {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button[value="default"]'); const data = formObject(form); data.override_day_off = data.override_day_off === 'true'; data.override_rules=data.override_rules==='true';
  const selectedEmployee=employeeById(data.employee_id); if(selectedEmployee) data.shift_role=suggestedShiftRoleForEmployee(selectedEmployee);
  if(form.dataset.autoPreviewMode==='true'){
    if(!data.employee_id)return showToast('יש לבחור עובד לתיקון','error');
    const index=form.dataset.autoPreviewIndex===''?null:Number(form.dataset.autoPreviewIndex);
    const row={shift_date:data.shift_date,class_id:data.class_id,employee_id:data.employee_id,start_time:data.start_time,end_time:data.end_time,shift_role:data.shift_role,status:'draft',public_note:data.public_note||null};
    if(index===null||!Number.isInteger(index))state.autoScheduleManualGenerated.push(row);else state.autoScheduleManualGenerated[index]=row;
    setBusy(button,true,'בודק תיקון…');
    try{await revalidateAutomaticPreview();$('#shiftDialog').close();showToast('התיקון נשמר בתצוגה המקדימה','success');}catch(error){showToast(error.message,'error');}finally{setBusy(button,false);}return;
  }
  const wasPublished=isPublishedWeekDate(data.shift_date);''','save preview branch')

# Delete preview row.
s=rep(s,
'''async function deleteShiftFromDialog() {
  const form=$('#shiftForm'); const id=form?.elements.id.value; if(!id)return;''',
'''async function deleteShiftFromDialog() {
  const form=$('#shiftForm');
  if(form?.dataset.autoPreviewMode==='true'){
    const index=Number(form.dataset.autoPreviewIndex); if(!Number.isInteger(index))return;
    if(!confirm('להסיר את השיבוץ המוצע מהתצוגה המקדימה?'))return;
    state.autoScheduleManualGenerated.splice(index,1);
    const button=$('#deleteShiftFromDialogBtn');setBusy(button,true,'מעדכן…');
    try{await revalidateAutomaticPreview();$('#shiftDialog').close();showToast('השיבוץ המוצע הוסר','success');}catch(error){showToast(error.message,'error');}finally{setBusy(button,false);}return;
  }
  const id=form?.elements.id.value; if(!id)return;''','delete preview')

# Picker: show rejected employees as visible rows too.
s=rep(s,
'''  const rejectedSummary = rejectedReasonsHtml(state.shiftPickerRejected);
  target.innerHTML = `${selectedFallback}${recommended.length ? `<div class="employee-option-group"><span>מומלצים (${recommended.length})</span>${recommended.map(card).join('')}</div>` : ''}${possible.length ? `<div class="employee-option-group"><span>אפשרויות נוספות שעברו בדיקות (${possible.length})</span>${possible.map(card).join('')}</div>` : ''}${!rows.length ? '<div class="empty-state compact">לא נמצאו עובדים זמינים. פתחו את ההסבר למטה כדי להבין מה חסם כל עובד.</div>' : ''}${rejectedSummary}`;''',
'''  const rejectedSummary = rejectedReasonsHtml(state.shiftPickerRejected);
  const blocked=state.shiftPickerRejected.filter((item)=>{const employee=employeeById(item.employee_id);const hay=`${item.full_name||''} ${employee?.job_title||''} ${item.reason||''}`.toLowerCase();return !query||hay.includes(query);});
  const blockedHtml=blocked.length?`<div class="employee-option-group blocked-employees"><span>כל העובדים שלא עברו בדיקה (${blocked.length})</span>${blocked.map((item)=>{const employee=employeeById(item.employee_id);return `<div class="rejected-worker-row"><div><strong>${escapeHtml(item.full_name||employee?.full_name||'עובד')}</strong><small>${escapeHtml(employee?.job_title||'')}</small><em>${escapeHtml(item.reason||'לא זמין כרגע')}</em></div>${isManager()?`<button type="button" data-manual-override="${item.employee_id}" data-override-reason="${escapeHtml(item.reason||'חריגה ידנית')}">בחירה כחריגה</button>`:''}</div>`;}).join('')}</div>`:'';
  target.innerHTML = `${selectedFallback}${recommended.length ? `<div class="employee-option-group"><span>מומלצים (${recommended.length})</span>${recommended.map(card).join('')}</div>` : ''}${possible.length ? `<div class="employee-option-group"><span>אפשרויות נוספות שעברו בדיקות (${possible.length})</span>${possible.map(card).join('')}</div>` : ''}${!rows.length&&!blocked.length ? '<div class="empty-state compact">לא נמצאו עובדים מתאימים.</div>' : ''}${blockedHtml}${rejectedSummary}`;''','picker blocked workers')

# Request manager controls/events.
s=rep(s,"  $('#newRequestBtn').addEventListener('click', openRequestDialog);",
'''  $('#newRequestBtn').addEventListener('click', () => openRequestDialog());
  $('#newEmployeeRequestBtn')?.addEventListener('click', () => openRequestDialog({onBehalf:true}));
  $('#requestForm [name="requester_id"]')?.addEventListener('change', () => { updateRequestShiftOptions(); renderFixedDayOffOptions(); updateRequestFields(); });''','request listeners')
s=rep(s,"  $('#deleteShiftFromDialogBtn').addEventListener('click', deleteShiftFromDialog);",
'''  $('#deleteShiftFromDialogBtn').addEventListener('click', deleteShiftFromDialog);
  $('#addLeaveFromShiftBtn')?.addEventListener('click', openLeaveFromShift);''','leave listener')

# Request open + helpers.
s=rep(s,
'''function profileDayOffPatterns() {
  const patterns = Array.isArray(state.profile?.weekly_patterns) ? state.profile.weekly_patterns : [];
  const result = patterns.filter((row)=>row.day_type==='day_off').map((row)=>Number(row.weekday)).filter((day)=>day>=0&&day<=5);
  if (!result.length && state.profile?.fixed_day_off !== null && state.profile?.fixed_day_off !== undefined) result.push(Number(state.profile.fixed_day_off));
  return [...new Set(result)].sort((a,b)=>a-b);
}''',
'''function requestTargetEmployee(){const form=$('#requestForm');const requested=form?.elements.requester_id?.value;return employeeById(requested)||state.profile;}
function profileDayOffPatterns() {
  const target=requestTargetEmployee();
  const patterns = Array.isArray(target?.weekly_patterns) ? target.weekly_patterns : [];
  const result = patterns.filter((row)=>row.day_type==='day_off').map((row)=>Number(row.weekday)).filter((day)=>day>=0&&day<=5);
  if (!result.length && target?.fixed_day_off !== null && target?.fixed_day_off !== undefined) result.push(Number(target.fixed_day_off));
  return [...new Set(result)].sort((a,b)=>a-b);
}''','request target days')
s=rep(s,
'''function openRequestDialog() {
  const form = $('#requestForm'); form.reset(); state.swapCandidateSearch=''; $('#swapCandidateSearch').value='';
  form.elements.request_date.value = dateISO(new Date()); form.elements.request_end_date.value = dateISO(new Date());
  $('input[name="request_type"][value="leave"]', form).checked = true; state.swapCandidates=[];
  renderFixedDayOffOptions(); updateRequestShiftOptions(); updateRequestFields(); $('#requestDialog').showModal();
}''',
'''function openRequestDialog(options={}) {
  const form = $('#requestForm'); form.reset(); state.swapCandidateSearch=''; $('#swapCandidateSearch').value='';
  const onBehalf=Boolean(options.onBehalf)&&isManager();
  const requesterField=$('#requestRequesterField'); requesterField?.classList.toggle('hidden',!onBehalf);
  if(form.elements.requester_id){form.elements.requester_id.required=onBehalf;form.elements.requester_id.innerHTML='<option value="">בחירת עובד</option>'+state.employees.filter((e)=>e.active).map((e)=>`<option value="${e.id}">${escapeHtml(e.full_name)} · ${escapeHtml(e.job_title||'')}</option>`).join('');form.elements.requester_id.value=options.employeeId||'';}
  form.elements.manager_apply_now.value=options.applyNow?'true':'false';
  form.elements.request_date.value = options.date||dateISO(new Date()); form.elements.request_end_date.value = options.endDate||options.date||dateISO(new Date());
  $('input[name="request_type"][value="leave"]', form).checked = true; state.swapCandidates=[];
  $('#requestDialogTitle').textContent=onBehalf?'בקשה חדשה עבור עובד':'מה תרצו לבקש?';
  renderFixedDayOffOptions(); updateRequestShiftOptions(); updateRequestFields(); $('#requestDialog').showModal();
}
function openLeaveFromShift(){const form=$('#shiftForm');const employeeId=form.elements.employee_id.value;if(!employeeId)return showToast('יש לבחור עובד לפני הוספת חופשה','error');$('#shiftDialog').close();openRequestDialog({onBehalf:true,employeeId,date:form.elements.shift_date.value,applyNow:true});}
''','open request behalf')
s=rep(s,
'''function updateRequestShiftOptions() {
  const mine=state.shifts.filter((shift)=>shift.employee_id===state.profile.id);
  $('#requestForm [name="shift_id"]').innerHTML=`<option value="">בחרו שיבוץ</option>${mine.map((shift)=>`<option value="${shift.id}">${formatDate(shift.shift_date)} · ${classById(shift.class_id)?.name||''} · ${trimTime(shift.start_time)}–${trimTime(shift.end_time)}</option>`).join('')}`;
}''',
'''function updateRequestShiftOptions() {
  const targetId=requestTargetEmployee()?.id||state.profile.id;
  const mine=state.shifts.filter((shift)=>shift.employee_id===targetId);
  $('#requestForm [name="shift_id"]').innerHTML=`<option value="">בחרו שיבוץ</option>${mine.map((shift)=>`<option value="${shift.id}">${formatDate(shift.shift_date)} · ${classById(shift.class_id)?.name||''} · ${trimTime(shift.start_time)}-${trimTime(shift.end_time)}</option>`).join('')}`;
}''','request shift target')
# save request: keep requester_id and manager flags; delete requester for normal self mode.
s=rep(s,
'''  event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button[value="default"]');const data=formObject(form);data.request_type=selectedRequestType();delete data.sick_certificate;''',
'''  event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button[value="default"]');const data=formObject(form);data.request_type=selectedRequestType();delete data.sick_certificate;
  const onBehalf=isManager()&&!$('#requestRequesterField').classList.contains('hidden'); if(!onBehalf)delete data.requester_id; data.apply_now=onBehalf&&String(data.manager_apply_now)==='true'; delete data.manager_apply_now;''','save request behalf')
# request cards identify request for conversation enrichment
s=s.replace('<article class="request-card ${request.request_type} ${request.status}">','<article class="request-card ${request.request_type} ${request.status}" data-request-id="${request.id}">')
# Rename base render and handler; append wrappers before daily section marker.
s=s.replace('function renderRequests(){','function renderRequestsBase(){',1)
s=s.replace('async function handleRequestClick(event){','async function handleRequestClickBase(event){',1)
insert_marker='function dailyOperationByShift(shiftId)'
if insert_marker not in s: raise SystemExit('missing daily marker')
request_extra=r'''
function requestConversationHtml(request){
  const messages=(state.requestMessages||[]).filter((m)=>m.request_id===request.id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  const thread=messages.length?messages.map((m)=>`<div class="request-message ${m.author_id===state.profile.id?'mine':''} ${m.author_is_manager?'manager':''}"><small>${escapeHtml(m.author_name||'עובד')} · ${formatDate(m.created_at,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</small><p>${escapeHtml(m.message||'')}</p></div>`).join(''):'<small class="muted">אין עדיין תגובות לבקשה.</small>';
  const canReply=isManager()||request.requester_id===state.profile.id||request.target_employee_id===state.profile.id;
  return `<div class="request-conversation"><strong>שיחה על הבקשה</strong><div class="request-conversation-thread">${thread}</div>${canReply?`<div class="request-reply-row"><input data-request-reply-input="${request.id}" maxlength="2000" placeholder="כתיבת תגובה…"/><button type="button" class="secondary-btn" data-action="comment" data-id="${request.id}">שליחה</button></div>`:''}</div>`;
}
function renderRequests(){renderRequestsBase();for(const request of state.requests){const card=document.querySelector(`[data-request-id="${request.id}"]`);if(card)card.insertAdjacentHTML('beforeend',requestConversationHtml(request));}}
async function handleRequestClick(event){
  const comment=event.target.closest('[data-action="comment"]');
  if(comment){const input=document.querySelector(`[data-request-reply-input="${comment.dataset.id}"]`);const message=input?.value.trim();if(!message)return showToast('יש לכתוב תגובה','error');setBusy(comment,true,'שולח…');try{await apiFetch('/api/requests',{method:'POST',body:{action:'comment',id:comment.dataset.id,message}});await refreshAll();showToast('התגובה נשלחה','success');}catch(error){showToast(error.message,'error');}finally{setBusy(comment,false);}return;}
  return handleRequestClickBase(event);
}

'''
s=s.replace(insert_marker,request_extra+insert_marker,1)

# Calendar read-only leave event management.
s=s.replace("  const canManage = isManager() || event.created_by === state.profile.id;","  const canManage = !event.read_only && (isManager() || event.created_by === state.profile.id);",1)
s=s.replace("event.visibility === 'all' ? 'כל העובדים' : event.visibility === 'managers' ? 'לינור ואילנית בלבד' : `כיתת ${classById(event.class_id)?.name || ''}`",
"event.source === 'approved_leave' ? 'חופשה מאושרת' : event.visibility === 'all' ? 'כל העובדים' : event.visibility === 'managers' ? 'לינור ואילנית בלבד' : `כיתת ${classById(event.class_id)?.name || ''}`",1)

# Auto schedule flow replacement.
auto_block=r'''function autoIssueCanApprove(item){return ['understaffed','missing_leader','short_nonfixed_shift'].includes(item?.code);}
function autoGeneratedRows(){return state.autoScheduleManualGenerated.length?state.autoScheduleManualGenerated:(state.autoSchedulePreview?.generated||[]);}
function autoRelatedRows(item){const rows=state.autoScheduleManualGenerated;return rows.map((row,index)=>({row,index})).filter(({row})=>{if(item.date&&row.shift_date!==item.date)return false;if(item.class_id&&row.class_id!==item.class_id)return false;if(item.employee_id&&row.employee_id!==item.employee_id&&item.code!=='understaffed'&&item.code!=='missing_leader')return false;return true;});}
function autoIssueCorrectionHtml(item){
  const related=autoRelatedRows(item);
  return `<div class="auto-issue-correction"><strong>תיקון הנקודה לפני החלה</strong>${related.length?related.map(({row,index})=>`<div class="auto-correction-row"><div><strong>${escapeHtml(employeeById(row.employee_id)?.full_name||'עובד')}</strong><small>${escapeHtml(classById(row.class_id)?.name||'')} · ${timeHtml(row.start_time,row.end_time)}</small></div><button type="button" class="secondary-btn" data-auto-edit-row="${index}">עריכה</button></div>`).join(''):'<small>אין שיבוץ מוצע שמקושר ישירות לנקודה. ניתן להוסיף עובד/ת לטווח הזה.</small>'}<button type="button" class="secondary-btn auto-correction-add" data-auto-add-row="true">＋ הוספת עובד לנקודה</button></div>`;
}
function autoIssueCardHtml(item) {
  const key=autoIssueKey(item); const decision=state.autoScheduleIssueDecisions.get(key)||''; const canApprove=autoIssueCanApprove(item);
  const className=classById(item.class_id)?.name || '';
  const time=item.start_time||item.start||item.time||'';const end=item.end_time||item.end||'';
  return `<article class="auto-issue-card ${decision?`decision-${decision}`:''}" data-auto-issue-key="${escapeHtml(key)}" data-auto-issue-date="${escapeHtml(item.date||'')}" data-auto-issue-class="${escapeHtml(item.class_id||'')}"><div class="auto-issue-main"><span>!</span><div><strong>${escapeHtml(item.message||'שגיאת תקינה')}</strong><small>${[item.date?formatDate(item.date):'',className,time?`${trimTime(time)}${end?`-${trimTime(end)}`:''}`:''].filter(Boolean).join(' · ')}</small></div></div>${autoIssuePresenceHtml(item)}${decision==='fixing'?autoIssueCorrectionHtml(item):''}<div class="auto-issue-actions"><button type="button" data-auto-issue-action="fix">${decision==='fixing'?'סגירת תיקון':'תיקון'}</button><button type="button" data-auto-issue-action="approve" class="approve" ${canApprove?'':'disabled title="נקודה זו חייבת תיקון ולא ניתנת לאישור כחריגה"'}>אישור חריגה</button><button type="button" data-auto-issue-action="reject" class="reject">דחייה</button></div>${decision&&decision!=='fixing'?`<small class="auto-issue-decision">${decision==='approved'?'אושר כחריגה':'סומן כלא מאושר — יש לתקן לפני החלה'}</small>`:''}</article>`;
}
function renderAutomaticSchedulePreview(preview) {
  state.autoSchedulePreview = preview;
  const metrics = preview.metrics || {}; const errors = preview.validation?.errors || [];
  const dates = autoPreviewDates(preview);
  const dayCards = dates.map((date) => {const iso=dateISO(date),rows=preview.finalRows.filter((row)=>row.shift_date===iso);const classBlocks=state.classes.filter((item)=>item.active).map((classItem)=>{const classRows=sortScheduleRows(rows.filter((row)=>row.class_id===classItem.id));return `<section><header><strong>${escapeHtml(classItem.name)}</strong><span>${classRows.length} עובדים</span></header>${classRows.length?classRows.map((row)=>autoPreviewShiftHtml(row,preview)).join(''):'<div class="auto-empty-class">אין שיבוץ</div>'}</section>`;}).join('');const dayErrors=errors.filter((item)=>item.date===iso).length;return `<details class="auto-preview-day ${dayErrors?'has-errors':''}"><summary><div><strong>${DAY_NAMES[date.getDay()]}</strong><small>${formatDate(date,{day:'2-digit',month:'2-digit'})}</small></div><span>${new Set(rows.map((row)=>row.employee_id)).size} עובדים${dayErrors?` · ${dayErrors} לתיקון`:''}</span><i>⌄</i></summary><div class="auto-preview-day-body">${classBlocks}</div></details>`;}).join('');
  const issueHtml=errors.length?`<section class="auto-issues"><header><div><strong>נקודות שדורשות החלטה</strong><small>„תיקון” פותח עריכה בתוך התצוגה. רק חוסר תקינה או משמרת קצרה ניתנים לאישור כחריגה.</small></div><span>${errors.length}</span></header>${errors.map(autoIssueCardHtml).join('')}</section>`:'<div class="notice success"><strong>לא נמצאו שגיאות חוסמות.</strong> ניתן להחיל את השיבוץ כטיוטה ולפרסם לאחר בדיקה.</div>';
  $('#autoScheduleSetup').classList.add('hidden');const target=$('#autoSchedulePreview');target.classList.remove('hidden');const start=parseDateValue(preview.weekStart);const rejected=[...state.autoScheduleIssueDecisions.values()].filter((v)=>v==='rejected').length;const approved=[...state.autoScheduleIssueDecisions.values()].filter((v)=>v==='approved').length;const fixing=[...state.autoScheduleIssueDecisions.values()].filter((v)=>v==='fixing').length;
  target.innerHTML=`<section class="auto-preview-hero"><div class="auto-quality-ring" style="--quality:${metrics.quality||0}"><strong>${metrics.quality||0}</strong><small>${autoQualityLabel(metrics.quality||0)}</small></div><div><p class="eyebrow">תצוגה מקדימה בלבד</p><h3>השיבוץ האוטומטי מוכן לבדיקה</h3><p>${(preview.selectedDates||[]).length===6?`שבוע ${formatDate(start)}-${formatDate(addDays(start,5))}`:`${(preview.selectedDates||[]).length} ימים שנבחרו`} · ${metrics.generatedCount||0} שיבוצים מוצעים. שום שינוי עדיין לא נשמר.</p></div></section><div class="auto-metrics"><article><strong>${metrics.coveragePercent||0}%</strong><span>כיסוי תקינה</span></article><article><strong>${metrics.leaderPercent||0}%</strong><span>כיסוי אחראי/ת כיתה</span></article><article><strong>${metrics.preferenceScore||0}%</strong><span>התאמה להעדפות</span></article><article class="${errors.length?'bad':'good'}"><strong>${errors.length}</strong><span>נקודות להחלטה</span></article></div>${issueHtml}<section class="auto-preview-schedule"><header><div><p class="eyebrow">השבוע המתוכנן</p><h4>${formatDate(start)} - ${formatDate(addDays(start,5))}</h4></div><span>${preview.mode==='fill'?'מילוי חוסרים':'בנייה מחדש'}</span></header>${dayCards}</section><div class="auto-preview-review-summary">${errors.length?`אושרו ${approved} חריגות · ${rejected} נדחו · ${fixing} בתיקון · ${errors.length-approved-rejected-fixing} טרם נבדקו`:'כל הבדיקות עברו'}</div><div class="modal-actions auto-preview-actions"><button type="button" class="ghost-btn" data-auto-action="back">שינוי אפשרויות</button><button type="button" class="secondary-btn" data-auto-action="recalculate">חישוב מחדש</button><button type="button" class="auto-schedule-btn" data-auto-action="apply">${errors.length?'החלת השיבוץ לאחר החלטה':'החלת השיבוץ כטיוטה'}</button></div>`;
}
async function calculateAutomaticSchedule(){const button=$('#calculateAutoScheduleBtn'),mode=$('#autoScheduleDialog input[name="auto_schedule_mode"]:checked')?.value||'rebuild',weekStart=autoSelectedWeekStart(),selectedDates=autoSelectedDates();if(!selectedDates.length){showToast('יש לבחור לפחות יום אחד לשיבוץ','error');return;}state.autoScheduleSelectedDates=selectedDates;state.autoScheduleIssueDecisions=new Map();state.autoScheduleManualGenerated=[];setBusy(button,true,'מחשב שיבוץ…');try{const result=await apiFetch('/api/shifts',{method:'POST',body:{action:'auto_preview',week_start:dateISO(weekStart),mode,selected_dates:selectedDates},timeout:25000});state.autoScheduleManualGenerated=(result.preview.generated||[]).map((row)=>({...row}));renderAutomaticSchedulePreview(result.preview);}catch(error){showToast(error.message,'error');}finally{setBusy(button,false);}}
async function revalidateAutomaticPreview(){const preview=state.autoSchedulePreview;if(!preview)return;const result=await apiFetch('/api/shifts',{method:'POST',body:{action:'auto_preview',week_start:preview.weekStart,mode:preview.mode,selected_dates:preview.selectedDates||state.autoScheduleSelectedDates,signature:preview.signature,manual_generated:state.autoScheduleManualGenerated},timeout:25000});const old=state.autoScheduleIssueDecisions;state.autoScheduleIssueDecisions=new Map();for(const item of result.preview.validation?.errors||[]){const prior=old.get(autoIssueKey(item));if(prior==='approved'&&autoIssueCanApprove(item))state.autoScheduleIssueDecisions.set(autoIssueKey(item),'approved');}renderAutomaticSchedulePreview(result.preview);}
async function applyAutomaticSchedule(){const preview=state.autoSchedulePreview;if(!preview)return false;const errors=preview.validation?.errors||[];const hard=errors.filter((item)=>!autoIssueCanApprove(item));if(hard.length){showToast(`יש ${hard.length} נקודות שחייבות תיקון לפני החלת השיבוץ.`,'error');return false;}const decisions=errors.map((item)=>state.autoScheduleIssueDecisions.get(autoIssueKey(item))||'');const rejected=decisions.filter((v)=>v==='rejected').length,undecided=decisions.filter((v)=>!v||v==='fixing').length;if(rejected){showToast(`יש ${rejected} נקודות שסומנו כלא מאושרות.`,'error');return false;}if(undecided){showToast(`יש ${undecided} נקודות שעדיין דורשות החלטה.`,'error');return false;}const button=$('#autoSchedulePreview [data-auto-action="apply"]');setBusy(button,true,'שומר טיוטה…');try{const result=await apiFetch('/api/shifts',{method:'POST',body:{action:'auto_apply',week_start:preview.weekStart,mode:preview.mode,selected_dates:preview.selectedDates||state.autoScheduleSelectedDates,signature:preview.signature,manual_generated:state.autoScheduleManualGenerated,allow_incomplete:errors.length>0},timeout:30000});$('#autoScheduleDialog').close();state.shiftSuggestionCache.clear();state.weekStart=startOfWeek(parseDateValue(preview.weekStart));await refreshScheduleWeek({force:true});showToast(`נשמרו ${result.count} שיבוצים אוטומטיים בטיוטה`,'success');if(state.publication?.published_at)showPostPublishChangePrompt({title:'נוצר שיבוץ חדש לשבוע שכבר פורסם',message:'השיבוץ האוטומטי נשמר בטיוטה. יש לפרסם כדי שהצוות יראה את השינוי.'});return true;}catch(error){if(error.status===409&&/השתנו/.test(error.message)){showToast(error.message,'error');await calculateAutomaticSchedule();}else showToast(error.message,'error');return false;}finally{setBusy(button,false);}}
function openAutoCorrectionShift(item,index=null){const row=index===null?null:state.autoScheduleManualGenerated[index];const start=trimTime(item.start_time||item.start||item.time||state.settings.opening_time||'07:30');const end=trimTime(item.end_time||item.end||closingTimeForDate(item.date));openShiftDialog(row?{...row,_autoPreview:true,_autoPreviewIndex:index}:{shift_date:item.date||state.autoScheduleSelectedDates[0],class_id:item.class_id||state.classes.find((c)=>c.active)?.id||'',employee_id:item.employee_id||'',start_time:start,end_time:end,_autoPreview:true});}
async function handleAutoSchedulePreviewClick(event){const action=event.target.closest('[data-auto-action]')?.dataset.autoAction;if(action==='back'){state.autoSchedulePreview=null;state.autoScheduleManualGenerated=[];state.autoScheduleIssueDecisions=new Map();$('#autoSchedulePreview').classList.add('hidden');$('#autoScheduleSetup').classList.remove('hidden');return;}if(action==='recalculate')return calculateAutomaticSchedule();if(action==='apply')return applyAutomaticSchedule();const issueCard=event.target.closest('[data-auto-issue-key]');if(!issueCard)return;const item=(state.autoSchedulePreview?.validation?.errors||[]).find((row)=>autoIssueKey(row)===issueCard.dataset.autoIssueKey);if(!item)return;const edit=event.target.closest('[data-auto-edit-row]');if(edit)return openAutoCorrectionShift(item,Number(edit.dataset.autoEditRow));if(event.target.closest('[data-auto-add-row]'))return openAutoCorrectionShift(item,null);const issueAction=event.target.closest('[data-auto-issue-action]')?.dataset.autoIssueAction;if(!issueAction)return;if(issueAction==='approve'){if(!autoIssueCanApprove(item))return showToast('נקודה זו חייבת תיקון ואינה ניתנת לאישור כחריגה','error');state.autoScheduleIssueDecisions.set(autoIssueKey(item),'approved');renderAutomaticSchedulePreview(state.autoSchedulePreview);return;}if(issueAction==='reject'){state.autoScheduleIssueDecisions.set(autoIssueKey(item),'rejected');renderAutomaticSchedulePreview(state.autoSchedulePreview);return;}if(issueAction==='fix'){const key=autoIssueKey(item);state.autoScheduleIssueDecisions.set(key,state.autoScheduleIssueDecisions.get(key)==='fixing'?'':'fixing');renderAutomaticSchedulePreview(state.autoSchedulePreview);}}
'''
s=rex(s,r'function autoIssueCardHtml\(item\) \{.*?\nasync function openCopyWeekDialog\(\)',auto_block+'\nasync function openCopyWeekDialog()','auto flow block')

# PDF density, LTR hyphen and absence colors.
s=s.replace('return Math.max(150, 34 + maxItems * 48);','return Math.max(118, 28 + maxItems * 40);')
s=s.replace('const absenceHeight = Math.max(82, 28 + maxAbsences * 26);','const absenceHeight = Math.max(76, 24 + maxAbsences * 24);')
s=s.replace('const cardY = y + 12 + itemIndex * 48;','const cardY = y + 8 + itemIndex * 40;')
s=s.replace('if (cardY + 42 > y + rowHeight) return;','if (cardY + 34 > y + rowHeight) return;')
s=s.replace('fillRoundedRect(ctx, cellLeft + 8, cardY, dayWidth - 16, 40, 9, palette.fill, palette.border);','fillRoundedRect(ctx, cellLeft + 7, cardY, dayWidth - 14, 34, 8, palette.fill, palette.border);')
s=s.replace('cardY + 14','cardY + 12').replace('cardY + 30','cardY + 25')
s=s.replace("isolateCanvasLtr(`${trimTime(shift.start_time)}–${trimTime(shift.end_time)}`)","isolateCanvasLtr(`${trimTime(shift.start_time)}-${trimTime(shift.end_time)}`)")
s=rep(s,
'''    items.forEach((item, itemIndex) => {
      const employee = employeeById(item.employee_id);
      drawCanvasText(ctx, `${employee?.full_name || item.employee_name || 'עובד'} · ${absenceLabel(item.absence_type)}`, cellRight - 12, y + 20 + itemIndex * 25, dayWidth - 24, { font: '700 13px Arial', color: '#735723' });
    });''',
'''    items.forEach((item, itemIndex) => {
      const employee = employeeById(item.employee_id); const worked=item.absence_type==='day_off_worked';
      const rowY=y+8+itemIndex*24; fillRoundedRect(ctx,cellLeft+7,rowY,dayWidth-14,20,7,worked?'#edf9f1':'#fff0f0',worked?'#add7bb':'#efb1b1');
      drawCanvasText(ctx, `${employee?.full_name || item.employee_name || 'עובד'} · ${absenceLabel(item.absence_type)}`, cellRight - 12, rowY + 10, dayWidth - 24, { font: '700 12px Arial', color: worked?'#2f754a':'#923b3b' });
    });''','pdf absence colors')
write('app.js',s)

# ---------- handlers/shifts.js ----------
s=read('handlers/shifts.js')
s=s.replace("const { validateWeek, timeToMinutes, closingTimeForDate } = require('../lib/schedule');","const { validateWeek, timeToMinutes, closingTimeForDate, requiredStaffAt, leaderRequiredAt } = require('../lib/schedule');")
# role is server-derived
s=rep(s,"  if (!employee?.active) throw httpError(409, 'העובד אינו פעיל');",
'''  if (!employee?.active) throw httpError(409, 'העובד אינו פעיל');
  const title=String(employee.job_title||''); payload.shift_role=/(גננת|גנן)/.test(title)?'teacher':(title==='סייעת מובילה'||employee.can_lead)?'lead':'staff';''','derive shift role server')
# manual plan helpers before recordAutomaticChanges
marker='async function recordAutomaticChanges(caller, weekStart, deletedRows, insertedRows) {'
if marker not in s: raise SystemExit('missing auto record marker')
helpers=r'''
function shortTime(value){return value?String(value).slice(0,5):'';}
function autoRole(employee){const title=String(employee?.job_title||'');return /(גננת|גנן)/.test(title)?'teacher':(title==='סייעת מובילה'||employee?.can_lead)?'lead':'staff';}
function autoPattern(patterns,employeeId,date){const weekday=new Date(`${date}T12:00:00Z`).getUTCDay();return patterns.find((row)=>row.employee_id===employeeId&&Number(row.weekday)===weekday);}
function autoAbsent(requests,employeeId,date){return requests.some((row)=>row.requester_id===employeeId&&['approved','applied'].includes(row.status)&&['leave','day_off','sick'].includes(row.request_type)&&row.request_date<=date&&date<=String(row.request_end_date||row.request_date));}
function sanitizeManualGenerated(rows,data,selectedDates,callerId){
  if(!Array.isArray(rows))return null;const dateSet=new Set(selectedDates),employees=new Map(data.employees.map((e)=>[e.id,e])),classes=new Set(data.classes.map((c)=>c.id));const result=[];
  for(const raw of rows){const employee=employees.get(String(raw.employee_id||''));const date=String(raw.shift_date||'');const classId=String(raw.class_id||'');const start=shortTime(raw.start_time),end=shortTime(raw.end_time);if(!employee||!employee.active||employee.is_schedulable===false||!dateSet.has(date)||!classes.has(classId)||!start||!end||timeToMinutes(end)<=timeToMinutes(start))throw httpError(400,'אחד מתיקוני השיבוץ האוטומטי אינו תקין');result.push({shift_date:date,class_id:classId,employee_id:employee.id,start_time:start,end_time:end,shift_role:autoRole(employee),status:'draft',public_note:String(raw.public_note||'').trim()||null,created_by:callerId});}
  return result;
}
function buildManualAutomaticPlan(base,data,{weekStart,mode,selectedDates,manualGenerated,callerId}){
  const generated=sanitizeManualGenerated(manualGenerated,data,selectedDates,callerId);if(!generated)return base;const selectedSet=new Set(selectedDates);const kept=mode==='fill'?data.existingShifts.map((r)=>({...r})):data.existingShifts.filter((r)=>!selectedSet.has(r.shift_date)).map((r)=>({...r}));const finalRows=[...kept,...generated];
  const validation=validateWeek({shifts:finalRows,classes:data.classes,employees:data.employees,settings:data.settings,constraints:data.constraints,weeklyPatterns:data.patterns,requests:data.requests,weekStart});
  validation.errors=validation.errors.filter((item)=>!item.date||selectedSet.has(item.date));validation.warnings=validation.warnings.filter((item)=>!item.date||selectedSet.has(item.date));
  for(const row of generated){const employee=data.employees.find((e)=>e.id===row.employee_id),pattern=autoPattern(data.patterns,row.employee_id,row.shift_date);if(!employee||pattern?.day_type!=='as_needed')continue;const open=shortTime(employee.default_start)||shortTime(data.settings.opening_time)||'07:30',close=shortTime(employee.default_end)||closingTimeForDate(data.settings,row.shift_date);if(shortTime(row.start_time)!==open||shortTime(row.end_time)!==close)validation.errors.push({code:'short_nonfixed_shift',date:row.shift_date,class_id:row.class_id,employee_id:row.employee_id,start_time:row.start_time,end_time:row.end_time,message:`${employee.full_name}: מוצעת משמרת קצרה ${row.start_time}-${row.end_time} ביום לפי צורך — נדרש אישור או תיקון`});}
  for(const date of selectedDates){for(const employee of data.employees.filter((e)=>e.active&&e.is_schedulable!==false&&e.assignment_mode!=='no_schedule')){const pattern=autoPattern(data.patterns,employee.id,date);if(pattern?.day_type!=='work'||autoAbsent(data.requests,employee.id,date))continue;if(!finalRows.some((row)=>row.employee_id===employee.id&&row.shift_date===date))validation.errors.push({code:'work_day_unscheduled',date,employee_id:employee.id,message:`${employee.full_name}: יום עבודה קבוע לא שובץ — יש לתקן לפני החלה`});}}
  const dedupe=(items)=>{const seen=new Set();return items.filter((item)=>{const key=[item.code,item.date||'',item.class_id||'',item.employee_id||'',item.start_time||item.time||'',item.message||''].join('|');if(seen.has(key))return false;seen.add(key);return true;});};validation.errors=dedupe(validation.errors);validation.warnings=dedupe(validation.warnings);
  return {...base,generated,finalRows,keptCount:kept.length,validation,metrics:{...(base.metrics||{}),generatedCount:generated.length,unresolvedErrors:validation.errors.length,warnings:validation.warnings.length}};
}

'''
s=s.replace(marker,helpers+marker,1)
# preview/apply use manual plan and base signature
s=rep(s,
'''      const data = await loadAutomaticScheduleData(weekStart);
      const plan = generateAutomaticSchedule({ ...data, weekStart, mode, selectedDates, createdBy: caller.employee.id });
      return send(res, 200, { ok: true, preview: publicAutomaticPreview(plan) });''',
'''      const data = await loadAutomaticScheduleData(weekStart);
      const basePlan = generateAutomaticSchedule({ ...data, weekStart, mode, selectedDates, createdBy: caller.employee.id });
      if(body.signature&&body.signature!==basePlan.signature)throw httpError(409,'נתוני העובדים או השבוע השתנו מאז התצוגה המקדימה. יש לחשב מחדש את השיבוץ.');
      const plan=buildManualAutomaticPlan(basePlan,data,{weekStart,mode,selectedDates,manualGenerated:body.manual_generated,callerId:caller.employee.id});
      plan.signature=basePlan.signature;
      return send(res, 200, { ok: true, preview: publicAutomaticPreview(plan) });''','auto preview manual')
s=rep(s,
'''      const data = await loadAutomaticScheduleData(weekStart);
      const plan = generateAutomaticSchedule({ ...data, weekStart, mode, selectedDates, createdBy: caller.employee.id });
      if (body.signature && body.signature !== plan.signature) throw httpError(409, 'נתוני העובדים או השבוע השתנו מאז התצוגה המקדימה. יש לחשב מחדש את השיבוץ.');
      const incompleteCodes = new Set(['understaffed','missing_leader']);''',
'''      const data = await loadAutomaticScheduleData(weekStart);
      const basePlan = generateAutomaticSchedule({ ...data, weekStart, mode, selectedDates, createdBy: caller.employee.id });
      if (body.signature && body.signature !== basePlan.signature) throw httpError(409, 'נתוני העובדים או השבוע השתנו מאז התצוגה המקדימה. יש לחשב מחדש את השיבוץ.');
      const plan=buildManualAutomaticPlan(basePlan,data,{weekStart,mode,selectedDates,manualGenerated:body.manual_generated,callerId:caller.employee.id});
      const incompleteCodes = new Set(['understaffed','missing_leader','short_nonfixed_shift']);''','auto apply manual')
s=s.replace("'השיבוץ האוטומטי זיהה הפרת כלל קשיח ולכן לא ניתן להחיל אותו. יש לתקן את הנתונים או לחשב מחדש.'","'נשארו נקודות שחייבות תיקון לפני החלת השיבוץ. פתחו את הנקודה ובצעו תיקון בתצוגה המקדימה.'")
write('handlers/shifts.js',s)

# ---------- handlers/requests.js ----------
s=read('handlers/requests.js')
# manager-aware swap candidates
s=s.replace("const candidates = await swapCandidates(String(body.request_date || ''), caller.employee.id);","const requesterId=isManager(caller)&&body.requester_id?String(body.requester_id):caller.employee.id;\n      const candidates = await swapCandidates(String(body.request_date || ''), requesterId);")
# create: determine requester/on behalf
s=rep(s,
'''      const type = String(body.request_type || '');
      if (!REQUEST_TYPES.has(type)) throw httpError(400,'סוג הבקשה אינו תקין');''',
'''      const type = String(body.request_type || '');
      if (!REQUEST_TYPES.has(type)) throw httpError(400,'סוג הבקשה אינו תקין');
      const requestedRequester=String(body.requester_id||''); const onBehalf=Boolean(requestedRequester&&requestedRequester!==caller.employee.id);
      if(onBehalf&&!isManager(caller))throw httpError(403,'רק הנהלת המעון יכולה להגיש בקשה עבור עובד אחר');
      const requesterId=onBehalf?requestedRequester:caller.employee.id;
      if(onBehalf){const target=assertDb(await db().from('hadas_employees').select('id,full_name,active').eq('id',requesterId).maybeSingle(),'העובד לא נמצא');if(!target?.active)throw httpError(409,'העובד אינו פעיל');}''','request on behalf setup')
s=s.replace('        requester_id:caller.employee.id,','        requester_id:requesterId,\n        created_by:caller.employee.id,\n        submitted_by_manager:onBehalf,',1)
s=s.replace("        status:'pending',","        status:onBehalf?'approved':'pending',\n        decided_by:onBehalf?caller.employee.id:null,\n        decided_at:onBehalf?new Date().toISOString():null,",1)
s=s.replace('if (!own || own.employee_id !== caller.employee.id)', 'if (!own || own.employee_id !== requesterId)')
s=s.replace('if (payload.target_employee_id === caller.employee.id)', 'if (payload.target_employee_id === requesterId)')
s=s.replace('await validateSwapTarget(payload.request_date,caller.employee.id,payload.target_employee_id);','await validateSwapTarget(payload.request_date,requesterId,payload.target_employee_id);')
s=s.replace('decodeCertificate(body,caller.employee.id)', 'decodeCertificate(body,requesterId)')
# notifications create block: inject on behalf before swap branch and adjust swap name
s=s.replace("      if (type === 'swap') {\n        await notifyEmployees([payload.target_employee_id],{",
'''      if(onBehalf){
        await notifyEmployees([requesterId],{type:'request',title:'נוספה עבורך בקשה במערכת',message:`${caller.employee.full_name} הזין/ה עבורך ${type==='leave'?'חופשה':type==='sick'?'מחלה':type==='day_off'?'יום חופשי':'בקשה'} (${requestRangeLabel(request)}).`,entityType:'request',entityId:request.id,actionRequired:false});
      }
      if (type === 'swap') {
        await notifyEmployees([payload.target_employee_id],{''',1)
s=s.replace('message:`${caller.employee.full_name} ביקש להחליף איתך', 'message:`${onBehalf?\'הנהלת המעון\':caller.employee.full_name} ביקש/ה להחליף איתך',1)
s=s.replace("      } else {\n        const manualNote", "      } else if(!onBehalf) {\n        const manualNote",1)
s=s.replace("await audit(caller.employee.id,'create','request',request.id,{ type });","await audit(caller.employee.id,'create','request',request.id,{ type,on_behalf:onBehalf,requester_id:requesterId });")
# manager direct leave apply when opened from shift; safe after create before return.
s=s.replace("      await emitEvent('requests');\n      return send(res,201,{ ok:true,request });",
'''      let finalRequest=request;
      if(onBehalf&&body.apply_now===true&&['leave','day_off'].includes(type)){
        const rpc=await db().rpc('hadas_apply_approved_request',{p_request_id:request.id,p_actor_id:caller.employee.id});
        if(rpc.error)throw httpError(409,rpc.error.message||'הבקשה נשמרה אך לא ניתן היה להזרים אותה לשיבוץ');
        finalRequest=await getRequest(request.id)||request;
      }
      await emitEvent('requests');
      return send(res,201,{ ok:true,request:finalRequest });''',1)
# Add comment action immediately after request lookup.
needle="    const request = await getRequest(body.id);\n    if (!request) throw httpError(404,'הבקשה לא נמצאה');\n"
comment_code=r'''    const request = await getRequest(body.id);
    if (!request) throw httpError(404,'הבקשה לא נמצאה');

    if(action==='comment'){
      const allowed=isManager(caller)||request.requester_id===caller.employee.id||request.target_employee_id===caller.employee.id;if(!allowed)throw httpError(403,'אין הרשאה להגיב לבקשה זו');
      const message=String(body.message||'').trim().slice(0,2000);if(!message)throw httpError(400,'יש לכתוב תגובה');
      const row=assertDb(await db().from('hadas_request_messages').insert({request_id:request.id,author_id:caller.employee.id,message}).select('*').single(),'לא ניתן לשמור את התגובה');
      const recipients=new Set();if(isManager(caller))recipients.add(request.requester_id);else{const managers=assertDb(await db().from('hadas_users').select('employee_id').in('role',['admin','scheduler']).eq('active',true),'לא ניתן לאתר הנהלה')||[];managers.forEach((m)=>recipients.add(m.employee_id));}recipients.delete(caller.employee.id);
      if(recipients.size)await notifyEmployees([...recipients],{type:'request',title:'תגובה חדשה לבקשה',message:`${caller.employee.full_name}: ${message.slice(0,120)}`,entityType:'request',entityId:request.id,actionRequired:true});
      await audit(caller.employee.id,'comment','request',request.id);await emitEvent('requests');return send(res,201,{ok:true,message:row});
    }
'''
s=rep(s,needle,comment_code,'request comment action')
write('handlers/requests.js',s)

# ---------- handlers/data.js ----------
s=read('handlers/data.js')
# add request messages query after requests
s=rep(s,"      db().from('hadas_requests').select('*').order('created_at', { ascending: false }).limit(500),",
"      db().from('hadas_requests').select('*').order('created_at', { ascending: false }).limit(500),\n      db().from('hadas_request_messages').select('*').order('created_at').limit(1500),",'data request messages query')
s=rep(s,
'''const [classesR, employeesR, usersR, privateR, constraintsR, weeklyPatternsR, settingsR, shiftsR, attendanceR, requestsR, ackR, announcementsR, recipientsR, readsR, tasksR, assigneesR, calendarR, todayShiftsR, publicationR, changesR, todayChangesR, dailyOperationsR, dailyShiftsR, dailyAttendanceR, notificationsR] = results;''',
'''const [classesR, employeesR, usersR, privateR, constraintsR, weeklyPatternsR, settingsR, shiftsR, attendanceR, requestsR, requestMessagesR, ackR, announcementsR, recipientsR, readsR, tasksR, assigneesR, calendarR, todayShiftsR, publicationR, changesR, todayChangesR, dailyOperationsR, dailyShiftsR, dailyAttendanceR, notificationsR] = results;''','data destructure')
s=rep(s,"    let requests = assertDb(requestsR, 'לא ניתן לטעון בקשות') || [];",
"    let requests = assertDb(requestsR, 'לא ניתן לטעון בקשות') || [];\n    let requestMessages = assertDb(requestMessagesR, 'לא ניתן לטעון תגובות לבקשות') || [];\n    const allRequestsForCalendar=[...requests];",'data messages assert')
# Remove fixed day off regular insertion blocks by replacing section from weekly patterns to before if nonmanager with no-op; then add worked day off after visibility filtering.
s=rex(s,r'''    for \(const pattern of weeklyPatterns\.filter\(\(row\) => row\.day_type === 'day_off'\)\) \{.*?    if \(!manager\) \{''',"    if (!manager) {",'remove regular fixed dayoff')
# after nonmanager block before classScheduleViewer absence filter: request messages filter and add worked day off + calendar synthetic.
needle="    if (classScheduleViewer) {\n      const visibleIds = new Set(employeeRows.filter((row) => row.primary_class_id === caller.employee.primary_class_id).map((row) => row.id));"
insert=r'''    const visibleRequestIds=new Set(requests.map((row)=>row.id));requestMessages=requestMessages.filter((row)=>visibleRequestIds.has(row.request_id));
    const visibleShiftPool=[...shifts,...todayShifts];
    for(const shift of visibleShiftPool){const pattern=(patternsByEmployee.get(shift.employee_id)||[]).find((row)=>Number(row.weekday)===new Date(`${shift.shift_date}T12:00:00Z`).getUTCDay());const employee=employeeRows.find((row)=>row.id===shift.employee_id);const fixedOff=pattern?pattern.day_type==='day_off':Number(employee?.fixed_day_off)===new Date(`${shift.shift_date}T12:00:00Z`).getUTCDay();if(fixedOff){const key=`${shift.employee_id}:${shift.shift_date}`;if(!absenceMap.has(key))absenceMap.set(key,{employee_id:shift.employee_id,absence_date:shift.shift_date,absence_type:'day_off_worked'});}}
    const calendarVisibleLeave=(employee)=>manager||fullScheduleViewer||(classScheduleViewer&&employee?.primary_class_id===caller.employee.primary_class_id)||employee?.id===caller.employee.id;
    for(const request of allRequestsForCalendar){if(!['approved','applied'].includes(request.status)||request.request_type!=='leave')continue;const employee=employeeRows.find((row)=>row.id===request.requester_id);if(!employee||!calendarVisibleLeave(employee))continue;const end=request.request_end_date||request.request_date;for(const date of dateRange(request.request_date,Math.floor((new Date(`${end}T12:00:00Z`)-new Date(`${request.request_date}T12:00:00Z`))/86400000)+1)){if(date<calRange.start||date>calRange.end)continue;calendar.push({id:`leave:${request.id}:${date}`,title:employee.id===caller.employee.id?'חופשה מאושרת':`חופשה · ${employee.full_name}`,description:'חופשה מאושרת במערכת הבקשות',event_type:'approved_leave',event_date:date,start_time:null,end_time:null,visibility:'leave_request',class_id:employee.primary_class_id,created_by:null,source:'approved_leave',request_id:request.id,employee_id:employee.id,read_only:true});}}
    calendar.sort((a,b)=>`${a.event_date}-${a.start_time||''}-${a.title||''}`.localeCompare(`${b.event_date}-${b.start_time||''}-${b.title||''}`,'he'));

    if (classScheduleViewer) {
      const visibleIds = new Set(employeeRows.filter((row) => row.primary_class_id === caller.employee.primary_class_id).map((row) => row.id));'''
s=rep(s,needle,insert,'data visibility extras')
s=rep(s,"      requests,\n      acknowledgements,","      requests,\n      requestMessages: requestMessages.map((row)=>({...row,author_name:employeeRows.find((e)=>e.id===row.author_id)?.full_name||'עובד',author_is_manager:userRows.some((u)=>u.employee_id===row.author_id&&['admin','scheduler'].includes(u.role))})),\n      acknowledgements,",'data return messages')
write('handlers/data.js',s)

# ---------- handlers/calendar.js ----------
s=read('handlers/calendar.js')
calendar_helper=r'''
function addDays(dateString,days){const d=new Date(`${dateString}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function canSeeLeave(caller,employee){if(isManager(caller))return true;const title=String(caller.employee?.job_title||'');if(/גנ(?:נ|ן)/.test(title)||['מנהלת מעון','אחות','מזכירה'].includes(title))return true;if(title==='סייעת מובילה')return employee?.primary_class_id===caller.employee.primary_class_id||employee?.id===caller.employee.id;return employee?.id===caller.employee.id;}
async function approvedLeaveEvents(caller,range){const [requestsR,employeesR]=await Promise.all([db().from('hadas_requests').select('id,requester_id,request_date,request_end_date,request_type,status').eq('request_type','leave').in('status',['approved','applied']).lte('request_date',range.end),db().from('hadas_employees').select('id,full_name,primary_class_id,job_title,active').eq('active',true)]);const requests=assertDb(requestsR,'לא ניתן לטעון חופשות')||[],employees=assertDb(employeesR,'לא ניתן לטעון עובדים')||[],map=new Map(employees.map((e)=>[e.id,e])),out=[];for(const request of requests){const employee=map.get(request.requester_id),end=request.request_end_date||request.request_date;if(!employee||!canSeeLeave(caller,employee)||end<range.start)continue;for(let date=request.request_date;date<=end;date=addDays(date,1)){if(date<range.start||date>range.end)continue;out.push({id:`leave:${request.id}:${date}`,title:employee.id===caller.employee.id?'חופשה מאושרת':`חופשה · ${employee.full_name}`,description:'חופשה מאושרת במערכת הבקשות',event_type:'approved_leave',event_date:date,start_time:null,end_time:null,visibility:'leave_request',class_id:employee.primary_class_id,created_by:null,source:'approved_leave',request_id:request.id,employee_id:employee.id,read_only:true});}}return out;}
'''
s=s.replace('\nfunction canSeeEvent(caller, event) {',calendar_helper+'\nfunction canSeeEvent(caller, event) {',1)
s=rep(s,
'''      let events = assertDb(await db().from('hadas_calendar_events').select('*').gte('event_date', range.start).lte('event_date', range.end).order('event_date').order('start_time'), 'לא ניתן לטעון לוח שנה') || [];
      events = events.filter((event) => canSeeEvent(caller, event));
      return send(res, 200, { ok: true, events, range });''',
'''      let events = assertDb(await db().from('hadas_calendar_events').select('*').gte('event_date', range.start).lte('event_date', range.end).order('event_date').order('start_time'), 'לא ניתן לטעון לוח שנה') || [];
      events = events.filter((event) => canSeeEvent(caller, event));
      events.push(...await approvedLeaveEvents(caller,range)); events.sort((a,b)=>`${a.event_date}-${a.start_time||''}-${a.title||''}`.localeCompare(`${b.event_date}-${b.start_time||''}-${b.title||''}`,'he'));
      return send(res, 200, { ok: true, events, range });''','calendar approved leave')
write('handlers/calendar.js',s)

# ---------- schema.sql ----------
s=read('supabase/schema.sql').replace('גרסה 0.22.0 (סכמת נתונים 0.22.0)','גרסה 0.23.0 (סכמת נתונים 0.23.0)',1).replace("values (1, '0.22.0', '0.22.0')","values (1, '0.23.0', '0.23.0')",1)
s=s.replace('  public.hadas_requests,\n  public.hadas_shifts,','  public.hadas_request_messages,\n  public.hadas_requests,\n  public.hadas_shifts,',1)
s=s.replace("  manager_note text,\n  decided_by uuid", "  manager_note text,\n  created_by uuid references public.hadas_employees(id) on delete set null,\n  submitted_by_manager boolean not null default false,\n  decided_by uuid",1)
# add messages table after requests table closing marker using index marker following requests.
marker="create index if not exists hadas_requests_requester_date_idx"
pos=s.find(marker)
if pos<0: raise SystemExit('request index marker missing')
msg_table=r'''create table if not exists public.hadas_request_messages (
  id bigserial primary key,
  request_id uuid not null references public.hadas_requests(id) on delete cascade,
  author_id uuid not null references public.hadas_employees(id) on delete restrict,
  message text not null check (char_length(message) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists hadas_request_messages_request_idx on public.hadas_request_messages(request_id,created_at);
create index if not exists hadas_request_messages_author_idx on public.hadas_request_messages(author_id);

'''
s=s[:pos]+msg_table+s[pos:]
s=s.replace("'hadas_requests','hadas_notifications'","'hadas_requests','hadas_request_messages','hadas_notifications'")
s=s.replace("'hadas_requests','hadas_notifications','hadas_schedule_acknowledgements'","'hadas_requests','hadas_request_messages','hadas_notifications','hadas_schedule_acknowledgements'")
s=s.replace("'hadas_daily_operations','hadas_requests',\n    'hadas_notifications'","'hadas_daily_operations','hadas_requests','hadas_request_messages',\n    'hadas_notifications'")
write('supabase/schema.sql',s)

migration=r'''-- מערכת ניהול שיבוצים מעון הדס — גרסה 0.23.0
-- בקשות בשם עובד, שיח דו-צדדי ותיעוד מנהלי. מיגרציה לא הרסנית.

alter table public.hadas_requests add column if not exists created_by uuid;
alter table public.hadas_requests add column if not exists submitted_by_manager boolean not null default false;
update public.hadas_requests set created_by=requester_id where created_by is null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='hadas_requests_created_by_fkey' and conrelid='public.hadas_requests'::regclass) then
    alter table public.hadas_requests add constraint hadas_requests_created_by_fkey foreign key(created_by) references public.hadas_employees(id) on delete set null;
  end if;
end $$;
create index if not exists hadas_requests_created_by_idx on public.hadas_requests(created_by);

create table if not exists public.hadas_request_messages (
  id bigserial primary key,
  request_id uuid not null references public.hadas_requests(id) on delete cascade,
  author_id uuid not null references public.hadas_employees(id) on delete restrict,
  message text not null check (char_length(message) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists hadas_request_messages_request_idx on public.hadas_request_messages(request_id,created_at);
create index if not exists hadas_request_messages_author_idx on public.hadas_request_messages(author_id);
alter table public.hadas_request_messages enable row level security;
revoke all on table public.hadas_request_messages from anon,authenticated;
grant all on table public.hadas_request_messages to service_role;
grant usage,select on sequence public.hadas_request_messages_id_seq to service_role;
drop policy if exists hadas_server_only_deny on public.hadas_request_messages;
create policy hadas_server_only_deny on public.hadas_request_messages for all to anon,authenticated using(false) with check(false);

insert into public.hadas_app_meta(id,schema_version,app_version,updated_at)
values(1,'0.23.0','0.23.0',now())
on conflict(id) do update set schema_version=excluded.schema_version,app_version=excluded.app_version,updated_at=now();
'''
write('supabase/update-v0.23.0.sql',migration)

# ---------- VERSION.md ----------
write('VERSION.md',r'''# מערכת ניהול שיבוצים מעון הדס — גרסה 0.23.0

## שיבוץ אוטומטי
- תיקון תקלה שמנעה החלה כאשר נקודות החלטה כללו כלל קשיח.
- כפתור „תיקון” פותח עריכת שיבוץ בתוך התצוגה המקדימה, בלי להחיל את השבוע לפני סיום הבדיקה.
- ניתן לערוך, להוסיף או להסיר שיבוץ מוצע ולבצע בדיקת תקינות מחדש לפני החלה.
- רק חוסר תקינה, חוסר אחראי/ת כיתה ומשמרת קצרה ביום לפי צורך ניתנים לאישור כחריגה; שאר הכללים מחייבים תיקון.

## שיבוצים / PDF
- השעות מוצגות LTR בפורמט 07:00-13:00.
- חופשה/מחלה/יום חופשי חד-פעמי באדום; הגעה ביום חופשי קבוע בירוק — גם במסך וגם ב-PDF.
- טבלת השיבוצים צפופה יותר כדי להציג יותר עובדים במסך.
- תפקיד השיבוץ נגזר מכרטיס העובד; אין בחירת תפקיד ידנית.
- רשימת העובדים בעריכת שיבוץ מציגה גם עובדים שנחסמו עם הסיבה.

## בקשות וחופשות
- לינור/אילנית יכולות ליצור בקשה עבור עובד.
- מתוך הוספת/עריכת שיבוץ ניתן להזין חופשה עתידית לעובד; היא מתועדת בבקשות ומשפיעה על השיבוץ האוטומטי.
- נוספה שיחה דו-צדדית על בקשה בין הנהלה לעובד עם עדכונים.
- חופשות מאושרות מופיעות אוטומטית בלוח השנה לפי הרשאות: עובד — שלו; מובילה — הכיתה שלה ושלה; גננת/אחראית שיבוצים/מנהלת — כולן.

## ממשק
- תיקון גלישת כפתורי מספר אנשי הצוות בהגדרות תקינה.
- שיפורי צפיפות והתאמה למסכי מחשב וסלולר.
''')

# ---------- tests ----------
test=r'''const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const root=path.resolve(__dirname,'..');const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');

test('0.23 metadata and migration align',()=>{assert.equal(JSON.parse(read('package.json')).version,'0.23.0');assert.match(read('handlers/health.js'),/0\.23\.0/);const sql=read('supabase/update-v0.23.0.sql');assert.match(sql,/hadas_request_messages/);assert.match(sql,/enable row level security/i);assert.match(sql,/revoke all.*anon,authenticated/i);assert.match(sql,/values\(1,'0\.23\.0','0\.23\.0'/);});
test('auto fix is preview editing rather than premature apply',()=>{const app=read('app.js'),shifts=read('handlers/shifts.js');assert.match(app,/decision-fixing/);assert.match(app,/revalidateAutomaticPreview/);assert.match(app,/manual_generated:state\.autoScheduleManualGenerated/);assert.doesNotMatch(app,/if\(issueAction==='fix'\)[\s\S]{0,300}applyAutomaticSchedule/);assert.match(shifts,/buildManualAutomaticPlan/);assert.match(shifts,/short_nonfixed_shift/);assert.match(shifts,/new Set\(\['understaffed','missing_leader','short_nonfixed_shift'\]\)/);});
test('request on behalf and conversation are server backed',()=>{const html=read('index.html'),app=read('app.js'),handler=read('handlers/requests.js'),schema=read('supabase/schema.sql');assert.match(html,/newEmployeeRequestBtn/);assert.match(html,/name="requester_id"/);assert.match(app,/requestConversationHtml/);assert.match(handler,/submitted_by_manager:onBehalf/);assert.match(handler,/action==='comment'/);assert.match(handler,/hadas_request_messages/);assert.match(schema,/submitted_by_manager boolean/);assert.match(schema,/create table if not exists public\.hadas_request_messages/);});
test('approved leave is derived into calendar with scoped visibility',()=>{const cal=read('handlers/calendar.js'),data=read('handlers/data.js');assert.match(cal,/approvedLeaveEvents/);assert.match(cal,/title==='סייעת מובילה'/);assert.match(cal,/source:'approved_leave'/);assert.match(data,/calendarVisibleLeave/);assert.match(data,/source:'approved_leave'/);});
test('shift role is derived from employee and not manually selected',()=>{const html=read('index.html'),app=read('app.js'),handler=read('handlers/shifts.js');assert.match(html,/type="hidden" name="shift_role"/);assert.doesNotMatch(html,/תפקיד בשיבוץ הזה/);assert.match(app,/data\.shift_role=suggestedShiftRoleForEmployee/);assert.match(handler,/payload\.shift_role=.*teacher/);});
test('schedule hours use LTR hyphen and PDF colors absence states',()=>{const app=read('app.js');assert.match(app,/time-value[^`]*\$\{end \? `-\$\{/);assert.match(app,/day_off_worked/);assert.match(app,/#edf9f1/);assert.match(app,/#fff0f0/);assert.match(app,/isolateCanvasLtr\(`\$\{trimTime\(shift\.start_time\)\}-\$\{trimTime\(shift\.end_time\)\}`\)/);});
test('schedule is denser and staffing steppers cannot escape cards',()=>{const css=read('styles.css');assert.match(css,/schedule-table\{min-width:980px/);assert.match(css,/schedule-cell\{min-height:136px/);assert.match(css,/staffing-stepper-card\{grid-template-columns:auto minmax\(0,1fr\);overflow:hidden/);assert.match(css,/number-stepper\{max-width:100%;min-width:0/);});
'''
write('tests/v023.test.js',test)

# Update old current-version assertions, keeping historical migrations intact.
for path in ['tests/api.test.js','tests/router.test.js','tests/static.test.js','tests/v021.test.js','tests/v022.test.js']:
    p=ROOT/path
    if p.exists():
        t=p.read_text(encoding='utf-8')
        # only current release metadata/health/cache assertions; historical migration file names remain.
        t=t.replace("version,'0.22.0'","version,'0.23.0'").replace("version, '0.22.0'","version, '0.23.0'")
        t=t.replace("schema_version === '0\\.22\\.0'","schema_version === '0\\.23\\.0'")
        t=t.replace("update-v0\\.22\\.0\\.sql","update-v0\\.23\\.0\\.sql")
        t=t.replace("/'0\\.22\\.0'/","/'0\\.23\\.0'/")
        t=t.replace("styles\\.css\\?v=0220","styles\\.css\\?v=0230").replace("app\\.js\\?v=0220","app\\.js\\?v=0230")
        p.write_text(t,encoding='utf-8')

print('v0.23 patch applied')
