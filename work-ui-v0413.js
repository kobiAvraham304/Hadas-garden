/* Request to work – supplemental UI; other request workflows remain unchanged. */
(() => {
  let daysSequence=0;
  let previousRequestType=null;
  const isOnBehalf=()=>isManager()&&!document.getElementById('requestRequesterField').classList.contains('hidden');
  function syncWorkSubmitLabel() {
    const button=document.querySelector('#requestForm button[value="default"]');
    const approved=document.querySelector('#v026PreApprovedField input[name="pre_approved"]')?.checked;
    if(button&&!button.disabled)button.textContent=selectedRequestType()==='work'&&isOnBehalf()&&approved?'אישור ושיבוץ בטיוטה':'שליחת הבקשה';
  }
  function renderWorkClassChoices(form,visible) {
    const field=document.getElementById('workRequestClassField');
    if(!field)return;
    field.classList.toggle('hidden',!visible);
    field.disabled=!visible;
    if(!visible)return;
    const worker=state.employees.find(row=>row.id===form.elements.requester_id.value);
    const choices=document.getElementById('workRequestClasses');
    if(!worker){choices.innerHTML='<p class="work-day-hint">תחילה בוחרים עובד/ת.</p>';field.dataset.employeeId='';return;}
    const classes=state.classes.filter(row=>row.active!==false);
    const previous=field.dataset.employeeId===worker.id?choices.querySelector('input:checked')?.value:null;
    const preferred=classes.find(row=>row.id===worker.primary_class_id)||classes[0];
    if(field.dataset.employeeId===worker.id&&choices.querySelector('input[name="requested_class_id"]'))return;
    choices.innerHTML=classes.map(row=>{
      const primary=row.id===worker.primary_class_id;
      return `<label class="work-class-choice"><input type="radio" name="requested_class_id" value="${escapeHtml(row.id)}" ${row.id===(previous||preferred?.id)?'checked':''} required/>
        <span class="work-class-card"><span class="work-class-marker">▦</span><strong>${escapeHtml(row.name)}</strong>
        <small>${primary?'✓ כיתה קבועה · מומלץ':'כיתה נוספת'}</small></span></label>`;
    }).join('');
    field.dataset.employeeId=worker.id;
  }
  function onFieldsChange(type,form) {
    const work=type==='work';
    const box=document.getElementById('workDayBox');
    const dates=form.querySelector('.request-date-panel');
    box?.classList.toggle('hidden',!work);
    dates?.classList.toggle('hidden',work);
    const onBehalf=work&&isOnBehalf();
    renderWorkClassChoices(form,onBehalf);
    if(onBehalf&&previousRequestType!=='work'){
      requestAnimationFrame(()=>{
        const checkbox=document.querySelector('#v026PreApprovedField input[name="pre_approved"]');
        if(checkbox&&!checkbox.disabled)checkbox.checked=true;
        syncWorkSubmitLabel();
      });
    }else requestAnimationFrame(syncWorkSubmitLabel);
    previousRequestType=type;
    if(!work){daysSequence++;return;}
    if(!form.elements.requested_start.value)form.elements.requested_start.value=trimTime(state.settings?.opening_time)||'07:30';
    if(!form.elements.requested_end.value)form.elements.requested_end.value=trimTime(state.settings?.closing_time)||'15:30';
    void loadWorkDays();
  }
  async function loadWorkDays() {
    const form=document.getElementById('requestForm');
    const select=document.getElementById('workDaySelect');
    const hint=document.getElementById('workDayHint');
    if(selectedRequestType()!=='work')return;
    const onBehalf=isOnBehalf();
    const target=onBehalf?form.elements.requester_id.value:null;
    const token=++daysSequence;
    if(onBehalf&&!target){
      select.innerHTML='<option value="">קודם בוחרים עובד/ת</option>';
      hint.textContent='יש לבחור עבור מי הבקשה.';
      form.elements.request_date.value='';
      return;
    }
    select.disabled=true;
    select.innerHTML='<option value="">בודק ימים פנויים…</option>';
    hint.textContent='בודק את השיבוצים ואת ימי החופש הקבועים';
    try {
      const r=await apiFetch('/api/requests',{method:'POST',body:{
        action:'work_days',...(target?{requester_id:target}:{})
      },timeout:14000});
      if(token!==daysSequence||selectedRequestType()!=='work')return;
      const dates=r.dates||[],old=form.elements.request_date.value;
      select.innerHTML=dates.length?'<option value="">בחירת יום חופשי</option>'+
        dates.map(date=>`<option value="${date}">${DAY_NAMES[parseDateValue(date).getDay()]} · ${formatDate(date)}</option>`).join(''):
        '<option value="">לא נמצאו ימים פנויים</option>';
      select.value=dates.includes(old)?old:dates[0]||'';
      form.elements.request_date.value=select.value;
      hint.textContent=dates.length?`${dates.length} ימים פנויים בשלושת החודשים הקרובים. נבדוק שוב לפני האישור.`:
        'אין ימים פנויים. אפשר לבדוק את ימי העבודה הקבועים בכרטיס העובד.';
    } catch(error) {
      if(token===daysSequence){
        select.innerHTML='<option value="">לא ניתן לבדוק זמינות</option>';
        form.elements.request_date.value='';
        hint.textContent=error.message||'ניסיון טעינה נוסף';
      }
    } finally {if(token===daysSequence)select.disabled=false;}
  }
  function validateSubmission(data) {
    const date=document.getElementById('workDaySelect').value;
    data.request_date=date;
    if(!date){showToast('יש לבחור יום חופשי פנוי','error');return false;}
    if(isOnBehalf()&&!state.classes.some(row=>row.id===data.requested_class_id&&row.active!==false)){
      showToast('יש לבחור כיתה עבור העובד/ת','error');return false;
    }
    if(!data.requested_start||!data.requested_end||data.requested_start>=data.requested_end){
      showToast('יש להזין שעת התחלה וסיום תקינות','error');return false;
    }
    return true;
  }
  function decorateCards() {
    for(const request of state.requests.filter(r=>r.request_type==='work')){
      const card=[...document.querySelectorAll('#requestsList [data-request-id]')]
        .find(node=>node.dataset.requestId===request.id);
      if(!card)continue;
      const heading=card.querySelector('.request-title');
      const banner=card.querySelector('.request-key-details');
      if(heading&&!heading.querySelector('.work-request-flag'))
        heading.querySelector('h3')?.insertAdjacentHTML('afterend','<span class="work-request-flag">✦ בקשה לעבוד</span>');
      if(banner&&!card.querySelector('.work-request-summary')){
        const approvedClass=request.application_snapshot?.class_id;
        const requestedClass=request.application_snapshot?.requested_class_id;
        const className=classById(approvedClass||requestedClass)?.name||'';
        banner.insertAdjacentHTML('afterend',`<div class="work-request-summary">
          <span>↗ <strong>בקשת משמרת ביום חופש</strong></span>
          <span>${timeHtml(request.requested_start,request.requested_end)}</span>
          ${className?`<span>${approvedClass?'שובץ בכיתת':'כיתה מבוקשת:'} ${escapeHtml(className)}</span>`:''}
        </div>`);
      }
      const approve=card.querySelector('button[data-action="approve"]');
      if(approve)approve.textContent='✓ בחירת כיתה ואישור';
    }
  }
  function openApproval(requestId) {
    const request=state.requests.find(row=>row.id===requestId);
    if(!request||request.status!=='pending'||request.request_type!=='work')return;
    const person=employeeById(request.requester_id)||{};
    const classes=state.classes.filter(row=>row.active!==false);
    const preferred=classes.find(row=>row.id===request.application_snapshot?.requested_class_id)||classes.find(row=>row.id===person.primary_class_id)||classes[0];
    if(!classes.length){showToast('אין כיתות פעילות לשיבוץ','error');return;}
    const choices=document.getElementById('workApprovalClasses');
    choices.innerHTML=classes.map(row=>{
      const primary=row.id===person.primary_class_id;
      return `<label class="work-class-choice"><input type="radio" name="class_id" value="${escapeHtml(row.id)}" ${row.id===preferred.id?'checked':''} required/>
      <span class="work-class-card"><span class="work-class-marker">▦</span><strong>${escapeHtml(row.name)}</strong>
      <small>${primary?'✓ כיתה קבועה – תעדוף כיתה קבועה':'כיתה אחרת'}</small></span></label>`;
    }).join('');
    const form=document.getElementById('workApprovalForm');
    form.elements.request_id.value=request.id;
    form.elements.approved_start.value=trimTime(request.requested_start)||'07:30';
    form.elements.approved_end.value=trimTime(request.requested_end)||'15:30';
    form.elements.manager_note.value='';
    document.getElementById('workApprovalSummary').textContent=
      `${person.full_name||'עובד/ת'} · ${formatDate(request.request_date)} · ${trimTime(request.requested_start)}–${trimTime(request.requested_end)}`;
    document.getElementById('workApprovalDialog').showModal();
  }
  function interceptApproval(event){
    const button=event.target.closest('button[data-action="approve"]');
    if(!button)return false;
    const request=state.requests.find(r=>r.id===button.dataset.id);
    if(request?.request_type!=='work')return false;
    openApproval(request.id);return true;
  }
  async function submit(event) {
    event.preventDefault();
    const form=event.currentTarget,button=form.querySelector('[type="submit"]');
    const data=formObject(form);
    if(!data.class_id||!data.approved_start||!data.approved_end||data.approved_start>=data.approved_end){
      showToast('יש לבחור כיתה ושעות שיבוץ תקינות','error');return;
    }
    setBusy(button,true,'מאשרת ומשבצת…');
    try {
      const result=await apiFetch('/api/requests',{method:'POST',body:{
        action:'approve_work',id:data.request_id,class_id:data.class_id,
        approved_start:data.approved_start,approved_end:data.approved_end,manager_note:data.manager_note,
      },timeout:22000});
      document.getElementById('workApprovalDialog').close();
      if(result.request)state.requests=state.requests.map(row=>row.id===result.request.id?result.request:row);
      renderRequests();renderNavBadges();
      showToast('הבקשה אושרה ונוצר שיבוץ בטיוטה','success');
      void refreshAll();
    } catch(error) {showToast(error.message,'error');}
    finally {setBusy(button,false);}
  }
  window.HadasWork={onFieldsChange,validateSubmission,decorateCards,interceptApproval};
  document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('workDaySelect')?.addEventListener('change',event=>{
      const date=event.target.value;
      const form=document.getElementById('requestForm');
      form.elements.request_date.value=date;
      if(date&&parseDateValue(date).getDay()===5){
        const friday=trimTime(state.settings.friday_closing_time);
        if(friday&&form.elements.requested_end.value>friday)form.elements.requested_end.value=friday;
      }
    });
    document.getElementById('workApprovalForm')?.addEventListener('submit',submit);
    document.getElementById('requestForm')?.addEventListener('change',event=>{
      if(event.target.name==='pre_approved')syncWorkSubmitLabel();
    });
  });
})();
