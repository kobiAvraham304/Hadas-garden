const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.HADAS_CHROME_PATH?{executablePath:process.env.HADAS_CHROME_PATH}:{})});
 for(const role of ['employee','scheduler']){
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];let expired=false;
  page.on('pageerror',e=>errors.push(e.message));
  const profile={id:'employee',role,full_name:'משתמש בדיקה',job_title:role==='employee'?'סייעת':'גננת',active:true,must_change_password:false,onboarding_completed:true,onboarding_required:false,can_create_content:role!=='employee',schedule_scope:role==='employee'?'personal':'full',can_manage_daily_operations:role!=='employee'};
  const data={ok:true,profile,classes:[],employees:[profile],settings:{opening_time:'07:30',closing_time:'15:30',friday_closing_time:'12:00'},publication:null,dailyScheduleMeta:null};
  for(const key of ['constraints','shifts','todayShifts','attendance','todayAttendance','todayOperations','requests','requestMessages','acknowledgements','announcements','announcementRecipients','announcementReads','tasks','taskAssignees','calendarEvents','notifications','scheduleChanges','scheduleAbsences','dailyOperations','dailyShifts','dailyAttendance'])data[key]=[];
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname!=='fixture.test')return route.fulfill({body:'',contentType:'text/javascript; charset=utf-8'});
   if(u.pathname==='/api/config')return route.fulfill({json:{ok:true,version:'0.40.0',supabaseUrl:'https://fixture.supabase.co',supabasePublishableKey:'fixture'}});
   if(u.pathname==='/api/auth-me')return route.fulfill({json:{ok:true,profile,csrfToken:'csrf'}});
   if(expired&&u.pathname==='/api/data')return route.fulfill({status:401,json:{ok:false,error:'session expired'}});
   if(u.pathname==='/api/library')return route.fulfill({json:{ok:true,items:[],total:0,collections:[]}});
   if(u.pathname.startsWith('/api/'))return route.fulfill({json:{...data,preferences:{generalEnabled:false,smartEnabled:false},subscriptions:[]}});
   const local=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
   if(!fs.existsSync(local))return route.fulfill({status:404,body:''});
   const ext=path.extname(local),type={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'}[ext]||'text/plain';
   return route.fulfill({body:fs.readFileSync(local),contentType:type});
  });
  await page.goto('https://fixture.test/');
  await page.locator('#appShell:not(.hidden)').waitFor({timeout:15000});
  await page.locator('#mobileMoreBtn').click();
  await page.locator('[data-more-tab="library"]').click();
  await page.locator('#libraryPanel.active').waitFor();
  await page.getByText('הספרייה מתחילה איתנו',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,role+' mobile has no overflow');
  await page.locator('#libraryUploadBtn').click();await page.locator('#libraryComposerDialog[open]').waitFor();
  await page.locator('#libraryComposerDialog [data-lib-action="close"]').click();
  await page.locator('[data-tab="schedule"]').click();await page.locator('#schedulePanel.active').waitFor();
  await page.locator('[data-tab="requests"]').click();await page.locator('#requestsPanel.active').waitFor();
  await page.locator('[data-tab="announcements"]').click();await page.locator('#announcementsPanel.active').waitFor();
  await page.locator('#mobileMoreBtn').click();await page.locator('[data-more-tab="calendar"]').click();await page.locator('#calendarPanel.active').waitFor();
  await page.locator('#mobileMoreBtn').click();await page.locator('[data-more-tab="attendance"]').click();await page.locator('#attendancePanel.active').waitFor();
  if(role==='scheduler'){await page.locator('#mobileMoreBtn').click();await page.locator('[data-more-tab="daily"]').click();await page.locator('#dailyPanel.active').waitFor();await page.locator('#mobileMoreBtn').click();await page.locator('[data-more-tab="employees"]').click();await page.locator('#employeesPanel.active').waitFor();}
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-tab="library"]').click();await page.getByText('הספרייה מתחילה איתנו',{exact:true}).waitFor();
  await page.screenshot({path:`/tmp/hadas-system-${role}.png`,fullPage:true});
  await page.locator('#libraryUploadBtn').click();await page.locator('#libraryComposerForm [name="title"]').fill('private draft');expired=true;
  await page.evaluate(()=>apiFetch('/api/data').catch(()=>{}));
  assert.equal(await page.locator('.lib-dialog').count(),0,'expired session tears down library modals');await page.locator('#loginScreen:not(.hidden)').waitFor();
  assert.deepEqual(errors,[],role+' uncaught browser errors');console.log('PASS full app bootstrap and main screens, mobile/desktop role '+role);
  await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
