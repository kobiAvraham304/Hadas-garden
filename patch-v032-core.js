/* Hadas v0.32 — validation, focus and fast approval */
(() => {
  if (window.__hadasV032CoreInstalled) return;
  window.__hadasV032CoreInstalled = true;
  const VERSION='0.32.1';
  const unique=(a)=>[...new Set(a.filter(Boolean))];
  const dateOf=(i)=>String(i?.date||i?.shift_date||'');
  const classOf=(i)=>i?.classId||i?.class_id||null;
  const employeeOf=(i)=>i?.employeeId||i?.employee_id||null;
  const keyOf=(i)=>String(i?._v030ApprovalKey||i?.approval_key||i?.id||'');
  const messageOf=(i)=>String(i?.message||i?.text||'').trim();
  const className=(id)=>classById(id)?.name||'';
  const employeeName=(id)=>employeeById(id)?.full_name||'';
  const dayLabel=(v)=>{if(!v)return'';const d=parseDateValue(v);return `${DAY_NAMES[d.getDay()]} ${formatDate(d,{day:'2-digit',month:'2-digit'})}`;};
  const timeLabel=(i)=>{const s=trimTime(i?.time||i?.start_time||i?.start||''),e=trimTime(i?.end_time||i?.end||'');return s?`${s}${e?`-${e}`:''}`:'';};

  function pinVersion(){window.__HADAS_RELEASE_VERSION=VERSION;const b=document.querySelector('#appVersionBadge');if(b){b.textContent=`v${VERSION}`;b.title=`גרסת מערכת ${VERSION}`;}const l=document.querySelector('#loginVersion');if(l)l.textContent=`גרסה ${VERSION}`;document.documentElement.dataset.hadasVersion=VERSION;}
  (window.__hadasV031VersionObservers||[]).forEach((o)=>{try{o.disconnect();}catch{}});
  const observers=[];for(const [node,text] of [[document.querySelector('#appVersionBadge'),`v${VERSION}`],[document.querySelector('#loginVersion'),`גרסה ${VERSION}`]]){if(!node)continue;const o=new MutationObserver(()=>{if(node.textContent!==text)node.textContent=text;});o.observe(node,{subtree:true,childList:true,characterData:true});observers.push(o);}window.__hadasV032VersionObservers=observers;pinVersion();

  function originals(item){return item?._v032Originals||[item];}
  function merge(items,status,overrides={}){const raw=items.flatMap(originals),keys=unique(raw.map(keyOf)),first=raw[0]||{};return{...first,...overrides,id:`v032:${status}:${keys.join(',')||[dateOf(first),classOf(first),employeeOf(first),first.code].join(':')}`,_v032Originals:raw,_v032ApprovalKeys:keys};}
  function detail(i){const d=dateOf(i),c=classOf(i),e=employeeOf(i),day=dayLabel(d),cls=className(c),name=employeeName(e),time=timeLabel(i),where=[day,cls?`כיתה ${cls}`:'',time?`שעה ${time}`:''].filter(Boolean).join(' · '),who=name?`העובד ${name}`:'העובד';switch(i.code){case'fixed_day_off':return`${who} שובץ ביום החופשי הקבוע${where?` · ${where}`:''}.`;case'approved_absence':return`${who} שובץ בזמן חופשה או היעדרות מאושרת${where?` · ${where}`:''}.`;case'outside_fixed_hours':return`${who} שובץ בשעות שונות מהשעות הקבועות שלו${where?` · ${where}`:''}.`;case'overlap':return`${who} משובץ בשיבוצים חופפים${where?` · ${where}`:''}.`;case'teacher_fixed_class':return`${name?`העובד ${name}`:'הגננת/הגנן'} שובץ מחוץ לכיתה הקבועה${where?` · ${where}`:''}.`;case'forbidden_class':return`${who} שובץ בכיתה שמוגדרת עבורו כחסומה${where?` · ${where}`:''}.`;case'max_weekly_hours':return`${who} חורג ממקסימום השעות השבועיות.`;case'max_weekly_days':return`${who} חורג ממספר ימי העבודה המותרים בשבוע.`;case'outside_opening_hours':return`נמצא שיבוץ מחוץ לשעות פעילות המעון${where?` · ${where}`:''}${name?` · ${name}`:''}.`;case'manual_rule_override':return`נשמר שיבוץ ידני חריג${where?` · ${where}`:''}${name?` · ${name}`:''}.${messageOf(i)?` סיבה: ${messageOf(i)}`:''}`;default:return[where,name?`עובד: ${name}`:'',messageOf(i)].filter(Boolean).join(' · ')||'נמצאה חריגה שדורשת בדיקה.';}}
  function consolidate(items=[],status='error'){
    const src=items.map((i)=>({...i,_v032Originals:[i]})),used=new Set(),out=[],staff=new Set(['understaffed','missing_leader']);
    for(const date of unique(src.map(dateOf))){const g=src.filter((i)=>!used.has(i)&&dateOf(i)===date&&staff.has(i.code));if(g.length&&!state.shifts.some((s)=>s.shift_date===date)){g.forEach((i)=>used.add(i));out.push(merge(g,status,{code:'no_day_schedule',date,class_id:null,classId:null,employee_id:null,employeeId:null,title:'אין שיבוץ כלל ביום זה',text:`ביום ${dayLabel(date)} לא קיים שיבוץ באף כיתה. כל חוסרי כוח האדם והאחראי/ת של היום אוחדו להתראה אחת.`}));}}
    const ck=unique(src.filter((i)=>!used.has(i)&&staff.has(i.code)&&dateOf(i)&&classOf(i)).map((i)=>`${dateOf(i)}|${classOf(i)}`));for(const k of ck){const [date,c]=k.split('|'),g=src.filter((i)=>!used.has(i)&&dateOf(i)===date&&String(classOf(i))===c&&staff.has(i.code));if(g.length&&!state.shifts.some((s)=>s.shift_date===date&&s.class_id===c)){g.forEach((i)=>used.add(i));out.push(merge(g,status,{code:'no_class_schedule',date,class_id:c,classId:c,title:`אין שיבוץ בכיתה ${className(c)}`,text:`ביום ${dayLabel(date)} אין אף עובד משובץ בכיתה ${className(c)}. חוסר בכוח אדם וחוסר באחראי/ת אוחדו להתראה אחת.`}));}}
    const uk=unique(src.filter((i)=>!used.has(i)&&i.code==='understaffed').map((i)=>`${dateOf(i)}|${classOf(i)||''}`));for(const k of uk){const [date,c]=k.split('|'),g=src.filter((i)=>!used.has(i)&&i.code==='understaffed'&&dateOf(i)===date&&String(classOf(i)||'')===c);if(!g.length)continue;g.forEach((i)=>used.add(i));const times=unique(g.map(timeLabel)).join(', '),expected=Math.max(0,...g.map((i)=>Number(i.expected||0))),actual=Math.min(...g.map((i)=>Number(i.count??999)));out.push(merge(g,status,{title:`חוסר בכוח אדם${c?` · ${className(c)}`:''}`,text:`ביום ${dayLabel(date)}${c?` בכיתה ${className(c)}`:''} חסר כוח אדם${times?` בשעות ${times}`:''}${expected?` · נדרש עד ${expected}`:''}${actual!==999?` · בפועל ${actual}`:''}.`}));}
    const lk=unique(src.filter((i)=>!used.has(i)&&i.code==='missing_leader').map((i)=>`${dateOf(i)}|${classOf(i)||''}`));for(const k of lk){const [date,c]=k.split('|'),g=src.filter((i)=>!used.has(i)&&i.code==='missing_leader'&&dateOf(i)===date&&String(classOf(i)||'')===c);if(!g.length)continue;g.forEach((i)=>used.add(i));const times=unique(g.map(timeLabel)).join(', ');out.push(merge(g,status,{title:`חסר/ה אחראי/ת כיתה${c?` · ${className(c)}`:''}`,text:`ביום ${dayLabel(date)}${c?` בכיתה ${className(c)}`:''} יש שיבוץ, אך חסרה גננת/גנן או מוביל/ת כיתה${times?` בשעות ${times}`:''}.`}));}
    const rest=new Map();for(const i of src){if(used.has(i))continue;const k=[i.code||'issue',dateOf(i),classOf(i)||'',employeeOf(i)||''].join('|');if(!rest.has(k))rest.set(k,[]);rest.get(k).push(i);}for(const g of rest.values()){const i=g[0],titles={fixed_day_off:'שיבוץ ביום חופשי קבוע',approved_absence:'שיבוץ בזמן חופשה / היעדרות',outside_fixed_hours:'שעות שונות מהקבוע',overlap:'חפיפת שיבוצים',teacher_fixed_class:'גננת מחוץ לכיתה הקבועה',forbidden_class:'אילוץ כיתה',max_weekly_hours:'חריגה משעות שבועיות',max_weekly_days:'חריגה מימי עבודה',outside_opening_hours:'מחוץ לשעות המעון',manual_rule_override:'שיבוץ ידני חריג',short_nonfixed_shift:'שיבוץ קצר במיוחד'};out.push(merge(g,status,{title:i.title||titles[i.code]||'בדיקת תקינות',text:`${detail(i)}${g.length>1?` ${g.length} מופעים דומים אוחדו להתראה אחת.`:''}`}));}
    return out.sort((a,b)=>dateOf(a).localeCompare(dateOf(b))||className(classOf(a)).localeCompare(className(classOf(b)),'he')||employeeName(employeeOf(a)).localeCompare(employeeName(employeeOf(b)),'he'));
  }
  function presentation(){const r=validateScheduleClient(),approvedRows=[...(r.approved||[]),...(r.warnings||[]).filter((i)=>i._v030Approved||i.approved)],seen=new Set(),approved=approvedRows.filter((i)=>{const k=String(i._v030ApprovalKey||i.approval_key||i.id||'');if(seen.has(k))return false;seen.add(k);return true;}),warnings=(r.warnings||[]).filter((i)=>!i._v030Approved&&!i.approved);return{errors:consolidate(r.errors||[],'error'),approved:consolidate(approved,'approved'),warnings:consolidate(warnings,'warning')};}
  function visibleFocusNode(node){return Boolean(node&&node.getClientRects&&node.getClientRects().length);}
  function focusTargets(g){
    const root=document.querySelector('#scheduleExport');if(!root)return[];
    const d=dateOf(g),c=classOf(g),e=employeeOf(g),ids=unique(originals(g).map((i)=>i.shift_id||i.shiftId));
    let shifts=ids.map((id)=>state.shifts.find((s)=>s.id===id)).filter(Boolean);
    if(!shifts.length&&e)shifts=state.shifts.filter((s)=>s.employee_id===e&&(!d||s.shift_date===d)&&(!c||s.class_id===c));
    const cards=shifts.flatMap((s)=>[...root.querySelectorAll(`.shift-item[data-shift-id="${s.id}"]`)]).filter(visibleFocusNode);
    if(cards.length)return cards;
    if(d){
      const dayIndex=Math.min(5,Math.max(0,parseDateValue(d).getDay()));
      const cls=className(c);
      const mobile=[...root.querySelectorAll(`.mobile-week-day[data-day-index="${dayIndex}"] .mobile-week-class`)]
        .filter((node)=>visibleFocusNode(node)&&(!c||String(node.querySelector('h4')?.textContent||'').trim()===cls));
      if(mobile.length)return mobile;
    }
    const zones=[...root.querySelectorAll('[data-v025-drop-date][data-v025-drop-class]')]
      .filter((z)=>visibleFocusNode(z)&&(!d||z.dataset.v025DropDate===d)&&(!c||z.dataset.v025DropClass===c));
    return zones;
  }
  function focus(g){
    try{switchTab('schedule');}catch{}
    state.scheduleMode='week';storageSet('localStorage','hadas-schedule-mode','week');
    const d=dateOf(g);if(d)state.expandedWeekDay=Math.min(5,Math.max(0,parseDateValue(d).getDay()));
    renderSchedule();
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      document.querySelectorAll('.v032-focus-ring,.v032-focus-column').forEach((x)=>x.classList.remove('v032-focus-ring','v032-focus-column'));
      const t=focusTargets(g);
      if(!t.length)return showToast('עברתי לשבוע הרלוונטי, אבל אין תא יחיד שאפשר לסמן.','error');
      const exact=Boolean(employeeOf(g)||t.length===1);
      t.forEach((x)=>x.classList.add(exact?'v032-focus-ring':'v032-focus-column'));
      t[0].scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});
      setTimeout(()=>t.forEach((x)=>x.classList.remove('v032-focus-ring','v032-focus-column')),5200);
    }));
  }
  function snapshot(i){return{code:i.code||'',date:dateOf(i),class_id:classOf(i)||'',employee_id:employeeOf(i)||'',time:i.time||i.start_time||'',start_time:i.start_time||'',end_time:i.end_time||'',count:i.count??null,expected:i.expected??null,message:messageOf(i)};}
  function localApproval(g,approve){if(!state.v030Validation)return;const keys=new Set(g._v032ApprovalKeys||[]),from=approve?'errors':'approved',to=approve?'approved':'errors',moved=(state.v030Validation[from]||[]).filter((i)=>keys.has(String(i.approval_key||i.id||'')));state.v030Validation[from]=(state.v030Validation[from]||[]).filter((i)=>!keys.has(String(i.approval_key||i.id||'')));state.v030Validation[to]=[...(state.v030Validation[to]||[]).filter((i)=>!keys.has(String(i.approval_key||i.id||''))),...moved.map((i)=>({...i,approved:approve}))];state.scheduleValidationCache={key:'',value:null};}
  const solutionCoverageCodes=new Set(['understaffed','missing_leader']);
  const solutionReplaceCodes=new Set(['fixed_day_off','approved_absence','forbidden_class','teacher_fixed_class','overlap','max_weekly_hours','max_weekly_days']);
  const shortTime=(value)=>trimTime(value||'');
  const durationOf=(shift)=>Math.max(0,timeToMinutes(shift.end_time)-timeToMinutes(shift.start_time));
  function solutionOriginal(g){
    const rows=originals(g);
    if(['no_day_schedule','no_class_schedule','understaffed','missing_leader'].includes(g?.code)){
      return rows.find((i)=>solutionCoverageCodes.has(i.code)&&dateOf(i)&&classOf(i))||rows[0]||g;
    }
    return rows.find((i)=>i.code===g?.code)||rows[0]||g;
  }
  function solutionRange(g,base){
    const d=dateOf(base),c=classOf(base);
    const rows=originals(g).filter((i)=>dateOf(i)===d&&String(classOf(i)||'')===String(c||'')&&solutionCoverageCodes.has(i.code));
    const starts=rows.map((i)=>shortTime(i.time||i.start_time)).filter(Boolean).map(timeToMinutes);
    const ends=rows.map((i)=>shortTime(i.end_time||i.time||i.start_time)).filter(Boolean).map(timeToMinutes);
    const fallbackStart=shortTime(base.time||base.start_time)||shortTime(state.settings.opening_time)||'07:30';
    const fallbackEnd=shortTime(base.end_time)||closingTimeForDate(d);
    return {
      start:starts.length?minutesLabel(Math.min(...starts)):fallbackStart,
      end:ends.length?minutesLabel(Math.max(...ends)):fallbackEnd,
    };
  }
  function bestRecommended(result){return (result?.candidates||[]).find((item)=>item.recommended)||null;}
  function shiftForSolution(g,base){
    const employeeId=employeeOf(base)||employeeOf(g),d=dateOf(base)||dateOf(g),c=classOf(base)||classOf(g);
    let rows=(state.shifts||[]).filter((shift)=>(!employeeId||shift.employee_id===employeeId)&&(!d||shift.shift_date===d)&&(!c||shift.class_id===c));
    const code=base?.code||g?.code||'';
    if(code==='overlap'&&employeeId&&d){
      const day=(state.shifts||[]).filter((shift)=>shift.employee_id===employeeId&&shift.shift_date===d);
      const pair=day.flatMap((first,index)=>day.slice(index+1).map((second)=>[first,second]))
        .find(([first,second])=>overlaps(first.start_time,first.end_time,second.start_time,second.end_time));
      if(pair)rows=[pair[1],pair[0]];
    }
    if(code==='max_weekly_hours'&&employeeId){
      const employee=employeeById(employeeId);
      const max=Number(employee?.max_weekly_hours||0)*60;
      const total=(state.shifts||[]).filter((s)=>s.employee_id===employeeId).reduce((sum,s)=>sum+durationOf(s),0);
      const excess=Math.max(1,total-max);
      rows=(state.shifts||[]).filter((s)=>s.employee_id===employeeId)
        .sort((a,b)=>{
          const ad=durationOf(a),bd=durationOf(b),af=ad>=excess,bf=bd>=excess;
          if(af!==bf)return af?-1:1;
          return af?ad-bd:bd-ad;
        });
    }
    if(code==='max_weekly_days'&&employeeId){
      const byDate=new Map();
      for(const shift of (state.shifts||[]).filter((s)=>s.employee_id===employeeId)){
        if(!byDate.has(shift.shift_date))byDate.set(shift.shift_date,[]);
        byDate.get(shift.shift_date).push(shift);
      }
      rows=[...byDate.values()].filter((items)=>items.length===1).map((items)=>items[0]).sort((a,b)=>durationOf(a)-durationOf(b));
    }
    return rows[0]||null;
  }
  async function candidateSolutionForShift(shift){
    if(!shift)return null;
    const result=await fetchMatchingCandidates({
      date:shift.shift_date,classId:shift.class_id,start:shortTime(shift.start_time),end:shortTime(shift.end_time),
      role:shift.shift_role||'staff',shiftId:shift.id,
    },{force:true,timeout:10000});
    return {candidate:bestRecommended(result),result};
  }
  function liveMissingLeader(date,classId,start,end){
    return (state.v030Validation?.errors||[]).some((item)=>item.code==='missing_leader'&&dateOf(item)===date&&String(classOf(item)||'')===String(classId||'')&&(
      !start||!end||overlaps(shortTime(item.time||item.start_time),shortTime(item.end_time||item.time||item.start_time),start,end)
    ));
  }
  async function buildSolution(g){
    const base=solutionOriginal(g),code=base?.code||g?.code||'',d=dateOf(base),c=classOf(base);
    if(solutionCoverageCodes.has(code)){
      const range=solutionRange(g,base);
      const role=code==='missing_leader'||liveMissingLeader(d,c,range.start,range.end)?'teacher':'staff';
      const result=await fetchMatchingCandidates({date:d,classId:c,start:range.start,end:range.end,role,shiftId:null},{force:true,timeout:10000});
      const candidate=bestRecommended(result);
      if(!candidate)return {unavailable:true,message:'לא נמצא כרגע עובד מומלץ שעובר את כל בדיקות הזמינות, השעות והתקינה. עדיף לא לבצע תיקון אוטומטי חלש.'};
      return {
        kind:'candidate',mode:'add',issueCode:code,date:d,classId:c,start:range.start,end:range.end,role,
        candidate,
        title:`לשבץ את ${candidate.full_name}`,
        detail:`${className(c)} · ${range.start}–${range.end}${candidate.candidate_type==='transfer'?` · העברה בטוחה מ־${candidate.from_class_name||'כיתה אחרת'}`:''}`,
      };
    }
    if(code==='outside_opening_hours'){
      const shift=shiftForSolution(g,base);if(!shift)return {unavailable:true,message:'לא נמצא השיבוץ המדויק לתיקון אוטומטי.'};
      const opening=shortTime(state.settings.opening_time)||'07:30',closing=closingTimeForDate(shift.shift_date);
      const start=minutesLabel(Math.max(timeToMinutes(opening),timeToMinutes(shift.start_time)));
      const end=minutesLabel(Math.min(timeToMinutes(closing),timeToMinutes(shift.end_time)));
      if(timeToMinutes(end)<=timeToMinutes(start)||(start===shortTime(shift.start_time)&&end===shortTime(shift.end_time)))return {unavailable:true,message:'אין שינוי שעות בטוח שאפשר לבצע אוטומטית.'};
      return {kind:'patch',issueCode:code,date:shift.shift_date,shiftId:shift.id,changes:{start_time:start,end_time:end},title:'לתקן את שעות השיבוץ',detail:`${employeeName(shift.employee_id)} · ${start}–${end}`};
    }
    if(solutionReplaceCodes.has(code)){
      const shift=shiftForSolution(g,base);
      if(!shift)return {unavailable:true,message:'לא נמצא שיבוץ יחיד שאפשר להחליף בלי לנחש.'};
      const {candidate}=await candidateSolutionForShift(shift);
      if(!candidate)return {unavailable:true,message:'לא נמצא מחליף מומלץ שעובר את כל הבדיקות. המערכת לא תציע החלפה חלשה רק כדי לסגור את ההתראה.'};
      return {
        kind:'candidate',mode:'replace',issueCode:code,date:shift.shift_date,classId:shift.class_id,start:shortTime(shift.start_time),end:shortTime(shift.end_time),
        role:candidate.suggested_role||shift.shift_role||'staff',targetShiftId:shift.id,candidate,
        title:`להחליף את ${employeeName(shift.employee_id)} ב־${candidate.full_name}`,
        detail:`${className(shift.class_id)} · ${shortTime(shift.start_time)}–${shortTime(shift.end_time)}${candidate.candidate_type==='transfer'?` · העברה בטוחה מ־${candidate.from_class_name||'כיתה אחרת'}`:''}`,
      };
    }
    return {unavailable:true,message:'לסוג החריגה הזה אין כרגע תיקון אוטומטי בטוח. אפשר להציג אותו בשיבוץ או לאשר חריגה במידת הצורך.'};
  }
  function solutionBoxHtml(g,solution){
    if(solution.unavailable)return `<div class="v0363-solution-box is-unavailable" data-v0363-solution-box><div><strong>אין הצעה אוטומטית בטוחה</strong><small>${escapeHtml(solution.message||'עדיף לבצע בדיקה ידנית.')}</small></div><button type="button" class="ghost-btn" data-v032-solution-dismiss>סגירה</button></div>`;
    const reasons=(solution.candidate?.reasons||[]).slice(0,2).join(' · ');
    return `<div class="v0363-solution-box" data-v0363-solution-box><div class="v0363-solution-copy"><span>הפתרון המומלץ</span><strong>${escapeHtml(solution.title)}</strong><small>${escapeHtml(solution.detail||'')}${reasons?` · ${escapeHtml(reasons)}`:''}</small></div><div class="v0363-solution-actions"><button type="button" class="primary-btn" data-v032-solution-apply="${escapeHtml(g.id)}">אישור ותיקון</button><button type="button" class="ghost-btn" data-v032-solution-dismiss>לא עכשיו</button></div></div>`;
  }
  async function showSolution(g,button){
    const card=button.closest('.v032-validation-card');if(!card)return;
    card.querySelector('[data-v0363-solution-box]')?.remove();
    setBusy(button,true,'בודק…');
    try{
      const solution=await buildSolution(g);
      state.v032SolutionProposals.set(g.id,solution);
      card.insertAdjacentHTML('beforeend',solutionBoxHtml(g,solution));
    }catch(error){
      card.insertAdjacentHTML('beforeend',solutionBoxHtml(g,{unavailable:true,message:error.message||'לא ניתן לחשב הצעה כרגע.'}));
    }finally{setBusy(button,false);}
  }
  async function applyCandidateSolution(solution){
    return apiFetch('/api/shifts',{method:'POST',body:{
      action:'apply_suggestion',target_shift_id:solution.targetShiftId||null,candidate_id:solution.candidate.employee_id,
      candidate_type:solution.candidate.candidate_type||'direct',source_shift_id:solution.candidate.source_shift_id||null,
      shift_date:solution.date,class_id:solution.classId,start_time:solution.start,end_time:solution.end,
      shift_role:solution.candidate.suggested_role||solution.role||'staff',public_note:'תיקון מבדיקת תקינות',
    }});
  }
  function remainingCoverageIssue(solution){
    return (state.v030Validation?.errors||[]).find((item)=>solutionCoverageCodes.has(item.code)&&dateOf(item)===solution.date&&String(classOf(item)||'')===String(solution.classId||''));
  }
  async function applySolution(g,solution){
    const published=typeof isPublishedWeekDate==='function'&&isPublishedWeekDate(solution.date);
    let applied=0,current=solution;
    while(current&&!current.unavailable&&applied<4){
      if(current.kind==='candidate')await applyCandidateSolution(current);
      else if(current.kind==='patch')await apiFetch('/api/shifts',{method:'PATCH',body:{id:current.shiftId,...current.changes,complete_payload:true}});
      applied+=1;
      state.shiftSuggestionCache?.clear?.();
      await refreshScheduleWeek({force:true});
      if(!(current.kind==='candidate'&&current.mode==='add'&&solutionCoverageCodes.has(current.issueCode)))break;
      const remaining=remainingCoverageIssue(current);if(!remaining)break;
      const next=await buildSolution({...remaining,_v032Originals:[remaining],id:`v0363-live-${applied}`});
      if(!next||next.unavailable||next.kind!=='candidate'||next.mode!=='add')break;
      current=next;
    }
    state.scheduleIssuesOpen=true;
    renderSchedule();
    requestAnimationFrame(()=>window.__hadasV032RenderValidation?.());
    const stillOpen=current?.mode==='add'&&remainingCoverageIssue(current);
    showToast(stillOpen?'בוצע התיקון הבטוח שנמצא; נשאר חוסר נוסף לבדיקה.':applied>1?`השיבוץ תוקן אוטומטית ב־${applied} פעולות בטוחות`:'השיבוץ תוקן והבדיקה עודכנה','success');
    if(published&&typeof showPostPublishChangePrompt==='function')setTimeout(()=>showPostPublishChangePrompt({title:'התיקון נשמר בטיוטה',message:'השיבוץ שתוקן עדיין אינו גלוי לצוות. לפרסם את השינוי עכשיו?'}),140);
  }
  function installSolutionStyles(){
    if(document.querySelector('#v0363-validation-solution-style'))return;
    const style=document.createElement('style');style.id='v0363-validation-solution-style';
    style.textContent=`
      .v0363-solution-box{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;margin-top:2px;padding:10px 12px;border:1px solid #cfd8ff;border-radius:14px;background:#f7f8ff}
      .v0363-solution-box.is-unavailable{border-color:#e2e4eb;background:#fafafa}.v0363-solution-copy{min-width:0}.v0363-solution-copy>span{display:block;color:#6764c7;font-size:10px;font-weight:950;margin-bottom:2px}
      .v0363-solution-copy strong,.v0363-solution-box>div>strong{display:block;font-size:14px}.v0363-solution-copy small,.v0363-solution-box>div>small{display:block;margin-top:3px;color:#6f7487;line-height:1.45}
      .v0363-solution-actions{display:flex;gap:6px;align-items:center}.v0363-solution-actions button,.v0363-solution-box>button{min-height:36px;padding:6px 10px}
      @media(max-width:760px){.v0363-solution-box{grid-template-columns:1fr;padding:9px}.v0363-solution-actions{display:grid;grid-template-columns:1fr 1fr}.v0363-solution-actions button,.v0363-solution-box>button{width:100%}}
    `;document.head.append(style);
  }
  function card(g,kind){const approved=kind==='approved',warning=kind==='warning',ctx=[dateOf(g)?dayLabel(dateOf(g)):'',classOf(g)?`כיתה ${className(classOf(g))}`:'',employeeOf(g)?employeeName(employeeOf(g)):'' ].filter(Boolean).join(' · ');return`<article class="v032-validation-card ${kind}"><div class="v032-validation-icon">${approved?'✓':warning?'i':'!'}</div><div class="v032-validation-copy"><span>${approved?'חריגה מאושרת':warning?'הערה':'דורש טיפול'}</span><strong>${escapeHtml(g.title||'בדיקת תקינות')}</strong>${ctx?`<small>${escapeHtml(ctx)}</small>`:''}<p>${escapeHtml(g.text||detail(g))}</p></div><div class="v032-validation-actions">${!approved&&!warning?`<button type="button" class="primary-btn" data-v032-solution="${escapeHtml(g.id)}">הצעת פתרון</button>`:''}${dateOf(g)||classOf(g)||employeeOf(g)?`<button type="button" class="ghost-btn" data-v032-focus="${escapeHtml(g.id)}">הצג בשיבוץ</button>`:''}${approved?`<button type="button" class="secondary-btn" data-v032-validation="revoke" data-v032-group="${escapeHtml(g.id)}">ביטול אישור</button>`:!warning?`<button type="button" class="secondary-btn" data-v032-validation="approve" data-v032-group="${escapeHtml(g.id)}">אישור למרות החריגה</button>`:''}</div></article>`;}
  function renderPanel(){
    const p=document.querySelector('#scheduleWarnings'),toggle=document.querySelector('#scheduleIssuesToggle'),count=document.querySelector('#scheduleIssuesCount');
    if(!p||!toggle||!count||!isManager())return;
    if(typeof state.v032ShowApproved!=='boolean')state.v032ShowApproved=false;
    const d=presentation(),liveTotal=d.errors.length+d.warnings.length,all=[...d.errors,...d.approved,...d.warnings];
    state.v032ValidationGroupMap=new Map(all.map((g)=>[g.id,g]));
    count.textContent=d.errors.length?`${d.errors.length} בעיות מרוכזות`:d.warnings.length?`${d.warnings.length} הערות`:'הכול תקין';
    toggle.classList.toggle('has-errors',d.errors.length>0);
    toggle.setAttribute('aria-expanded',String(Boolean(state.scheduleIssuesOpen)));
    p.classList.toggle('hidden',!state.scheduleIssuesOpen);
    if(!state.scheduleIssuesOpen)return;
    if(!liveTotal&&!d.approved.length){
      p.innerHTML='<div class="v027-validation-success"><span>✓</span><div><strong>השיבוץ עבר את בדיקות התקינות</strong><small>לא נמצאו בעיות או חריגות בשבוע הנבחר.</small></div></div>';
      return;
    }
    const approvedToggle=d.approved.length?`<button type="button" class="v036-approved-toggle ${state.v032ShowApproved?'active':''}" data-v032-toggle-approved>${state.v032ShowApproved?'הסתרת חריגות שאושרו':'הצגת חריגות שאושרו'} <b>${d.approved.length}</b></button>`:'';
    const liveHtml=[...d.errors.map((x)=>card(x,'error')),...d.warnings.map((x)=>card(x,'warning'))].join('')||'<div class="v027-validation-success"><span>✓</span><div><strong>אין בעיות פתוחות</strong><small>חריגות שכבר אושרו אינן חוסמות את הפרסום.</small></div></div>';
    const approvedHtml=state.v032ShowApproved?`<div class="v036-approved-list">${d.approved.map((x)=>card(x,'approved')).join('')}</div>`:'';
    p.innerHTML=`<section class="v032-validation-panel"><header><div><strong>בדיקות תקינות לשבוע</strong><small>התראות דומות אוחדו. חריגות שאושרו מוצגות רק לפי בקשה.</small></div><div class="v036-validation-head-actions">${approvedToggle}<b>${d.errors.length?`${d.errors.length} דורשות טיפול`:'אין בעיות פתוחות'}</b></div></header><div class="v032-validation-list">${liveHtml}${approvedHtml}</div></section>`;
  }
  function install(){
    state.v032SolutionProposals ||= new Map();
    installSolutionStyles();
    const current=document.querySelector('#scheduleIssuesToggle');
    if(current&&!current.dataset.v032Installed){
      const clone=current.cloneNode(true);clone.dataset.v032Installed='true';current.replaceWith(clone);
      clone.addEventListener('click',async(e)=>{
        e.preventDefault();e.stopImmediatePropagation();state.scheduleIssuesOpen=!state.scheduleIssuesOpen;
        if(state.scheduleIssuesOpen){
          const c=document.querySelector('#scheduleIssuesCount');if(c)c.textContent='בודק…';
          try{await window.__hadasV030RefreshValidation?.({force:true,rerender:false});}catch{}
        }
        renderPanel();
        if(state.scheduleIssuesOpen)requestAnimationFrame(()=>document.querySelector('#scheduleWarnings')?.scrollIntoView({behavior:'smooth',block:'nearest'}));
      },true);
    }
    const p=document.querySelector('#scheduleWarnings');
    if(p&&!p.dataset.v032Events){
      p.dataset.v032Events='true';
      p.addEventListener('click',async(e)=>{
        const approvedToggle=e.target.closest('[data-v032-toggle-approved]');
        if(approvedToggle){e.preventDefault();e.stopImmediatePropagation();state.v032ShowApproved=!state.v032ShowApproved;renderPanel();return;}
        const dismiss=e.target.closest('[data-v032-solution-dismiss]');if(dismiss){e.preventDefault();e.stopImmediatePropagation();dismiss.closest('[data-v0363-solution-box]')?.remove();return;}
        const solutionButton=e.target.closest('[data-v032-solution]');if(solutionButton){e.preventDefault();e.stopImmediatePropagation();const g=state.v032ValidationGroupMap?.get(solutionButton.dataset.v032Solution);if(g)await showSolution(g,solutionButton);return;}
        const applyButton=e.target.closest('[data-v032-solution-apply]');if(applyButton){e.preventDefault();e.stopImmediatePropagation();const id=applyButton.dataset.v032SolutionApply,g=state.v032ValidationGroupMap?.get(id),solution=state.v032SolutionProposals?.get(id);if(!g||!solution)return;setBusy(applyButton,true,'מתקן…');try{await applySolution(g,solution);}catch(err){showToast(err.message||'התיקון נכשל','error');}finally{setBusy(applyButton,false);}return;}
        const f=e.target.closest('[data-v032-focus]');
        if(f){e.preventDefault();e.stopImmediatePropagation();const g=state.v032ValidationGroupMap?.get(f.dataset.v032Focus);if(g)focus(g);return;}
        const a=e.target.closest('[data-v032-validation]');
        if(!a)return;
        e.preventDefault();e.stopImmediatePropagation();
        const g=state.v032ValidationGroupMap?.get(a.dataset.v032Group);if(!g)return;
        const approve=a.dataset.v032Validation==='approve';
        setBusy(a,true,approve?'מאשר…':'מבטל…');
        try{
          if(approve){
            const issues=originals(g).map((i)=>({approval_key:keyOf(i),snapshot:snapshot(i)})).filter((x)=>x.approval_key);
            await apiFetch('/api/shifts',{method:'POST',body:{action:'approve_issues',week_start:dateISO(state.weekStart),issues},timeout:8000});
          }else{
            await apiFetch('/api/shifts',{method:'POST',body:{action:'revoke_issues',week_start:dateISO(state.weekStart),approval_keys:g._v032ApprovalKeys||[]},timeout:8000});
          }
          localApproval(g,approve);
          await window.__hadasV030RefreshValidation?.({force:true,rerender:false});
          state.scheduleIssuesOpen=true;
          renderSchedule();
          requestAnimationFrame(renderPanel);
          showToast(approve?'החריגה אושרה מיד':'אישור החריגה בוטל','success');
        }catch(err){showToast(err.message,'error');}
        finally{setBusy(a,false);}
      },true);
    }
    renderPanel();
  }
  function arrows(){const p=document.querySelector('#prevWeekBtn'),n=document.querySelector('#nextWeekBtn');if(p){p.textContent='‹';p.title='שבוע קודם';}if(n){n.textContent='›';n.title='שבוע הבא';}}
  const oldRender=renderSchedule;renderSchedule=function(...args){const r=oldRender(...args);requestAnimationFrame(()=>{pinVersion();arrows();install();});return r;};
  window.__hadasV032RenderValidation=renderPanel;window.__hadasV032ConsolidateValidation=consolidate;install();arrows();pinVersion();
})();
