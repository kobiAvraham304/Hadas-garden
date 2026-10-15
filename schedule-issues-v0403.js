/* מעון הדס — פירוט ואישור חריגות ישירות משיבוץ שבועי, גרסה 0.40.3 */
(() => {
  if(window.__hadasCellIssuesV0403)return;
  window.__hadasCellIssuesV0403=true;
  const BLOCKED = new Set(['overlap','outside_opening_hours','approved_absence','forbidden_class','teacher_fixed_class']);
  let selected=null, busy=false;
  const escapeValue=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const getErrors=(date,classId)=>((validateScheduleClient()?.errors)||[]).filter(item=>
    item.date===date && (item.classId||item.class_id)===classId);
  const canApprove=item=>Boolean(item?._v030ApprovalKey && /^[a-f0-9]{40}$/i.test(item._v030ApprovalKey) && !BLOCKED.has(item.code));

  function ensureDialog(){
    let element=document.querySelector('#v0403IssueDialog');
    if(element)return element;
    element=document.createElement('dialog');
    element.id='v0403IssueDialog';
    element.className='modal v0403-issue-dialog';
    element.innerHTML='<div class="modal-card"><div class="modal-heading"><div><p class="eyebrow">בדיקות תקינות</p><h3 id="v0403IssueTitle">נדרשת בדיקה</h3><small id="v0403IssueSubtitle"></small></div><button type="button" class="icon-btn" data-v0403-close aria-label="סגירה">×</button></div><div id="v0403IssueContents"></div><div class="modal-actions"><button type="button" class="ghost-btn" data-v0403-close>סגירה</button></div></div>';
    document.body.append(element);
    element.addEventListener('click',event=>{
      if(event.target.closest('[data-v0403-close]')){element.close();return;}
      const approve=event.target.closest('[data-v0403-approve-index]');
      if(approve){approveSelected(Number(approve.dataset.v0403ApproveIndex));return;}
      const fix=event.target.closest('[data-v0403-fix-index]');
      if(fix)fixSelected(Number(fix.dataset.v0403FixIndex));
    });
    return element;
  }
  function proposedFix(item){
    const date=item.date||selected?.date;
    const start=trimTime(item.start_time||item.time||state.settings?.opening_time||'07:30');
    const close=closingTimeForDate(date);
    const tentativeEnd=trimTime(item.end_time||close);
    const end=(timeToMinutes(tentativeEnd)>timeToMinutes(start))?tentativeEnd:close;
    if(['understaffed','missing_leader'].includes(item.code))return {
      text:item.code==='missing_leader'
        ? 'לשבץ גננת או סייעת מובילה זמינה לכיתה, ולוודא שיש אחראית בזמן החסר.'
        : 'להוסיף עובדת זמינה לכיתה בשעות שבהן חסר כוח אדם.',
      action:'add',date,start,end
    };
    if(['max_daily_staff','max_weekly_hours','max_weekly_days','outside_fixed_hours','fixed_day_off'].includes(item.code))return {
      text:'לבדוק את שעות העובדת ולתקן או להעביר את השיבוץ הבעייתי, בהתאם לזמינות.',
      action:'edit',date,start,end
    };
    return {text:'לפתוח את השיבוץ ולתקן את הפרטים שגורמים לחריגה, לפני הפרסום.',action:'edit',date,start,end};
  }
  function issueName(item) {
    const titles={
      understaffed:'חוסר בכוח אדם',missing_leader:'חסרה אחראית כיתה',max_daily_staff:'מעל תקן הכיתה',
      max_weekly_hours:'חריגה משעות שבועיות',max_weekly_days:'חריגה ממספר ימי עבודה',
      outside_fixed_hours:'שעות שונות מהשעות הקבועות',fixed_day_off:'שיבוץ ביום חופשי',
      overlap:'שיבוצים חופפים',outside_opening_hours:'מחוץ לשעות המעון',
      approved_absence:'עובדת בחופשה מאושרת',forbidden_class:'שיבוץ לכיתה אסורה',
      teacher_fixed_class:'גננת מחוץ לכיתה הקבועה'
    };
    return titles[item.code]||item.title||'בדיקת שיבוץ';
  }
  function drawDialog(){
    if(!selected)return;
    const el=ensureDialog(),list=getErrors(selected.date,selected.classId);
    const klass=state.classes.find(x=>x.id===selected.classId)?.name||'הכיתה';
    document.querySelector('#v0403IssueTitle').textContent=klass+' · '+formatDate(selected.date,{day:'2-digit',month:'2-digit'});
    document.querySelector('#v0403IssueSubtitle').textContent=list.length===1?'חריגה אחת לבדיקה':list.length+' חריגות לבדיקה';
    const target=document.querySelector('#v0403IssueContents');
    target.innerHTML=list.length?list.map((item,i)=>{
      const suggestion=proposedFix(item);
      return `<article class="v0403-issue-detail">
        <strong>${escapeValue(issueName(item))}</strong>
        <p>${escapeValue(item.text||item.message||'נמצאה חריגה בשיבוץ הכיתה בתאריך זה.')}</p>
        <div class="v0403-issue-solution"><b>הפתרון המומלץ</b><span>${escapeValue(suggestion.text)}</span></div>
        <div class="v0403-issue-buttons">
          <button type="button" class="secondary-btn" data-v0403-fix-index="${i}">מעבר לתיקון</button>
          ${canApprove(item)?`<button type="button" class="v0403-approve-button" data-v0403-approve-index="${i}">✓ אישור כחריגה</button>`:'<small class="v0403-not-approvable">חריגה בטיחותית — נדרש תיקון, לא ניתן לאשר.</small>'}
        </div>
      </article>`;
    }).join(''):'<div class="v0403-all-resolved">✓ אין חריגות פתוחות בכיתה וביום זה.</div>';
  }
  async function refresh(){
    if(window.__hadasV030RefreshValidation)await window.__hadasV030RefreshValidation({force:true,rerender:false});
  }
  async function approveItems(items){
    if(!isManager()||busy)return;
    if(!items.length || !items.every(canApprove))return showToast('יש חריגה שאינה מתאימה לאישור מהיר. יש לבדוק ולתקן אותה.','error');
    busy=true;
    try{
      // approve_issue validates each key against the latest server-side week.
      for(const issue of items){
        await apiFetch('/api/shifts',{method:'POST',body:{
          action:'approve_issue',week_start:dateISO(state.weekStart),approval_key:issue._v030ApprovalKey
        },timeout:15000});
      }
      state.v030ValidationKey='';
      if(window.__hadasV030RefreshValidation)await window.__hadasV030RefreshValidation({force:true,rerender:true});
      else renderSchedule();
      showToast(items.length===1?'החריגה אושרה ונשמרה':'אושרו '+items.length+' חריגות ונשמרו','success');
      if(ensureDialog().open)drawDialog();
    }catch(error){
      state.v030ValidationKey='';
      if(window.__hadasV030RefreshValidation)await window.__hadasV030RefreshValidation({force:true,rerender:true});
      showToast(error.message||'לא ניתן לאשר את החריגה','error');
      if(ensureDialog().open)drawDialog();
    }finally{busy=false;}
  }
  function fixSelected(index){
    const item=selected&&getErrors(selected.date,selected.classId)[index];
    if(!item)return;
    const suggestion=proposedFix(item);
    const relevant=state.shifts.find(row=>row.shift_date===selected.date && row.class_id===selected.classId &&
      (!item.employee_id || row.employee_id===item.employee_id));
    ensureDialog().close();
    if(suggestion.action==='add'){
      // The existing picker ranks and filters eligible available staff.
      openShiftDialog({shift_date:selected.date,class_id:selected.classId,start_time:suggestion.start,end_time:suggestion.end});
    }else if(relevant) openShiftDialog(relevant);
    else openShiftDialog({shift_date:selected.date,class_id:selected.classId,start_time:suggestion.start,end_time:suggestion.end});
  }
  async function approveSelected(index){
    const item=selected&&getErrors(selected.date,selected.classId)[index];
    if(item)await approveItems([item]);
  }
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-v0403-issue-open], [data-v0403-issue-quick]');
    if(!button || !document.querySelector('#scheduleExport')?.contains(button))return;
    if(!isManager())return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selected={date:button.dataset.v0403Date,classId:button.dataset.v0403Class};
    if(!selected.date||!selected.classId)return;
    try{
      if(!button.dataset.v0403IssueQuick){
        const el=ensureDialog();
        document.querySelector('#v0403IssueContents').textContent='מעדכן בדיקות תקינות…';
        if(!el.open)el.showModal();
      }
      await refresh();
      if(button.dataset.v0403IssueQuick)await approveItems(getErrors(selected.date,selected.classId));
      else drawDialog();
    }catch(error){showToast(error.message||'לא ניתן לטעון את פרטי החריגה','error');}
  },true);
})();
