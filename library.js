/* Shared educational library. Loaded independently; scheduling payload stays small. */
(() => {
  'use strict';
  const panel=document.getElementById('libraryPanel');if(!panel)return;
  const el=id=>document.getElementById(id),esc=value=>escapeHtml(String(value??''));
  const categories=[['','הכול','grid'],['meeting','מפגשים','sun'],['craft','יצירות','palette'],['video','סרטונים','play'],['music','מוזיקה','music'],['idea','רעיונות','bulb'],['document','קבצים','file']];
  const paths={grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',sun:'M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6l1.4 1.4 M17 17l1.4 1.4 M5.6 18.4L7 17 M17 7l1.4-1.4 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',palette:'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7c-.8-.5-.4-1.3.4-1.3H17a4 4 0 0 0 4-4c0-5-4-9-9-9z M7 10h.01 M11 7h.01 M16 8h.01',play:'M9 6l10 6-10 6z',music:'M9 18V5l11-2v13 M9 5l11-2 M9 18a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3 M20 16a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3',bulb:'M9 18h6 M10 21h4 M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2',file:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5',heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z',bookmark:'M6 3h12v18l-6-4-6 4z',comment:'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0z',check:'M5 12l4 4L19 6',share:'M12 16V3 M7 8l5-5 5 5 M5 13v7h14v-7',download:'M12 3v12 M7 10l5 5 5-5 M5 16v5h14v-5',close:'M6 6l12 12 M18 6L6 18',link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2'};
  function icon(name){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.file}"/></svg>`;}
  const label=category=>categories.find(c=>c[0]===category)?.[1]||'תוכן';
  const categoryIcon=category=>categories.find(c=>c[0]===category)?.[2]||'file';
  const L={items:[],total:0,collections:[],q:'',category:'',view:'all',collection:'',sort:'new',loading:false,revision:0,loadedAt:0,owner:null,detail:null,files:[],urlCache:new Map(),draft:null,selected:[],editId:null,uploading:false,dirty:false,error:null};
  let searchTimer,refreshTimer,detailRevision=0,detailFiles=[],preparedFile=null,sessionGeneration=0,shareRevision=0;
  const activeUploads=new Set();
  const stale=()=>Object.assign(new Error(''),{libraryStale:true});
  const api=async(body,method='POST')=>{const generation=sessionGeneration;try{const result=await apiFetch('/api/library',{method,body});if(generation!==sessionGeneration)throw stale();return result;}catch(e){if(generation!==sessionGeneration)throw stale();throw e;}};
  function toast(message,error=false){if(message&&state.profile)showToast(message,error?'error':'success');}
  function decodableImage(file){return /\.(jpe?g|png|webp|gif|avif)$/i.test(file.name)||file.type.startsWith('image/')&&!/heic|heif/.test(file.type);}
  function sizeText(bytes){return bytes<1024*1024?`${Math.max(1,Math.round(bytes/1024))}KB`:`${(bytes/(1024*1024)).toFixed(1)}MB`;}
  function busy(button,on){if(button){button.disabled=on;button.setAttribute('aria-busy',String(on));}}
  function card(item){
    const cached=L.urlCache.get(item.id),cover=cached&&cached.expires>Date.now()?cached.url:null;
    return `<article class="lib-card lib-category-${esc(item.category)}" data-lib-id="${esc(item.id)}">
      <button type="button" class="lib-cover" data-lib-action="open" aria-label="פתיחת ${esc(item.title)}">${cover?`<img src="${esc(cover)}" loading="lazy" alt="" />`:`<span class="lib-cover-art">${icon(categoryIcon(item.category))}<span>${esc(label(item.category))}</span></span>`}${item.is_pinned?'<span class="lib-pin">תוכן נבחר</span>':''}${item.files?.filter(f=>!f.is_thumbnail).length?`<span class="lib-file-count">${item.files.filter(f=>!f.is_thumbnail).length} קבצים</span>`:''}</button>
      <div class="lib-card-body"><span class="lib-card-category">${esc(label(item.category))}</span><button type="button" data-lib-action="open" class="lib-card-title">${esc(item.title)}</button><p class="lib-card-description">${esc(item.description||item.materials||'פתחו לצפייה בתוכן ובקבצים')}</p><div class="lib-tags">${(item.tags||[]).slice(0,3).map(t=>`<button type="button" data-lib-action="tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div><div class="lib-author"><span>${esc(item.author_name||'צוות המעון')}</span><time>${item.published_at?new Date(item.published_at).toLocaleDateString('he-IL',{day:'numeric',month:'short'}):''}</time></div></div>
      <div class="lib-card-footer"><button type="button" data-lib-action="like" aria-label="לייק" aria-pressed="${Boolean(item.liked)}">${icon('heart')}<span>${item.likes_count||0}</span></button><button type="button" data-lib-action="open" aria-label="תגובות">${icon('comment')}<span>${item.comments_count||0}</span></button><button type="button" data-lib-action="save" aria-label="שמירה לאוסף" aria-pressed="${Boolean(item.saved_collection)}">${icon('bookmark')}</button><button type="button" data-lib-action="share" aria-label="שיתוף קישור">${icon('share')}</button></div>
    </article>`;
  }
  function render(){
    el('libraryCategories').innerHTML=categories.map(([value,text,symbol])=>`<button type="button" data-lib-category="${value}" aria-pressed="${L.category===value}">${icon(symbol)}<span>${text}</span></button>`).join('');
    el('libraryViews').querySelectorAll('[data-lib-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.libView===L.view)));
    el('libraryCollectionField').classList.toggle('hidden',L.view!=='saved');
    el('libraryCollectionFilter').innerHTML='<option value="">כל האוספים</option>'+L.collections.map(c=>`<option value="${esc(c)}" ${c===L.collection?'selected':''}>${esc(c)}</option>`).join('');
    el('libraryResultCount').textContent=L.loading?'מחפשים השראה…':`${L.total} תכנים${L.view==='saved'?' ששמרת':''}`;
    el('libraryGrid').setAttribute('aria-busy',String(L.loading));
    if(L.error&&!L.items.length)el('libraryGrid').innerHTML=`<div class="lib-empty"><h3>לא הצלחנו לטעון את הספרייה</h3><p>${esc(L.error)}</p><button type="button" class="secondary-btn" data-lib-action="retry">ניסיון נוסף</button></div>`;
    else if(L.loading&&!L.items.length)el('libraryGrid').innerHTML=Array.from({length:4},()=>'<div class="lib-skeleton"><div></div><span></span><span></span></div>').join('');
    else if(L.items.length)el('libraryGrid').innerHTML=L.items.map(card).join('');
    else el('libraryGrid').innerHTML=`<div class="lib-empty">${icon(L.view==='saved'?'bookmark':'bulb')}<h3>${L.q||L.category?'לא מצאנו תוכן מתאים':L.view==='saved'?'הרעיונות שלך מחכים כאן':L.view==='mine'?'הידע שלך יכול לעזור לצוות':'הספרייה מתחילה איתנו'}</h3><p>${L.q||L.category?'נסו נושא אחר או הסירו את הסינון.':L.view==='saved'?'לחצו על סימן השמירה ליד תוכן שאהבתם.':'שתפו מפגש, יצירה או שיר — ונתחיל לבנות יחד מאגר של רעיונות.'}</p><button type="button" class="secondary-btn" data-lib-action="${L.q||L.category?'clear':'new'}">${L.q||L.category?'ניקוי סינון':'העלאת התוכן הראשון'}</button></div>`;
    el('libraryLoadMore').classList.toggle('hidden',L.items.length>=L.total);busy(el('libraryLoadMore'),L.loading);
    loadCovers();
  }
  async function refresh({force=false,append=false}={}){
    if(!state.profile)return;
    if(L.loading&&!force)return;
    if(!force&&!append&&Date.now()-L.loadedAt<30000)return;
    const revision=++L.revision;L.loading=true;L.error=null;render();
    const params=new URLSearchParams({q:L.q,category:L.category,view:L.view,collection:L.collection,sort:L.sort,offset:String(append?L.items.length:0)});
    try{
      const data=await apiFetch(`/api/library?${params}`);
      if(revision!==L.revision)return;
      L.items=append?[...L.items,...data.items]:data.items;L.total=data.total;L.collections=data.collections||[];L.loadedAt=Date.now();
    }catch(error){if(revision===L.revision){L.error=error.message;toast(error.message,true);}}
    finally{if(revision===L.revision){L.loading=false;render();}}
  }
  async function loadCovers(){
    const ids=L.items.filter(i=>i.files?.some(f=>f.is_thumbnail)&&(!L.urlCache.has(i.id)||L.urlCache.get(i.id).expires<Date.now())).map(i=>i.id);
    if(!ids.length)return;
    try{const data=await api({action:'covers',ids});for(const f of data.files){L.urlCache.set(f.item_id,{url:f.url,expires:Date.now()+50*60000});const node=el('libraryGrid').querySelector(`[data-lib-id="${f.item_id}"] .lib-cover`);if(node){const image=document.createElement('img');image.src=f.url;image.alt='';image.loading='lazy';node.querySelector('.lib-cover-art')?.replaceWith(image);}}}catch{/* Cards remain usable without thumbnails. */}
  }
  function setFilter(){L.items=[];L.loadedAt=0;refresh({force:true});}
  function find(id){return L.detail?.id===id?L.detail:L.items.find(i=>i.id===id);}
  function updateItem(id,patch){L.items=L.items.map(i=>i.id===id?{...i,...patch}:i);if(L.detail?.id===id)Object.assign(L.detail,patch);render();}
  async function reaction(id,kind,button){
    const item=find(id);if(!item)return;busy(button,true);
    const field=kind==='like'?'liked':'tried',count=kind==='like'?'likes_count':'tried_count',value=!item[field];
    try{await api({action:'reaction',id,kind,value});updateItem(id,{[field]:value,[count]:Math.max(0,(Number(item[count])||0)+(value?1:-1))});if(L.detail?.id===id)renderDetailActions();}catch(e){toast(e.message,true);}finally{busy(button,false);}
  }
  function dialog(id,content,className=''){
    let d=el(id);if(d)return d;
    d=document.createElement('dialog');d.id=id;d.className=`lib-dialog ${className}`;d.innerHTML=content;document.body.append(d);
    d.addEventListener('click',event=>{const close=event.target.closest('[data-lib-action="close"]');if(close)d.close();});
    return d;
  }
  function head(title){return `<div class="lib-dialog-heading"><h3>${title}</h3><button type="button" class="lib-icon-btn" data-lib-action="close" aria-label="סגירה">${icon('close')}</button></div>`;}
  function detailDialog(){return dialog('libraryDetailDialog',`<div class="lib-detail-shell">${head('תוכן מהספרייה')}<div id="libraryDetailBody"></div></div>`);}
  function renderDetailActions(){
    const i=L.detail;if(!i||!el('libraryDetailActions'))return;
    el('libraryDetailActions').innerHTML=`<button type="button" data-lib-action="like" aria-pressed="${Boolean(i.liked)}">${icon('heart')} ${i.likes_count||0} לייקים</button><button type="button" data-lib-action="tried" aria-pressed="${Boolean(i.tried)}">${icon('check')} ניסיתי במעון${i.tried_count?` · ${i.tried_count}`:''}</button><button type="button" data-lib-action="save" aria-pressed="${Boolean(i.saved_collection)}">${icon('bookmark')} ${i.saved_collection?'שמור באוסף':'שמירה'}</button><button type="button" data-lib-action="share">${icon('share')} שיתוף</button>`;
  }
  function renderComment(c){return `<article class="lib-comment" data-comment-id="${esc(c.id)}"><div><strong>${esc(c.author?.full_name||c.author_name||'צוות המעון')}</strong><time>${new Date(c.created_at).toLocaleDateString('he-IL')}</time></div><p>${esc(c.content)}</p>${c.employee_id===state.profile.id||isManager()?`<button type="button" data-lib-action="delete-comment" data-comment-id="${esc(c.id)}">הסרת תגובה</button>`:''}</article>`;}
  function renderDetail(data){
    const i=L.detail=data.item;
    el('libraryDetailBody').innerHTML=`<div class="lib-detail-intro"><span class="lib-card-category">${esc(label(i.category))}</span><h2>${esc(i.title)}</h2><p class="lib-detail-author">משותף על ידי ${esc(i.author_name||state.profile.full_name)}${i.is_pinned?' · תוכן נבחר':''}</p><div class="lib-tags">${(i.tags||[]).map(t=>`<span>${esc(t)}</span>`).join('')}</div></div><div id="libraryDetailActions" class="lib-detail-actions"></div>
      ${i.description?`<p class="lib-detail-description">${esc(i.description)}</p>`:''}
      ${i.age_range||i.duration_minutes?`<div class="lib-activity-meta">${i.age_range?`<span>גיל: ${esc(i.age_range)}</span>`:''}${i.duration_minutes?`<span>${i.duration_minutes} דקות</span>`:''}</div>`:''}
      ${i.materials?`<div class="lib-note"><strong>מה צריך להכין?</strong><p>${esc(i.materials)}</p></div>`:''}${i.adaptations?`<div class="lib-note"><strong>התאמות וטיפים</strong><p>${esc(i.adaptations)}</p></div>`:''}
      ${i.link_url?`<a class="lib-external-link" href="${esc(i.link_url)}" target="_blank" rel="noopener noreferrer">${icon('link')} פתיחת הקישור המצורף</a>`:''}
      <div id="libraryDetailFiles" class="lib-detail-files"><p class="muted">טוען קבצים…</p></div>
      ${data.canManage?`<div class="lib-manage-actions"><button type="button" class="ghost-btn" data-lib-action="edit">עריכת התוכן</button>${isManager()?`<button type="button" class="ghost-btn" data-lib-action="pin">${i.is_pinned?'הסרה מתכנים נבחרים':'סימון כתוכן נבחר'}</button>`:''}<button type="button" class="ghost-btn lib-danger" data-lib-action="delete">הסרת התוכן</button></div>`:''}
      <div class="lib-comments"><h3>מחשבות מהצוות <span>${i.comments_count||0}</span></h3><form id="libraryCommentForm"><label class="sr-only" for="libraryCommentInput">תגובה לתוכן</label><textarea id="libraryCommentInput" maxlength="2000" rows="2" placeholder="ניסיתם? יש טיפ שיעזור לצוות?" required></textarea><button class="primary-btn" type="submit">שליחת תגובה</button></form><div id="libraryCommentsList">${data.comments.length?data.comments.map(renderComment).join(''):'<p class="lib-comment-empty">היו הראשונים לשתף מחשבה.</p>'}</div></div>`;
    renderDetailActions();
    el('libraryCommentForm').addEventListener('submit',async event=>{
      event.preventDefault();const input=el('libraryCommentInput'),content=input.value.trim(),button=event.submitter;if(!content)return;
      const id=i.id;busy(button,true);
      try{const result=await api({action:'comment',id,content});if(L.detail?.id!==id)return;input.value='';el('libraryCommentsList').querySelector('.lib-comment-empty')?.remove();el('libraryCommentsList').insertAdjacentHTML('beforeend',renderComment({...result.comment,author_name:state.profile.full_name}));updateItem(id,{comments_count:(Number(i.comments_count)||0)+1});toast('התגובה נוספה');}catch(e){toast(e.message,true);}finally{busy(button,false);}
    });
  }
  async function openItem(id){
    if(!id||!state.profile)return;
    const d=detailDialog(),revision=++detailRevision;preparedFile=null;detailFiles=[];
    el('libraryDetailBody').innerHTML='<div class="lib-empty"><span class="loading-dot"></span><p>פותחים את התוכן…</p></div>';if(!d.open)d.showModal();
    try{
      const data=await apiFetch(`/api/library?id=${encodeURIComponent(id)}`);if(revision!==detailRevision)return;renderDetail(data);
      const result=await api({action:'file_urls',id});if(revision!==detailRevision)return;detailFiles=result.files.filter(f=>!f.is_thumbnail);renderFiles();
    }catch(e){if(revision===detailRevision)el('libraryDetailBody').innerHTML=`<div class="lib-empty"><h3>התוכן אינו זמין כרגע</h3><p>${esc(e.message)}</p></div>`;}
  }
  async function refreshDetailSocial(){
    const id=L.detail?.id,revision=detailRevision;if(!id||!el('libraryDetailDialog')?.open)return;
    try{const data=await apiFetch(`/api/library?id=${encodeURIComponent(id)}`);if(revision!==detailRevision||L.detail?.id!==id||!el('libraryDetailDialog')?.open)return;L.detail=data.item;renderDetailActions();el('libraryCommentsList').innerHTML=data.comments.length?data.comments.map(renderComment).join(''):'<p class="lib-comment-empty">היו הראשונים לשתף מחשבה.</p>';const count=el('libraryDetailBody').querySelector('.lib-comments h3 span');if(count)count.textContent=data.item.comments_count||0;}catch{/* Keep current detail and any unsent comment. */}
  }
  function renderFiles(){
    const node=el('libraryDetailFiles');if(!node)return;
    node.innerHTML=detailFiles.length?'<h3>החומרים המצורפים</h3>'+detailFiles.map(f=>{
      const mime=f.mime_type;
      const image=mime.startsWith('image/')&&!/heic|heif/.test(mime),video=mime.startsWith('video/'),audio=mime.startsWith('audio/');
      return `<article class="lib-file" data-file-id="${esc(f.id)}">${image?`<a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" loading="lazy" alt="${esc(f.name)}" /></a>`:video?`<video controls playsinline preload="none" src="${esc(f.url)}" aria-label="${esc(f.name)}"></video>`:audio?`<audio controls preload="none" src="${esc(f.url)}" aria-label="${esc(f.name)}"></audio>`:`<div class="lib-file-symbol">${icon('file')}<span>${esc(f.name.split('.').pop().toUpperCase())}</span></div>`}<div class="lib-file-info"><strong>${esc(f.name)}</strong><small>${sizeText(f.size_bytes)}${/heic|heif/.test(mime)?' · אפשר לפתוח בגלריה לאחר הורדה':''}</small></div><div class="lib-file-actions"><a href="${esc(f.url)}" target="_blank" rel="noopener" class="secondary-btn">צפייה / פתיחה</a><button type="button" data-lib-action="download">${icon('download')} הורדה</button><button type="button" data-lib-action="prepare-share">${icon('share')} שיתוף קובץ</button></div></article>`;
    }).join(''):'';
  }
  async function fetchFile(f){
    const generation=sessionGeneration;
    let file=f;if(!file.url){const result=await api({action:'file_urls',id:L.detail.id,file_ids:[f.id]});file=result.files[0];}
    const response=await fetch(file.url);if(!response.ok)throw new Error('הקישור לקובץ פג. פתחו את התוכן מחדש ונסו שוב');
    const blob=await response.blob();if(generation!==sessionGeneration)throw stale();
    return new File([blob],file.name,{type:file.mime_type});
  }
  async function download(f,button){busy(button,true);try{const file=await fetchFile(f);const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=f.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(e){toast(e.message,true);}finally{busy(button,false);}}
  function shareLink(item){
    const url=new URL(location.origin+'/');url.searchParams.set('library',item.id);
    if(navigator.share){navigator.share({title:item.title,text:`${item.title} — הספריה של מעון הדס`,url:url.href}).catch(e=>{if(e.name!=='AbortError')copyLink(url.href);});}
    else {const d=dialog('libraryLinkDialog',`<div class="lib-small-dialog">${head('שיתוף התוכן')}<p>הקישור מוביל לתוכן בתוך מערכת הדס.</p><a id="libraryWhatsAppLink" class="primary-btn" target="_blank" rel="noopener">שיתוף ב־WhatsApp</a><button id="libraryCopyLink" class="secondary-btn" type="button">העתקת קישור</button></div>`);el('libraryWhatsAppLink').href=`https://wa.me/?text=${encodeURIComponent(item.title+'\n'+url.href)}`;el('libraryCopyLink').onclick=()=>copyLink(url.href);d.showModal();}
  }
  async function copyLink(url){try{await navigator.clipboard.writeText(url);toast('הקישור הועתק');}catch{const d=dialog('libraryCopyDialog',`<div class="lib-small-dialog">${head('העתקת קישור')}<input id="libraryCopyInput" readonly aria-label="קישור לתוכן" /></div>`);el('libraryCopyInput').value=url;d.showModal();el('libraryCopyInput').select();}}
  async function prepareShare(f,button){
    const revision=++shareRevision,generation=sessionGeneration;
    const d=dialog('libraryShareDialog',`<div class="lib-small-dialog">${head('שיתוף קובץ')}<p id="libraryShareStatus" role="status"></p><button id="libraryShareReady" type="button" class="primary-btn" disabled>פתיחת תפריט השיתוף</button><button id="libraryShareDownload" type="button" class="secondary-btn">הורדת הקובץ</button></div>`);
    preparedFile=null;el('libraryShareStatus').textContent='מכינים את הקובץ לשיתוף…';el('libraryShareReady').disabled=true;d.showModal();
    el('libraryShareDownload').onclick=event=>download(f,event.currentTarget);
    try{const file=await fetchFile(f);if(!d.open||revision!==shareRevision||generation!==sessionGeneration)return;preparedFile=file;const supported=navigator.canShare?.({files:[file]});el('libraryShareStatus').textContent=supported?'הקובץ מוכן. בתפריט שנפתח תוכלו לבחור WhatsApp או אפליקציה אחרת.':'המכשיר אינו תומך בשיתוף קובץ מהדפדפן. אפשר להוריד אותו או לשתף קישור לתוכן.';el('libraryShareReady').disabled=false;el('libraryShareReady').textContent=supported?'בחירת WhatsApp / אפליקציה':'שיתוף קישור לתוכן';el('libraryShareReady').onclick=()=>{if(supported){navigator.share({files:[preparedFile],title:f.name}).then(()=>d.close()).catch(e=>{if(e.name!=='AbortError')toast('אפשר להוריד את הקובץ ולשתף מהגלריה',true);});}else shareLink(L.detail);};}catch(e){if(generation===sessionGeneration&&revision===shareRevision&&el('libraryShareStatus'))el('libraryShareStatus').textContent=e.message;}
  }
  function saveDialog(item){
    const d=dialog('librarySaveDialog',`<form id="librarySaveForm" class="lib-small-dialog">${head('שומרים רעיון להמשך')}<p>האוספים שלך אישיים. אפשר לתת להם שם כמו ״מפגשי חורף״.</p><label>שם האוסף<input name="collection" maxlength="60" list="libraryCollectionsOptions" required /><datalist id="libraryCollectionsOptions"></datalist></label><div class="lib-save-actions"><button class="primary-btn" type="submit">שמירה לאוסף</button><button id="libraryUnsave" type="button" class="ghost-btn">הסרת השמירה</button></div></form>`);
    const form=el('librarySaveForm');form.elements.collection.value=item.saved_collection||'השמורים שלי';el('libraryCollectionsOptions').innerHTML=L.collections.map(c=>`<option value="${esc(c)}"></option>`).join('');el('libraryUnsave').classList.toggle('hidden',!item.saved_collection);
    async function save(value,button){const collection=form.elements.collection.value.trim();busy(button,true);try{await api({action:'bookmark',id:item.id,value,collection});updateItem(item.id,{saved_collection:value?collection:null});if(value&&!L.collections.includes(collection))L.collections.push(collection);d.close();if(L.detail?.id===item.id)renderDetailActions();L.loadedAt=0;if(L.view==='saved')refresh({force:true});toast(value?'נשמר באוסף שלך':'השמירה הוסרה');}catch(e){toast(e.message,true);}finally{busy(button,false);}}
    form.onsubmit=e=>{e.preventDefault();save(true,e.submitter);};el('libraryUnsave').onclick=e=>save(false,e.currentTarget);d.showModal();
  }
  function composerDialog(){
    const d=dialog('libraryComposerDialog',`<form id="libraryComposerForm" class="lib-composer">${head('משתפים משהו טוב')}<p class="lib-compose-hint">מפגש שעבד, יצירה אהובה, שיר או רעיון קטן — הכול יכול לתת השראה.</p><div class="lib-compose-grid"><label class="lib-full">כותרת<input name="title" maxlength="140" placeholder="למשל: מפגש חמשת החושים" required /></label><label>סוג התוכן<select name="category">${categories.filter(c=>c[0]).map(c=>`<option value="${c[0]}">${c[1]}</option>`).join('')}</select></label><label>תגיות<input name="tags" placeholder="חושים, חורף, ויסות" maxlength="280" /></label><label class="lib-full">תיאור / איך משתמשים?<textarea name="description" rows="4" maxlength="6000" placeholder="כמה מילים שיעזרו לצוות להשתמש בתוכן"></textarea></label></div><div id="libraryDropZone" class="lib-drop-zone"><span>${icon('share')}</span><strong>מוסיפים חומרים לפעילות</strong><p>תמונות, סרטונים, מוזיקה, PDF, Word, מצגות, גיליונות, ZIP ועוד</p><div><button id="libraryGalleryBtn" type="button" class="secondary-btn">מהגלריה</button><button id="libraryChooseFiles" type="button" class="secondary-btn">בחירת קבצים</button></div><small>אפשר לגרור קבצים לכאן · עד 10 קבצים · עד 50MB לקובץ</small><input id="libraryFileInput" type="file" multiple hidden /><input id="libraryGalleryInput" type="file" accept="image/*,video/*" multiple hidden /></div><div id="librarySelectedFiles" class="lib-selected-files"></div><label class="lib-full">קישור מצורף <span class="muted">(אפשר גם בלי קבצים)</span><input name="link_url" type="url" placeholder="https://…" dir="ltr" maxlength="2000" /></label><details class="lib-extra"><summary>פרטים שיעזרו לצוות <span>גיל, משך, חומרים והתאמות</span></summary><div class="lib-compose-grid"><label>למי מתאים?<input name="age_range" maxlength="80" placeholder="למשל: גילאי 2–3" /></label><label>משך הפעילות בדקות<input name="duration_minutes" type="number" min="1" max="240" /></label><label class="lib-full">מה צריך להכין?<textarea name="materials" rows="2" maxlength="1200"></textarea></label><label class="lib-full">התאמות וטיפים<textarea name="adaptations" rows="2" maxlength="1200" placeholder="איך לפשט או להתאים את הפעילות?"></textarea></label></div></details><div class="lib-compose-footer"><span id="libraryUploadStatus" role="status" aria-live="polite">התוכן משותף עם צוות המעון</span><button id="libraryPublishBtn" type="submit" class="primary-btn">פרסום בספרייה</button></div></form>`);
    if(d.dataset.bound)return d;d.dataset.bound='true';
    el('libraryGalleryBtn').onclick=()=>el('libraryGalleryInput').click();el('libraryChooseFiles').onclick=()=>el('libraryFileInput').click();
    for(const id of ['libraryFileInput','libraryGalleryInput'])el(id).onchange=e=>{addFiles([...e.target.files]);e.target.value='';};
    el('libraryDropZone').ondragover=e=>{e.preventDefault();e.currentTarget.classList.add('dragging');};el('libraryDropZone').ondragleave=e=>e.currentTarget.classList.remove('dragging');el('libraryDropZone').ondrop=e=>{e.preventDefault();e.currentTarget.classList.remove('dragging');addFiles([...e.dataTransfer.files]);};
    el('librarySelectedFiles').onclick=e=>{const b=e.target.closest('[data-remove-file]');if(!b||L.uploading)return;const entry=L.selected[Number(b.dataset.removeFile)];if(entry?.reserved)return toast('קובץ שכבר התחיל לעלות נשמר לניסיון חוזר. אפשר לבטל את הפרסום ולהתחיל מחדש',true);if(entry?.url)URL.revokeObjectURL(entry.url);L.selected.splice(Number(b.dataset.removeFile),1);renderSelected();};
    el('libraryComposerForm').onsubmit=publish;
    d.addEventListener('cancel',e=>{if(L.uploading){e.preventDefault();toast('יש להמתין לסיום ההעלאה',true);}else if(L.dirty&&!confirm('לסגור את חלון ההעלאה? התוכן עדיין לא פורסם.'))e.preventDefault();});
    d.addEventListener('click',e=>{if(e.target.closest('[data-lib-action="close"]')&&(L.uploading||L.dirty&&!confirm('לסגור בלי לפרסם?'))){e.stopImmediatePropagation();e.preventDefault();if(!d.open)d.showModal();}},true);
    d.addEventListener('close',()=>{if(d.dataset.teardown)return;if(L.draft&&!L.uploading){const id=L.draft;L.draft=null;api({id},'DELETE').catch(()=>{});}L.selected.forEach(f=>{if(f.url)URL.revokeObjectURL(f.url);});L.selected=[];L.dirty=false;});
    el('libraryComposerForm').addEventListener('input',()=>L.dirty=true);return d;
  }
  function openComposer(item=null){
    const d=composerDialog();if(d.open)return;
    L.draft=null;L.selected=[];L.thumbAttempted=false;L.editId=item?.id||null;L.dirty=false;const form=el('libraryComposerForm');form.reset();
    if(item)for(const key of ['title','category','description','age_range','duration_minutes','materials','adaptations','link_url'])if(form.elements[key])form.elements[key].value=item[key]||'';
    form.elements.tags.value=(item?.tags||[]).join(', ');form.elements.category.value=item?.category||'meeting';
    el('libraryDropZone').classList.toggle('hidden',Boolean(item));el('libraryPublishBtn').textContent=item?'שמירת שינויים':'פרסום בספרייה';el('libraryUploadStatus').textContent=item?'עריכת פרטי התוכן':'התוכן משותף עם צוות המעון';renderSelected();d.showModal();
  }
  const allowed=/\.(jpe?g|png|webp|gif|avif|heic|heif|mp4|mov|m4v|webm|mp3|wav|ogg|m4a|aac|flac|pdf|docx?|pptx?|xlsx?|csv|txt|rtf|odt|ods|odp|zip|rar|7z)$/i;
  function addFiles(files){
    if(L.uploading||L.editId)return;
    for(const file of files){if(!allowed.test(file.name)) {toast(`הסוג של ״${file.name}״ אינו נתמך`,true);continue;}if(!file.size||file.size>50*1024*1024){toast(`״${file.name}״ גדול מדי. המקסימום הוא 50MB`,true);continue;}if(L.selected.length>=10){toast('אפשר לצרף עד 10 קבצים לפרסום',true);break;}if(L.selected.some(e=>e.file.name===file.name&&e.file.size===file.size))continue;L.selected.push({file,id:crypto.randomUUID(),progress:0,status:'מוכן להעלאה',url:decodableImage(file)?URL.createObjectURL(file):null});L.dirty=true;}
    renderSelected();
  }
  function renderSelected(){const node=el('librarySelectedFiles');if(!node)return;node.innerHTML=L.selected.map((entry,i)=>`<div class="lib-selected-file">${entry.url?`<img src="${esc(entry.url)}" alt="" />`:icon('file')}<div><strong>${esc(entry.file.name)}</strong><small>${sizeText(entry.file.size)} · ${esc(entry.status)}</small><progress value="${entry.progress}" max="100" aria-label="התקדמות ${esc(entry.file.name)}"></progress></div><button type="button" data-remove-file="${i}" aria-label="הסרת ${esc(entry.file.name)}" ${L.uploading||entry.reserved?'disabled':''}>${icon('close')}</button></div>`).join('');}
  function uploadXHR(url,file,mime,onProgress){return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();activeUploads.add(xhr);xhr.onloadend=()=>activeUploads.delete(xhr);xhr.onabort=()=>reject(stale());xhr.open('PUT',url);xhr.timeout=180000;xhr.setRequestHeader('Content-Type',mime);xhr.setRequestHeader('x-upsert','false');
    xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.round(e.loaded/e.total*100));};
    xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(new Error('העלאת הקובץ נכשלה. אפשר ללחוץ שוב על פרסום כדי לנסות מחדש'));
    xhr.onerror=xhr.ontimeout=()=>reject(new Error('החיבור נקטע במהלך ההעלאה. הקבצים נשמרו לניסיון חוזר'));xhr.send(file);
  });}
  async function thumbnail(){
    const entry=L.selected.find(e=>decodableImage(e.file));if(!entry)return null;
    try{const image=new Image();const url=entry.url||URL.createObjectURL(entry.file);image.src=url;await image.decode();const canvas=document.createElement('canvas'),ratio=Math.min(1,640/image.width,480/image.height);canvas.width=Math.round(image.width*ratio);canvas.height=Math.round(image.height*ratio);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.75));return blob&&blob.size<=524288?new File([blob],'תמונה-מקדימה.jpg',{type:'image/jpeg'}):null;}catch{return null;}
  }
  async function publish(event){
    event.preventDefault();if(L.uploading)return;
    const form=event.currentTarget,body=Object.fromEntries(new FormData(form));body.tags=body.tags.split(',').map(s=>s.trim()).filter(Boolean);
    if(!L.editId&&!body.description.trim()&&!body.link_url&&!L.selected.length)return toast('יש להוסיף תיאור, קישור או קובץ',true);
    const generation=sessionGeneration,button=el('libraryPublishBtn');L.uploading=true;busy(button,true);form.querySelectorAll('input,textarea,select').forEach(n=>n.disabled=true);
    try{
      if(L.editId){await api({...body,id:L.editId},'PATCH');L.dirty=false;el('libraryComposerDialog').close();toast('התוכן עודכן');refresh({force:true});if(L.detail?.id===L.editId)openItem(L.editId);return;}
      if(!L.draft){const result=await api({action:'create',...body});L.draft=result.item.id;}else await api({...body,id:L.draft},'PATCH');
      for(let i=0;i<L.selected.length;i++){
        const entry=L.selected[i];if(entry.done)continue;
        el('libraryUploadStatus').textContent=`מעלים קובץ ${i+1} מתוך ${L.selected.length}`;entry.status='מעלה…';renderSelected();
        const wasReserved=entry.reserved;
        const signed=await api({action:'upload',id:L.draft,file_id:entry.id,file:{name:entry.file.name,size:entry.file.size,type:entry.file.type}});entry.reserved=true;
        if(!signed.uploaded){
          // A lost completion response should not re-upload an already stored object.
          if(wasReserved){try{await api({action:'file_uploaded',id:L.draft,file_id:entry.id});entry.done=true;entry.progress=100;entry.status='הועלה';renderSelected();continue;}catch{/* Retry upload if the object did not arrive. */}}
          await uploadXHR(signed.url,entry.file,signed.mime_type,p=>{entry.progress=p;renderSelected();});entry.sent=true;
          await api({action:'file_uploaded',id:L.draft,file_id:entry.id});
        }
        entry.done=true;entry.progress=100;entry.status='הועלה';renderSelected();
      }
      if(L.thumbNeedsCleanup){await api({action:'discard_thumbnail',id:L.draft});L.thumbNeedsCleanup=false;L.thumbAttempted=true;}
      if(!L.thumbAttempted){const file=await thumbnail();if(generation!==sessionGeneration)return;if(file){try{const signed=await api({action:'upload',id:L.draft,thumbnail:true,file:{name:file.name,size:file.size,type:file.type}});await uploadXHR(signed.url,file,'image/jpeg',()=>{});await api({action:'file_uploaded',id:L.draft,file_id:signed.file_id});}catch(e){if(generation!==sessionGeneration)return;L.thumbNeedsCleanup=true;await api({action:'discard_thumbnail',id:L.draft});L.thumbNeedsCleanup=false;}}L.thumbAttempted=true;}
      el('libraryUploadStatus').textContent='מפרסמים את התוכן…';await api({action:'publish',id:L.draft});L.draft=null;L.dirty=false;L.thumbAttempted=false;L.uploading=false;el('libraryComposerDialog').close();toast('התוכן נוסף לספרייה. תודה על השיתוף!');await refresh({force:true});
    }catch(e){if(generation!==sessionGeneration)return;el('libraryUploadStatus').textContent=e.message;toast(e.message,true);button.textContent='ניסיון נוסף לפרסום';}
    finally{if(generation===sessionGeneration){L.uploading=false;busy(button,false);form.querySelectorAll('input,textarea,select').forEach(n=>n.disabled=false);renderSelected();}}
  }
  async function handleAction(event){
    const button=event.target.closest('[data-lib-action]');if(!button)return;
    const action=button.dataset.libAction;if(action==='close')return;
    if(action==='retry')return refresh({force:true});
    const id=button.closest('[data-lib-id]')?.dataset.libId||L.detail?.id,item=find(id);
    if(action==='new')return openComposer();if(action==='clear'){L.q='';L.category='';el('librarySearch').value='';return setFilter();}
    if(action==='tag'){L.q=button.dataset.tag;el('librarySearch').value=L.q;return setFilter();}
    if(action==='open')return openItem(id);if(action==='like')return reaction(id,'like',button);if(action==='tried')return reaction(id,'tried',button);if(action==='save'&&item)return saveDialog(item);if(action==='share'&&item)return shareLink(item);
    const file=detailFiles.find(f=>f.id===button.closest('[data-file-id]')?.dataset.fileId);
    if(action==='download'&&file)return download(file,button);if(action==='prepare-share'&&file)return prepareShare(file,button);
    if(action==='edit'&&item)return openComposer(item);
    busy(button,true);
    try{
      if(action==='delete'){if(!confirm('להסיר את התוכן והקבצים מהספרייה?'))return;await api({id},'DELETE');detailDialog().close();await refresh({force:true});toast('התוכן הוסר');}
      if(action==='pin'){await api({action:'pin',id,value:!item.is_pinned});await openItem(id);refresh({force:true});}
      if(action==='delete-comment'){if(!confirm('להסיר את התגובה?'))return;await api({action:'delete_comment',id,comment_id:button.dataset.commentId});button.closest('.lib-comment').remove();updateItem(id,{comments_count:Math.max(0,(Number(item.comments_count)||0)-1)});}
    }catch(e){toast(e.message,true);}finally{busy(button,false);}
  }
  panel.addEventListener('click',handleAction);document.addEventListener('click',e=>{if(e.target.closest('#libraryDetailDialog'))handleAction(e);});
  el('libraryCategories').onclick=e=>{const b=e.target.closest('[data-lib-category]');if(b){L.category=b.dataset.libCategory;setFilter();}};
  el('libraryViews').onclick=e=>{const b=e.target.closest('[data-lib-view]');if(b){L.view=b.dataset.libView;L.collection='';setFilter();}};
  el('librarySearch').oninput=e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{L.q=e.target.value.trim();setFilter();},250);};
  el('librarySort').onchange=e=>{L.sort=e.target.value;setFilter();};el('libraryCollectionFilter').onchange=e=>{L.collection=e.target.value;setFilter();};
  el('libraryUploadBtn').onclick=()=>openComposer();el('libraryRefreshBtn').onclick=()=>refresh({force:true});el('libraryLoadMore').onclick=()=>refresh({append:true});
  window.addEventListener('beforeunload',e=>{if(L.uploading||L.dirty){e.preventDefault();e.returnValue='';}});
  window.HadasLibrary={
    open(){if(!state.profile)return;if(L.owner!==state.profile.id){this.reset();L.owner=state.profile.id;}refresh();const id=new URLSearchParams(location.search).get('library');if(id&&!L.deepOpened){L.deepOpened=true;openItem(id);}},openItem,refresh,
    reset(){sessionGeneration++;L.revision++;detailRevision++;shareRevision++;activeUploads.forEach(xhr=>xhr.abort());activeUploads.clear();clearTimeout(refreshTimer);clearTimeout(searchTimer);L.selected.forEach(f=>{if(f.url)URL.revokeObjectURL(f.url);});
      document.querySelectorAll('.lib-dialog').forEach(d=>{d.dataset.teardown='true';if(d.open)d.close();d.remove();});
      Object.assign(L,{items:[],total:0,collections:[],loadedAt:0,loading:false,owner:null,detail:null,deepOpened:false,q:'',category:'',view:'all',collection:'',sort:'new',draft:null,selected:[],editId:null,uploading:false,dirty:false,thumbAttempted:false,thumbNeedsCleanup:false,error:null});L.urlCache.clear();detailFiles=[];preparedFile=null;el('librarySearch').value='';el('librarySort').value='new';el('libraryGrid').innerHTML='';
    },
    handleRealtime(topic){if(!String(topic).includes('library'))return false;L.loadedAt=0;clearTimeout(refreshTimer);if(state.activeTab==='library'&&!document.hidden)refreshTimer=setTimeout(()=>refresh({force:true}).then(refreshDetailSocial),450);return true;}
  };
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.activeTab==='library'&&state.profile&&L.loadedAt===0)refresh();});
})();
