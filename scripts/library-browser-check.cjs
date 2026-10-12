// Real browser behavior check with deterministic API fixtures; no production data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.HADAS_CHROME_PATH?{executablePath:process.env.HADAS_CHROME_PATH}:{})});
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
 page.on('pageerror',e=>console.error('PAGEERROR',e.message));
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.match(html,/id="libraryPanel"/,'library panel exists');
 const panel=html.slice(html.indexOf('<section id="libraryPanel"'),html.indexOf('</section>',html.indexOf('<section id="libraryPanel"'))+10).replace('class="panel"','class="panel active"');
 const ITEM='11111111-1111-4111-8111-111111111111';
 let items=[{id:ITEM,created_by:'employee',title:'מפגש חוש הראייה',description:'פנס וצבעים',category:'meeting',author_name:'לינור',tags:['חושים'],files:[],likes_count:0,tried_count:0,comments_count:0,published_at:new Date().toISOString()}],calls=[],thumbnailPending=false,cleanupAttempts=0,published=0;
 await page.route('https://fixture.test/**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname.endsWith('.js')||u.pathname.endsWith('.css'))return route.fulfill({body:fs.readFileSync(path.join(root,u.pathname.slice(1))),contentType:u.pathname.endsWith('.js')?'text/javascript; charset=utf-8':'text/css'});
  if(u.pathname==='/storage/success')return route.fulfill({status:200,json:{ok:true}});
  if(u.pathname==='/storage/failure')return route.fulfill({status:503,json:{error:'upload failed'}});
  if(u.pathname==='/api/library'){
   const b=route.request().postDataJSON()||{};calls.push({method:route.request().method(),q:u.searchParams.get('q'),body:b});
   if(b.action==='create')return route.fulfill({json:{ok:true,item:{id:ITEM}}});
   if(b.action==='upload'){if(b.thumbnail)thumbnailPending=true;return route.fulfill({json:{ok:true,file_id:b.file_id||'thumbnail',url:'https://fixture.test/storage/'+(b.thumbnail?'failure':'success'),mime_type:b.thumbnail?'image/jpeg':b.file.type}});}
   if(b.action==='file_uploaded')return route.fulfill({json:{ok:true}});
   if(b.action==='discard_thumbnail'){cleanupAttempts++;if(cleanupAttempts===1)return route.fulfill({status:503,json:{error:'cleanup interrupted'}});thumbnailPending=false;return route.fulfill({json:{ok:true}});}
   if(b.action==='publish'){if(thumbnailPending)return route.fulfill({status:409,json:{error:'incomplete thumbnail'}});published++;return route.fulfill({json:{ok:true,item:{id:ITEM}}});}
   if(route.request().method()==='PATCH'||route.request().method()==='DELETE')return route.fulfill({json:{ok:true}});
   if(b.action==='covers'||b.action==='file_urls')return route.fulfill({json:{ok:true,files:[]}});
   if(b.action==='reaction'){items[0].liked=b.value;items[0].likes_count=b.value?1:0;return route.fulfill({json:{ok:true}});}
   if(b.action==='bookmark'){items[0].saved_collection=b.value?b.collection:null;return route.fulfill({json:{ok:true}});}
   if(b.action==='comment'){items[0].comments_count++;return route.fulfill({json:{ok:true,comment:{id:'comment',employee_id:'employee',content:b.content,created_at:new Date().toISOString()}}});}
   if(u.searchParams.get('id'))return route.fulfill({json:{ok:true,item:items[0],canManage:true,comments:[]}});
   return route.fulfill({json:{ok:true,items:u.searchParams.get('q')==='אין תוצאה'?[]:items,total:u.searchParams.get('q')==='אין תוצאה'?0:items.length,collections:['חושים']}});
  }
  return route.fulfill({body:'<!doctype html><html dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/library.css"></head><body>'+panel+'<script>const state={profile:{id:"employee",full_name:"לינור",role:"employee"},activeTab:"library"};function isManager(){return false;}function escapeHtml(x){return String(x??"").replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;"}[c]||"&quot;"));}function showToast(x){window.lastToast=x;}async function apiFetch(url,o={}){const r=await fetch(url,{method:o.method||"GET",headers:{"Content-Type":"application/json"},body:o.body?JSON.stringify(o.body):undefined});const data=await r.json();if(!r.ok)throw new Error(data.error||"failed");return data;}function switchTab(){}</script><script src="/library.js"></script></body></html>',contentType:'text/html'});
 });
 page.on('dialog',d=>d.accept());
 await page.goto('https://fixture.test/');
 await page.evaluate(()=>window.HadasLibrary.open());
 await page.locator('#libraryGrid').getByText('מפגש חוש הראייה',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile has no horizontal overflow');
 await page.locator('[data-lib-action="like"]').first().click();
 await page.waitForFunction(()=>document.querySelector('[data-lib-action="like"]').getAttribute('aria-pressed')==='true');
 assert.equal(calls.filter(c=>c.body.action==='reaction').length,1);
 await page.locator('[data-lib-action="open"]').first().click();
 await page.locator('#libraryDetailDialog[open]').waitFor();
 await page.locator('#libraryCommentInput').fill('עבד מצוין עם פנס');
 await page.locator('#libraryCommentForm button[type="submit"]').click();
 await page.getByText('עבד מצוין עם פנס',{exact:true}).waitFor();
 await page.locator('#libraryDetailDialog [data-lib-action="close"]').click();
 await page.locator('#librarySearch').fill('אין תוצאה');
 try {await page.getByText('לא מצאנו תוכן מתאים',{exact:true}).waitFor({timeout:5000});} catch(e) {console.log('DEBUG',JSON.stringify(calls));console.log(await page.locator('#libraryGrid').innerText());await page.screenshot({path:'/tmp/hadas-library-error.png',fullPage:true});await browser.close();throw e;}
 await page.locator('#librarySearch').fill('');
 await page.locator('#libraryGrid').getByText('מפגש חוש הראייה',{exact:true}).waitFor();
 await page.screenshot({path:'/tmp/hadas-library-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 await page.screenshot({path:'/tmp/hadas-library-desktop.png',fullPage:true});
 await page.locator('#libraryUploadBtn').click();
 await page.locator('#libraryComposerDialog[open]').waitFor();
 await page.locator('#libraryFileInput').setInputFiles({name:'פעילות.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from('office-test')});
 await page.getByText('פעילות.docx',{exact:true}).waitFor();
 await page.locator('#libraryComposerDialog [data-lib-action="close"]').click();
 const beforeReset=calls.filter(c=>c.method==='GET').length;
 await page.evaluate(()=>{window.HadasLibrary.refresh({force:true});window.HadasLibrary.reset();window.HadasLibrary.open();});
 await page.waitForTimeout(200);
 assert.equal(calls.filter(c=>c.method==='GET').length-beforeReset,2,'reset must permit a new load while an old one is pending');
 await page.locator('#libraryGrid').getByText('מפגש חוש הראייה',{exact:true}).waitFor({timeout:5000});
 await page.locator('#libraryUploadBtn').click();
 await page.locator('#libraryComposerForm [name="title"]').fill('בדיקת העלאה עם ניסיון חוזר');
 await page.locator('#libraryFileInput').setInputFiles({name:'תמונה.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});
 await page.locator('#libraryPublishBtn').click();
 await page.getByRole('button',{name:'ניסיון נוסף לפרסום',exact:true}).waitFor();
 await page.locator('#libraryPublishBtn').click();
 await page.waitForFunction(()=>!document.querySelector('#libraryComposerDialog')?.open);
 assert.equal(cleanupAttempts,2,'failed thumbnail cleanup is retried before publication');assert.equal(published,1);
 await page.locator('#libraryUploadBtn').click();await page.locator('#libraryComposerForm [name="title"]').fill('טיוטה פרטית');
 await page.evaluate(()=>window.HadasLibrary.reset());assert.equal(await page.locator('.lib-dialog').count(),0,'reset removes private modals and forms');
 console.log('PASS: mobile/desktop layout, search, like, detail, comment and Office selection');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
