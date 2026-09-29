/* מעון הדס — תיקוני בקשות ושיבוץ מאושר, גרסה 0.39.0 */
(() => {
  const VERSION='0.39.0';
  const currentMonth=()=>dateISO(new Date()).slice(0,7);
  if(!state.requestPeriodMonth)state.requestPeriodMonth=currentMonth();

  function monthBounds(month){
    const match=/^(\d{4})-(\d{2})$/.exec(String(month||''));
    if(!match)return null;
    const year=Number(match[1]),monthNumber=Number(match[2]);
    const last=new Date(year,monthNumber,0).getDate();
    return{start:`${match[1]}-${match[2]}-01`,end:`${match[1]}-${match[2]}-${String(last).padStart(2,'0')}`};
  }
  function requestInMonth(request){
    const bounds=monthBounds(state.requestPeriodMonth);
    if(!bounds)return true;
    const start=String(request.request_date||'');
    const end=String(request.request_end_date||request.request_date||'');
    return Boolean(start)&&start<=bounds.end&&end>=bounds.start;
  }
  function monthLabel(){
    const match=/^(\d{4})-(\d{2})$/.exec(String(state.requestPeriodMonth||''));
    if(!match)return '';
    return new Intl.DateTimeFormat('he-IL',{month:'long',year:'numeric',timeZone:'UTC'})
      .format(new Date(Date.UTC(Number(match[1]),Number(match[2])-1,1)));
  }
  function changeMonth(delta){
    const match=/^(\d{4})-(\d{2})$/.exec(String(state.requestPeriodMonth||''));
    const d=match?new Date(Date.UTC(Number(match[1]),Number(match[2])-1,1)):new Date();
    d.setUTCMonth(d.getUTCMonth()+delta);
    state.requestPeriodMonth=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
    renderRequests();
  }
  function isPending(request){
    return request.status==='pending'||request.cancellation_status==='pending';
  }
  function submittedMeta(request){
    const submitted=formatDate(request.created_at,{
      day:'2-digit',month:'2-digit',year:'numeric',
      hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Asia/Jerusalem',
    });
    const author=employeeById(request.created_by);
    const byScheduler=Boolean(request.submitted_by_manager||(request.created_by&&request.created_by!==request.requester_id));
    return `נשלחה ${submitted} · הוגשה ע״י ${byScheduler?`משבץ/ת${author?.full_name?` · ${author.full_name}`:''}`:'העובד/ת'}`;
  }
  function longLeave(request){
    if(request.request_type!=='leave'||!request.request_date||!request.request_end_date)return false;
    return Math.floor((parseDateValue(request.request_end_date)-parseDateValue(request.request_date))/86400000)+1>2;
  }
  function canToggleManual(request){
    return isManager()||request.requester_id===state.profile?.id;
  }

  function ensurePeriodControls(){
    const workflow=document.querySelector('#requestWorkflow');
    if(!workflow||document.querySelector('#v039RequestPeriod'))return;
    const wrap=document.createElement('div');
    wrap.id='v039RequestPeriod';
    wrap.className='v039-request-period';
    wrap.innerHTML=`
      <div><span class="filter-label">תקופת הבקשות</span><strong>לפי מועד הבקשה בפועל</strong></div>
      <div class="v039-period-actions">
        <button type="button" class="icon-round-btn" data-v039-month="-1" aria-label="חודש קודם">‹</button>
        <label><span class="sr-only">חודש</span><input id="v039RequestMonth" type="month" value="${escapeHtml(state.requestPeriodMonth)}"></label>
        <button type="button" class="icon-round-btn" data-v039-month="1" aria-label="חודש הבא">›</button>
        <button type="button" class="ghost-btn" data-v039-current-month>החודש</button>
      </div>`;
    workflow.insertAdjacentElement('afterend',wrap);
    wrap.querySelector('#v039RequestMonth').addEventListener('change',(event)=>{
      if(/^\d{4}-\d{2}$/.test(event.target.value)){state.requestPeriodMonth=event.target.value;renderRequests();}
    });
    wrap.querySelectorAll('[data-v039-month]').forEach((button)=>button.addEventListener('click',()=>changeMonth(Number(button.dataset.v039Month))));
    wrap.querySelector('[data-v039-current-month]').addEventListener('click',()=>{state.requestPeriodMonth=currentMonth();renderRequests();});
  }

  function ensureManualCheckbox(){
    const reminder=document.querySelector('#leaveManualReminder');
    if(!reminder||reminder.querySelector('[name="manual_leave_form_completed"]'))return;
    const label=document.createElement('label');
    label.className='v039-manual-checkbox';
    label.innerHTML='<input type="checkbox" name="manual_leave_form_completed" value="true"><span>כבר מילאתי את הטופס הידני ✓</span>';
    reminder.append(label);
  }

  function enhanceSummary(){
    const summary=document.querySelector('#requestSummary');
    if(!summary)return;
    const counts={pending:0,approved:0,closed:0};
    let waitingTarget=0;
    for(const request of state.requests||[]){
      if(isPending(request))counts.pending+=1;
      else if(requestInMonth(request)&&['approved','applied'].includes(request.status))counts.approved+=1;
      else if(requestInMonth(request)&&['rejected','cancelled'].includes(request.status))counts.closed+=1;
      if(requestActionState(request)==='waiting_target')waitingTarget+=1;
    }
    const period=escapeHtml(monthLabel());
    summary.innerHTML=`
      <button data-request-filter="pending"><strong>${counts.pending}</strong><span>ממתינים</span><small>כל הבקשות שעדיין בטיפול</small></button>
      <button data-request-filter="approved"><strong>${counts.approved}</strong><span>אושרו בחודש</span><small>${period}</small></button>
      <button data-request-filter="closed"><strong>${counts.closed}</strong><span>סגורות בחודש</span><small>${period}</small></button>`;

    const workflow=document.querySelector('#requestWorkflow');
    if(workflow){
      workflow.innerHTML=isManager()&&waitingTarget
        ? `<button type="button" class="workflow-target" data-v039-waiting-target><span>ממתין לעובד בהחלפה</span><strong>${waitingTarget}</strong></button>`
        : '';
      workflow.querySelector('[data-v039-waiting-target]')?.addEventListener('click',()=>{
        state.requestStatusFilter='pending';
        renderRequests();
      });
    }
  }

  function enhanceCard(request){
    const card=document.querySelector(`[data-request-id="${request.id}"]`);
    if(!card)return;

    const pending=isPending(request);
    const periodVisible=pending||requestInMonth(request);
    card.hidden=!periodVisible;

    const title=card.querySelector('.request-title > div');
    if(title&&!title.querySelector('.v039-submitted')){
      const meta=document.createElement('p');
      meta.className='v039-submitted';
      meta.textContent=submittedMeta(request);
      title.append(meta);
    }

    const timeBox=[...card.querySelectorAll('.request-key-details > div')]
      .find((item)=>item.querySelector('small')?.textContent.trim()==='שעות');
    if(timeBox){
      const label=timeBox.querySelector('small');
      const value=timeBox.querySelector('strong');
      if(request.request_type==='late_start'&&request.requested_start){
        label.textContent='שעת התחלה';
        value.innerHTML=timeHtml(request.requested_start);
      }else if(request.request_type==='early_finish'&&request.requested_end){
        label.textContent='שעת סיום';
        value.innerHTML=timeHtml(request.requested_end);
      }else{
        timeBox.remove();
      }
    }

    if(longLeave(request)){
      const old=[...card.querySelectorAll('.notice.warn')]
        .find((item)=>item.textContent.includes('בקשת חופשה ידנית')||item.textContent.includes('נדרשת גם בקשת חופשה ידנית'));
      const completed=Boolean(request.manual_leave_form_completed);
      const box=old||document.createElement('div');
      box.className=`notice ${completed?'ok':'warn'} v039-manual-leave`;
      box.innerHTML=`
        <div><strong>${completed?'✓ טופס החופשה הידני סומן כהושלם':'תזכורת: יש למלא גם טופס בקשת חופשה ידני.'}</strong>
        ${completed&&request.manual_leave_form_completed_at?`<small>עודכן ${escapeHtml(formatDate(request.manual_leave_form_completed_at,{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}))}</small>`:''}</div>
        ${canToggleManual(request)?`<button type="button" class="ghost-btn" data-v039-manual-request="${request.id}" data-completed="${completed?'false':'true'}">${completed?'ביטול סימון':'✓ סמן כהושלם'}</button>`:''}`;
      if(!old)card.querySelector('.request-action-zone')?.insertAdjacentElement('beforebegin',box);
    }
  }

  function enhanceRequests(){
    ensurePeriodControls();
    ensureManualCheckbox();
    const monthInput=document.querySelector('#v039RequestMonth');
    if(monthInput&&monthInput.value!==state.requestPeriodMonth)monthInput.value=state.requestPeriodMonth;
    enhanceSummary();

    for(const request of state.requests||[])enhanceCard(request);

    const board=document.querySelector('#requestsList');
    if(!board)return;
    board.querySelector('.v039-period-empty')?.remove();
    const cards=[...board.querySelectorAll('.request-card')];
    if(cards.length&&!cards.some((card)=>!card.hidden)){
      const empty=document.createElement('div');
      empty.className='empty-state v039-period-empty';
      empty.textContent=`אין בקשות לפי הסינון בחודש ${monthLabel()}.`;
      board.append(empty);
    }
  }

  const previousRenderRequests=renderRequests;
  renderRequests=function renderRequestsV039(){
    previousRenderRequests();
    enhanceRequests();
  };

  if(typeof updateRequestDuration==='function'){
    const previousUpdateRequestDuration=updateRequestDuration;
    updateRequestDuration=function updateRequestDurationV039(){
      previousUpdateRequestDuration();
      ensureManualCheckbox();
      const form=document.querySelector('#requestForm');
      const checkbox=form?.elements?.manual_leave_form_completed;
      if(checkbox&&document.querySelector('#leaveManualReminder')?.classList.contains('hidden'))checkbox.checked=false;
    };
  }

  const previousApiFetch=apiFetch;
  apiFetch=async function apiFetchV039(url,options={}){
    if(String(url).includes('/api/requests')&&String(options?.method||'GET').toUpperCase()==='POST'&&options?.body&&typeof options.body==='object'){
      const body={...options.body};
      if(String(body.action||'create')==='create'){
        const type=String(body.request_type||'');
        body.requested_start=type==='late_start'?(body.requested_start||null):null;
        body.requested_end=type==='early_finish'?(body.requested_end||null):null;
        body.manual_leave_form_completed=Boolean(document.querySelector('#requestForm [name="manual_leave_form_completed"]')?.checked);
      }
      return previousApiFetch(url,{...options,body});
    }
    return previousApiFetch(url,options);
  };

  document.addEventListener('click',async(event)=>{
    const button=event.target.closest('[data-v039-manual-request]');
    if(!button)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setBusy(button,true,'מעדכן…');
    try{
      const result=await apiFetch('/api/requests',{
        method:'POST',
        body:{
          action:'set_manual_leave_form',
          id:button.dataset.v039ManualRequest,
          completed:button.dataset.completed==='true',
        },
      });
      if(result.request)state.requests=state.requests.map((row)=>row.id===result.request.id?result.request:row);
      renderRequests();
      showToast(button.dataset.completed==='true'?'טופס החופשה סומן כהושלם':'הסימון בוטל','success');
    }catch(error){
      showToast(error.message,'error');
    }finally{
      setBusy(button,false);
    }
  },true);

  function forceVersion(){
    window.__HADAS_RELEASE_VERSION=VERSION;
    const badge=document.querySelector('#appVersionBadge');
    if(badge){badge.textContent=`v${VERSION}`;badge.title=`גרסת מערכת ${VERSION}`;}
    const login=document.querySelector('#loginVersion');
    if(login)login.textContent=`גרסה ${VERSION}`;
    document.documentElement.dataset.hadasVersion=VERSION;
  }

  forceVersion();
  ensurePeriodControls();
  ensureManualCheckbox();
  if(state.profile)enhanceRequests();
  window.__hadasV039Ready=true;
})();
