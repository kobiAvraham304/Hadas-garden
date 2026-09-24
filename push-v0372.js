(() => {
  const card=document.getElementById('pushSettingsCard');
  const button=document.getElementById('pushToggleBtn');
  const smartButton=document.getElementById('pushSmartToggleBtn');
  const status=document.getElementById('pushStatusText');
  const smartStatus=document.getElementById('pushSmartStatusText');
  const badge=document.getElementById('pushStateBadge');
  if(!card||!button||!smartButton||!status||!smartStatus)return;

  const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const supported='serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
  const REMIND_AFTER_MS=7*24*60*60*1000;
  let registration=null,currentSubscription=null,onboardingDialog=null,onboardingTimer=null;
  let smartEnabled=true,generalActive=false;

  function b64(value){const padding='='.repeat((4-value.length%4)%4),raw=atob((value+padding).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));}
  async function api(path,options={}){const response=await fetch(path,{method:options.method||'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{})},body:options.body?JSON.stringify(options.body):undefined});let data={};try{data=await response.json();}catch{}if(!response.ok)throw new Error(data.error||'הפעולה נכשלה');return data;}
  function setSwitch(target,on,disabled=false){target.classList.toggle('is-on',Boolean(on));target.setAttribute('aria-checked',String(Boolean(on)));target.disabled=Boolean(disabled);}
  function renderSmart(){
    setSwitch(smartButton,smartEnabled&&generalActive,!generalActive);
    smartStatus.textContent=!generalActive
      ? 'זמין לאחר הפעלת התראות לטלפון.'
      : smartEnabled
        ? 'פעיל: תזכורת שעה לפני המשמרת ובתחילת המשמרת.'
        : 'כבוי: לא יישלחו תזכורות משמרת.';
  }
  function render(stateName,text){
    card.dataset.state=stateName;
    status.textContent=text;
    generalActive=stateName==='active';
    setSwitch(button,generalActive,stateName==='unsupported');
    if(badge){badge.textContent=generalActive?'פעיל':'כבוי';badge.classList.toggle('is-active',generalActive);}
    renderSmart();
  }
  async function ensureRegistration(){if(!supported)return null;registration ||= await navigator.serviceWorker.register('/push-sw.js?v=0380',{scope:'/'});await navigator.serviceWorker.ready;return registration;}

  function profileKey(){try{const p=typeof state!=='undefined'?state?.profile:null;return String(p?.id||p?.employee_id||p?.phone||p?.name||'device');}catch{return'device';}}
  function onboardingKey(){return 'hadas-push-onboarding-v1:'+profileKey();}
  function readOnboarding(){try{return JSON.parse(localStorage.getItem(onboardingKey())||'null');}catch{return null;}}
  function writeOnboarding(statusName){try{localStorage.setItem(onboardingKey(),JSON.stringify({status:statusName,at:Date.now()}));}catch{}}
  function shouldDelayPrompt(){const saved=readOnboarding();if(!saved)return false;if(saved.status==='enabled')return true;return Number(saved.at||0)>Date.now()-REMIND_AFTER_MS;}
  function closeOnboarding(){if(onboardingDialog?.open)onboardingDialog.close();}
  function createOnboardingDialog(){
    if(onboardingDialog)return onboardingDialog;
    const dialog=document.createElement('dialog');
    dialog.id='pushOnboardingDialog';
    dialog.className='push-onboarding-dialog';
    dialog.innerHTML='<div class="push-onboarding-card"><div class="push-onboarding-bell" aria-hidden="true">🔔</div><h2 id="pushOnboardingTitle"></h2><p id="pushOnboardingText"></p><div id="pushOnboardingTips" class="push-onboarding-tips"></div><div class="push-onboarding-actions"><button id="pushOnboardingEnable" type="button" class="primary-btn"></button><button id="pushOnboardingLater" type="button" class="ghost-btn">אולי אחר כך</button></div></div>';
    document.body.append(dialog);onboardingDialog=dialog;
    dialog.querySelector('#pushOnboardingLater').addEventListener('click',()=>{writeOnboarding('later');closeOnboarding();});
    dialog.addEventListener('cancel',(event)=>{event.preventDefault();writeOnboarding('later');closeOnboarding();});
    return dialog;
  }
  function configureOnboarding(){
    const dialog=createOnboardingDialog();
    const title=dialog.querySelector('#pushOnboardingTitle'),text=dialog.querySelector('#pushOnboardingText'),tips=dialog.querySelector('#pushOnboardingTips'),enableBtn=dialog.querySelector('#pushOnboardingEnable');
    if(isIOS&&!standalone()){
      title.textContent='כדי לקבל עדכונים גם באייפון';
      text.textContent='Apple מאפשרת התראות למערכת כשהיא מותקנת במסך הבית. זה לוקח כמה שניות.';
      tips.innerHTML='<span>1</span><p>לחצי על כפתור השיתוף ב-Safari</p><span>2</span><p>בחרי „הוספה למסך הבית”</p><span>3</span><p>פתחי את „מעון הדס” מהאייקון ואשרי התראות</p>';
      enableBtn.textContent='הבנתי — אוסיף למסך הבית';
      enableBtn.onclick=()=>{writeOnboarding('ios-guide');closeOnboarding();};
      return dialog;
    }
    if(!supported){
      title.textContent='התראות אינן זמינות בדפדפן הזה';
      text.textContent='אפשר להמשיך להשתמש במערכת כרגיל. ההתראות בתוך מעון הדס ימשיכו לפעול.';
      tips.innerHTML='';enableBtn.textContent='הבנתי';enableBtn.onclick=()=>{writeOnboarding('unsupported');closeOnboarding();};return dialog;
    }
    if(Notification.permission==='denied'){
      title.textContent='ההתראות חסומות במכשיר';
      text.textContent='כדי לקבל שיבוצים ועדכונים בטלפון יש לאפשר התראות למעון הדס בהגדרות הדפדפן או המכשיר.';
      tips.innerHTML='<span>✓</span><p>המערכת עצמה תמשיך לעבוד כרגיל גם בלי Push</p>';
      enableBtn.textContent='הבנתי';enableBtn.onclick=()=>{writeOnboarding('denied');closeOnboarding();};return dialog;
    }
    title.textContent='להישאר מעודכנת בלי לבדוק כל פעם';
    text.textContent='אשרי התראות פעם אחת וקבלי עדכונים חשובים ישירות לטלפון.';
    tips.innerHTML='<span>✓</span><p>שיבוץ שבועי חדש</p><span>✓</span><p>אישור או דחיית בקשות</p><span>✓</span><p>תזכורות משמרת חכמות</p>';
    enableBtn.textContent='הפעלת התראות';
    enableBtn.onclick=()=>enable({fromOnboarding:true});
    return dialog;
  }
  async function maybeShowOnboarding(){
    const shell=document.getElementById('appShell');
    if(!shell||shell.classList.contains('hidden')||shouldDelayPrompt())return;
    if(isIOS&&!standalone()){configureOnboarding().showModal();return;}
    if(!supported)return;
    try{const reg=await ensureRegistration();currentSubscription=await reg.pushManager.getSubscription();if(currentSubscription&&Notification.permission==='granted'){writeOnboarding('enabled');return;}configureOnboarding().showModal();}catch{}
  }
  function scheduleOnboarding(){clearTimeout(onboardingTimer);onboardingTimer=setTimeout(()=>maybeShowOnboarding().catch(()=>{}),900);}

  async function refresh(){
    if(isIOS&&!standalone()){smartEnabled=true;return render('warning','באייפון: שיתוף → „הוספה למסך הבית”, ואז פתחי את מעון הדס מהאייקון.');}
    if(!supported)return render('unsupported','המכשיר או הדפדפן הזה אינם תומכים בהתראות Web Push.');
    try{
      const [reg,info]=await Promise.all([ensureRegistration(),api('/api/push')]);
      currentSubscription=await reg.pushManager.getSubscription();
      smartEnabled=info.smartShiftReminders!==false;
      if(currentSubscription&&Notification.permission==='granted'){writeOnboarding('enabled');return render('active','ההתראות פעילות במכשיר הזה.');}
      if(Notification.permission==='denied')return render('warning','ההתראות חסומות בהגדרות המכשיר. יש לאפשר אותן שם ואז לנסות שוב.');
      render('idle','שיבוצים, בקשות והודעות חשובות.');
    }catch{render('warning','לא ניתן לבדוק כרגע את מצב ההתראות. אפשר לנסות שוב בעוד רגע.');}
  }

  async function enable({fromOnboarding=false}={}){
    if(isIOS&&!standalone()){configureOnboarding();if(!onboardingDialog.open)onboardingDialog.showModal();return false;}
    setSwitch(button,false,true);
    if(fromOnboarding){const b=onboardingDialog?.querySelector('#pushOnboardingEnable');if(b){b.disabled=true;b.textContent='מפעיל…';}}
    try{
      const info=await api('/api/push');
      if(!info.available||!info.publicKey)throw new Error('שירות ההתראות אינו זמין כרגע');
      if(await Notification.requestPermission()!=='granted')throw new Error('לא ניתנה הרשאה להתראות');
      const reg=await ensureRegistration();
      currentSubscription=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(info.publicKey)});
      const json=currentSubscription.toJSON();
      const result=await api('/api/push',{method:'POST',body:{action:'subscribe',endpoint:json.endpoint,p256dh:json.keys?.p256dh,auth:json.keys?.auth,device_label:isIOS?'iPhone / iPad':/Android/i.test(navigator.userAgent)?'Android':'דפדפן'}});
      smartEnabled=result.smartShiftReminders!==false;
      writeOnboarding('enabled');render('active','ההתראות פעילות במכשיר הזה ✓');
      if(fromOnboarding){
        const t=onboardingDialog.querySelector('#pushOnboardingText');t.textContent='מעולה! עדכונים חשובים ותזכורות משמרת יכולים להגיע ישירות לטלפון.';
        onboardingDialog.querySelector('#pushOnboardingTips').innerHTML='<span>✓</span><p>ההתראות ותזכורות המשמרת הופעלו</p>';
        onboardingDialog.querySelector('.push-onboarding-actions').innerHTML='<button type="button" class="primary-btn" id="pushOnboardingDone">סיום</button>';
        onboardingDialog.querySelector('#pushOnboardingDone').addEventListener('click',closeOnboarding);setTimeout(closeOnboarding,1200);
      }
      return true;
    }catch(e){
      render('warning',e.message||'לא ניתן להפעיל התראות כרגע.');
      if(fromOnboarding){const b=onboardingDialog?.querySelector('#pushOnboardingEnable');if(b){b.disabled=false;b.textContent='נסי שוב';}const t=onboardingDialog?.querySelector('#pushOnboardingText');if(t)t.textContent=e.message||'לא ניתן להפעיל התראות כרגע.';if(Notification.permission==='denied')writeOnboarding('denied');}
      return false;
    }
  }

  async function disable(){
    setSwitch(button,false,true);
    try{
      const reg=await ensureRegistration();currentSubscription ||= await reg.pushManager.getSubscription();
      await api('/api/push',{method:'POST',body:{action:'unsubscribe',endpoint:currentSubscription?.endpoint||''}});
      if(currentSubscription)await currentSubscription.unsubscribe().catch(()=>{});
      currentSubscription=null;try{localStorage.removeItem(onboardingKey());}catch{}
      render('idle','ההתראות כבויות במכשיר הזה.');
    }catch(e){render('warning',e.message||'לא ניתן לכבות התראות כרגע.');}
  }

  async function toggleSmart(){
    if(!generalActive)return;
    const next=!smartEnabled;
    setSwitch(smartButton,next,true);
    try{
      const result=await api('/api/push',{method:'POST',body:{action:'set_smart_shift_reminders',enabled:next}});
      smartEnabled=result.smartShiftReminders!==false;
      renderSmart();
    }catch(e){renderSmart();smartStatus.textContent=e.message||'לא ניתן לעדכן את תזכורות המשמרת כרגע.';}
  }

  button.addEventListener('click',()=>generalActive?disable():enable());
  smartButton.addEventListener('click',toggleSmart);
  document.getElementById('notificationsBtn')?.addEventListener('click',()=>setTimeout(refresh,80));
  document.querySelector('#announcementForm [name="popup_on_login"]')?.addEventListener('change',e=>{if(e.target.checked){const push=document.querySelector('#announcementForm [name="send_push"]');if(push)push.checked=true;}});
  document.getElementById('announcementForm')?.addEventListener('submit',()=>{const popup=document.querySelector('#announcementForm [name="popup_on_login"]'),push=document.querySelector('#announcementForm [name="send_push"]');if(popup?.checked&&push)push.checked=true;},true);

  async function deepLink(){
    const params=new URLSearchParams(location.search),target=params.get('push');if(!target)return;
    for(let i=0;i<40;i++){
      const shell=document.getElementById('appShell');
      if(shell&&!shell.classList.contains('hidden')){
        const tab=target==='announcement'?'announcements':target==='request'?'requests':target==='schedule'?'schedule':target==='attendance'?'attendance':target==='home'?'dashboard':null;
        if(tab)document.querySelector('[data-tab="'+tab+'"]')?.click();else if(target==='notifications')document.getElementById('notificationsBtn')?.click();
        history.replaceState({},'',location.pathname);return;
      }
      await new Promise(r=>setTimeout(r,250));
    }
  }

  const shell=document.getElementById('appShell');
  if(shell){new MutationObserver(()=>{if(!shell.classList.contains('hidden'))scheduleOnboarding();}).observe(shell,{attributes:true,attributeFilter:['class']});if(!shell.classList.contains('hidden'))scheduleOnboarding();}
  ensureRegistration().catch(()=>{});
  deepLink().catch(()=>{});
})();