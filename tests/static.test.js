const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function allProjectText(){
  const files=fs.readdirSync(root,{recursive:true,withFileTypes:true})
    .filter(e=>e.isFile()).map(e=>path.join(e.parentPath||e.path,e.name))
    .filter(f=>!f.includes(`${path.sep}tests${path.sep}`)&&!f.endsWith('.zip'))
    .filter(f=>/\.(js|html|sql|md|json|css|example)$/.test(f));
  return files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
}

test('all fixed ID selectors used by app.js exist in index.html', () => {
  const html = read('index.html'); const js = read('app.js');
  const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]));
  const used = new Set([...js.matchAll(/\$\(["']#([A-Za-z0-9_-]+)["']/g)].map(m=>m[1]));
  assert.deepEqual([...used].filter(id=>!ids.has(id)), []);
});

test('project contains phone login only and no bundled secret value', () => {
  const content=allProjectText();
  assert.doesNotMatch(content, /@hadas\.local/i);
  assert.doesNotMatch(content, /signInWithPassword|auth\.signIn/i);
  assert.doesNotMatch(content, /sb_secret_[A-Za-z0-9_-]{20,}/i);
  assert.match(read('index.html'), /מספר טלפון/);
});

test('setup complexity remains removed', () => {
  const content=allProjectText(); const vercel=JSON.parse(read('vercel.json'));
  assert.equal(fs.existsSync(path.join(root,'setup.html')),false);
  assert.doesNotMatch(read('README.md'),/BOOTSTRAP_TOKEN|SESSION_PEPPER|APP_URL|\/setup/);
  assert.ok(!vercel.rewrites.some(item=>item.source==='/setup'));
  const vars=[...read('.env.example').matchAll(/^([A-Z0-9_]+)=/gm)].map(m=>m[1]);
  assert.deepEqual(vars,['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY']);
  assert.doesNotMatch(content,/process\.env\.(BOOTSTRAP_TOKEN|SESSION_PEPPER|APP_URL)/);
});

test('version, security headers and health route are consistent', () => {
  const pkg=JSON.parse(read('package.json')); const vercel=JSON.parse(read('vercel.json'));
  assert.equal(pkg.version,'0.27.0'); assert.equal(Object.hasOwn(pkg,'engines'),false);
  assert.ok(vercel.rewrites.some(item=>item.source==='/health'&&item.destination==='/health.html'));
  const raw=read('vercel.json');
  for(const header of ['Content-Security-Policy','X-Content-Type-Options','X-Frame-Options','Cross-Origin-Resource-Policy']) assert.match(raw,new RegExp(header));
  for(const file of ['app.js','handlers/config.js','handlers/health.js','package.json','supabase/schema.sql']) assert.doesNotMatch(read(file),/version[^\n]*0\.4\.3/i,file);
});

test('initial accounts and schema version are present in clean installer', () => {
  const schema=read('supabase/schema.sql');
  assert.match(schema,/אילנית זאדייב/); assert.match(schema,/\+972544594513/); assert.match(schema,/'admin'/);
  assert.match(schema,/לינור אברהם/); assert.match(schema,/\+972542521780/); assert.match(schema,/'scheduler'/);
  assert.match(schema,/v_initial_hash/); assert.match(schema,/'0\.24\.0'/);
  assert.match(schema,/ENABLE ROW LEVEL SECURITY/i); assert.match(schema,/REVOKE ALL ON TABLE/i);
  assert.match(schema,/hadas_realtime_public_read/); assert.match(schema,/ALTER PUBLICATION supabase_realtime ADD TABLE/i);
});

test('new product name is used across main interfaces', () => {
  for(const file of ['index.html','README.md','VERSION.md','supabase/schema.sql']) assert.match(read(file),/מערכת ניהול שיבוצים מעון הדס/,file);
  assert.doesNotMatch(read('index.html'),/מערכת השיבוצים של מעון הדס/);
});

test('documents module and navigation are removed from runtime', () => {
  assert.equal(fs.existsSync(path.join(root,'handlers','documents.js')),false);
  assert.doesNotMatch(read('index.html'),/data-tab="documents"|id="documentsPanel"|מסמכים/);
  assert.doesNotMatch(read('api/index.js'),/documents/);
  assert.doesNotMatch(read('vercel.json'),/api\/documents/);
  assert.doesNotMatch(read('app.js'),/renderDocuments|documentsList|documentDialog/);
  assert.doesNotMatch(read('lib/server.js'),/StorageBucket|storage\s*=/);
});

test('schedule has prepare-and-publish flow without temporary or final options', () => {
  const app=read('app.js'); const html=read('index.html'); const shifts=read('handlers/shifts.js');
  assert.match(html,/id="publishScheduleBtn"/);
  assert.match(html,/פרסום השיבוץ/);
  assert.doesNotMatch(html,/שיבוץ זמני|שיבוץ סופי/);
  assert.match(shifts,/publish_preview/);
  assert.match(shifts,/hadas_schedule_changes/);
  assert.match(shifts,/status: 'draft'/);
  assert.match(shifts,/status: 'published'/);
  assert.match(app,/renderPublicationState/);
  assert.match(app,/changeRowHtml/);
});

test('client includes responsive week, day and personal schedule views', () => {
  const app=read('app.js'); const css=read('styles.css'); const html=read('index.html');
  assert.match(app,/timeoutSignal/); assert.match(app,/state\.refreshing/);
  for(const mode of ['week','day','mine']) assert.match(html,new RegExp(`data-mode="${mode}"`));
  assert.match(app,/renderScheduleWeek/); assert.match(app,/renderScheduleDay/); assert.match(app,/renderScheduleMine/);
  assert.match(app,/copy_preview/); assert.match(app,/copy_previous/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/min-height:44px/);
  assert.match(css,/prefers-reduced-motion/);
});

test('all time fields and rendered times are isolated left-to-right', () => {
  const app=read('app.js'); const css=read('styles.css');
  assert.match(app,/<bdi class="time-value">/);
  assert.match(css,/input\[type="time"\][^}]*direction:ltr/);
  assert.match(css,/\.time-value[^}]*direction:ltr/);
  assert.match(css,/unicode-bidi:isolate/);
});

test('requests, announcements, tasks and employee management have rich controls', () => {
  const html=read('index.html'); const app=read('app.js'); const css=read('styles.css');
  assert.match(html,/request-type-card/);
  assert.match(html,/employeeStatusFilter/); assert.match(html,/employeeClassFilter/); assert.match(html,/employeeTypeFilter/);
  assert.match(app,/announcement_employee_ids/); assert.match(app,/task_employee_ids/);
  assert.match(html,/content-creator-only/);
  assert.match(app,/employeePickerHtml/);
  assert.match(css,/\.request-card/); assert.match(css,/\.employee-card-grid/);
});

test('calendar is a 42-day monthly grid with navigation and event details', () => {
  const html=read('index.html'); const app=read('app.js'); const css=read('styles.css');
  for(const id of ['prevMonthBtn','todayMonthBtn','nextMonthBtn','calendarMonthLabel','calendarGrid','calendarEventDialog']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(app,/Array\.from\(\{ length: 42 \}/);
  assert.match(app,/openCalendarEvent/);
  assert.match(css,/\.calendar-grid/);
});

test('dashboard does not show a Vercel deployment notice', () => {
  const dashboard=read('index.html').match(/<section id="dashboardPanel"[\s\S]*?<\/section>/)?.[0]||'';
  assert.doesNotMatch(dashboard,/Vercel|ורסל/i);
});

test('non-manager employee payload excludes private employment fields', () => {
  const dataApi=read('handlers/data.js'); const baseBlock=dataApi.match(/const base = \{([\s\S]*?)\n  \};/)?.[1]||'';
  assert.doesNotMatch(baseBlock,/weekly_hours|employment_percent|fixed_day_off|started_at|ended_at|admin_notes|phone/);
  assert.match(dataApi,/if \(!manager\) return base/);
});

test('health page is CSP-compatible and references current migration', () => {
  const html=read('health.html'); const js=read('health.js');
  assert.match(html,/src="\/health\.js"/); assert.doesNotMatch(html,/<script>[^<]/);
  assert.match(js,/update-v0\.27\.0\.sql/);
});

test('runtime avoids unsafe dynamic JavaScript and inline DOM handlers', () => {
  assert.doesNotMatch(read('app.js'),/\beval\s*\(|new Function|document\.write/);
  assert.doesNotMatch(read('index.html'),/\son[a-z]+\s*=/i);
});

test('Vercel Hobby function count stays safely below the 12-function limit', () => {
  const apiFiles=fs.readdirSync(path.join(root,'api')).filter(file=>file.endsWith('.js'));
  const vercel=JSON.parse(read('vercel.json'));
  assert.deepEqual(apiFiles,['index.js']);
  assert.deepEqual(Object.keys(vercel.functions),['api/index.js']);
  assert.ok(apiFiles.length <= 12);
});


test('nursery-friendly visual system uses varied nursery-friendly colors and mobile navigation sheet', () => {
  const html=read('index.html'); const css=read('styles.css'); const app=read('app.js');
  for(const token of ['--primary:#6f72d9','--coral:#ef887f','--sky:#6dbbd9','--sun:#e9b94e','--lilac:#a989e8']) assert.match(css,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(html,/id="mobileMoreSheet"/); assert.match(html,/id="mobileMoreBtn"/);
  assert.match(css,/\.mobile-secondary\{display:none!important\}/);
  assert.match(app,/openMobileMore/); assert.match(app,/secondaryTabs/);
});

test('schedule shows a safe vacation and availability table for every day', () => {
  const html=read('index.html'); const app=read('app.js'); const data=read('handlers/data.js'); const schedule=read('lib/schedule.js');
  assert.match(html,/id="scheduleAbsences"/);
  assert.match(app,/renderScheduleAbsences/); assert.match(app,/renderAbsenceDay/);
  assert.match(data,/scheduleAbsences/); assert.match(data,/buildScheduleAvailability/); assert.match(schedule,/absence_type/); assert.match(schedule,/fixed_day_off/);
  assert.doesNotMatch(data,/scheduleAbsences[\s\S]{0,180}reason/);
});

test('request and employee filters use accessible chip controls', () => {
  const html=read('index.html'); const app=read('app.js'); const css=read('styles.css');
  for(const id of ['requestStatusChips','employeeStatusChips','employeeTypeChips']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(app,/handleFilterChip/); assert.match(app,/syncFilterChips/); assert.match(css,/\.filter-chip\.active/);
});

test('mobile layout pins navigation to the bottom and keeps roster rows readable', () => {
  const css=read('styles.css');
  assert.match(css,/\.main-nav\{[\s\S]*?position:fixed;[\s\S]*?inset:auto 0 0 0;[\s\S]*?top:auto;/);
  assert.match(css,/\.employee-line\{[\s\S]*?grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(css,/\.calendar-event\{[\s\S]*?min-height:34px/);
});

test('0.8 mobile weekly schedule uses six readable accordion day cards instead of the wide table', () => {
  const app=read('app.js'); const css=read('styles.css');
  assert.match(app,/renderMobileWeekDay/); assert.match(app,/renderMobileWeekClass/);
  assert.match(app,/schedule-mobile-week/); assert.match(app,/schedule-desktop-week/);
  assert.match(app,/Array\.from\(\{ length: 6 \}/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*?\.schedule-desktop-week\{display:none!important\}/);
  assert.match(css,/\.mobile-week-day/); assert.match(css,/\.mobile-week-day>summary/);
});

test('week navigation uses lightweight endpoint, cache and adjacent prefetching', () => {
  const app=read('app.js'); const shifts=read('handlers/shifts.js');
  assert.match(app,/weekCache:\s*new Map\(\)/); assert.match(app,/weekInflight:\s*new Map\(\)/); assert.match(app,/fetchScheduleWeek/);
  assert.match(app,/prefetchAdjacentWeeks/); assert.match(app,/renderAll\(\); prefetchAdjacentWeeks\(\)/); assert.match(app,/refreshScheduleWeek/);
  assert.match(app,/\/api\/shifts\?week_start=/);
  assert.match(shifts,/if \(req\.method === 'GET'\)/);
  assert.match(shifts,/let scheduleAbsences = buildScheduleAvailability/);
  assert.match(shifts,/scheduleAbsences,/);
});

test('calendar days are directly selectable for creating events with keyboard support', () => {
  const app=read('app.js'); const css=read('styles.css');
  assert.match(app,/data-calendar-date/); assert.match(app,/handleCalendarKeydown/);
  assert.match(app,/openCalendarDialog\(\{ event_date: day\.dataset\.calendarDate \}\)/);
  assert.match(css,/\.calendar-day\.selectable/); assert.match(css,/\.calendar-day-tools/);
});

test('staffing settings provide presets, validation guidance and a live time preview', () => {
  const html=read('index.html'); const app=read('app.js'); const css=read('styles.css');
  for(const id of ['settingsPresetBtn','settingsPreview']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(app,/renderSettingsPreview/); assert.match(app,/applyDefaultStandards/);
  assert.match(app,/morningRequired/); assert.match(app,/morning_end_time/); assert.match(css,/staffing-stepper/);
});

test('mobile dialogs and request type controls are constrained to the viewport', () => {
  const css=read('styles.css');
  assert.match(css,/dialog\.modal\{[\s\S]*?position:fixed;[\s\S]*?inset:auto 8px/);
  assert.match(css,/\.request-type-grid\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/overflow-wrap:anywhere/);
});

test('busy buttons restore their original markup so mobile icon labels stay hidden correctly', () => {
  const app=read('app.js');
  assert.match(app,/dataset\.originalHtml/);
  assert.match(app,/button\.innerHTML = button\.dataset\.originalHtml/);
  assert.doesNotMatch(app,/dataset\.originalText = button\.textContent/);
});

test('0.8 staffing errors and alerts are grouped, clickable and focus the relevant correction screen', () => {
  const app=read('app.js'); const css=read('styles.css');
  assert.match(app,/compactProblemRanges/);
  assert.match(app,/scheduleIssueMap:\s*new Map\(\)/);
  assert.match(app,/handleScheduleWarningClick/);
  assert.match(app,/data-issue-id/);
  assert.match(app,/data-publish-date/);
  assert.match(css,/\.actionable-warning/);
  assert.doesNotMatch(app,/חסר גנן\/ת\/גנן/);
});

test('0.8 mobile weekly view opens no day by default and enforces one open day', () => {
  const app=read('app.js');
  assert.match(app,/expandedWeekDay:\s*null/);
  assert.match(app,/const open = state\.expandedWeekDay === index/);
  assert.match(app,/const summary = event\.target\.closest\('\.mobile-week-day > summary'\)/);
  assert.match(app,/\$\$\('\.mobile-week-day'\)\.forEach\(\(item\) => \{ item\.open = false; \}\)/);
  assert.doesNotMatch(app,/addEventListener\('toggle', handleMobileWeekToggle/);
});

test('0.8 keeps the week selector sticky without breaking mobile overflow', () => {
  const css=read('styles.css');
  assert.match(css,/#schedulePanel \.schedule-heading\{[\s\S]*?position:sticky/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*?#schedulePanel \.schedule-heading\{top:68px/);
  assert.match(css,/html,body\{overflow-x:clip\}/);
});

test('0.17 weekly and monthly exports use legible landscape canvases and safe sharing', () => {
  const html=read('index.html'); const app=read('app.js');
  assert.match(html,/id="monthImageBtn"/);
  assert.match(app,/function drawWeeklyScheduleCanvas/);
  assert.match(app,/const width = 1920/);
  assert.match(app,/downloadMonthlyScheduleImage/);
  assert.match(app,/navigator\.canShare/);
  assert.match(app,/files\.push\(new File/);
  assert.match(app,/@page\{size:A4 landscape/);
  assert.match(app,/setTimeout\(\(\) => URL\.revokeObjectURL\(printUrl\), 60000\)/);
});

test('0.8 calendar navigation uses cache, latest-request protection and direct day creation', () => {
  const app=read('app.js');
  assert.match(app,/calendarCache:\s*new Map\(\)/);
  assert.match(app,/calendarRequestId/);
  assert.match(app,/if \(state\.calendarInflight\.get\(key\) === request\) state\.calendarInflight\.delete\(key\)/);
  assert.match(app,/openCalendarDialog\(\{ event_date: day\.dataset\.calendarDate \}\)/);
});

test('generic employee language is masculine or inclusive across the runtime', () => {
  const runtime=[read('app.js'),read('index.html'),read('lib/schedule.js'),...fs.readdirSync(path.join(root,'handlers')).filter(f=>f.endsWith('.js')).map(f=>read(path.join('handlers',f)))].join('\n');
  assert.doesNotMatch(runtime,/עובדת|עובדות|נשות צוות|משובצת|שובצה|הוחלפה/);
  assert.match(read('index.html'),/ניהול עובדים/);
  assert.match(read('app.js'),/employee:\s*'עובד'/);
});

test('0.9 employee management supports exact roles, multiple fixed days and per-day hours', () => {
  const html=read('index.html'); const app=read('app.js'); const employeesApi=read('handlers/employees.js'); const schema=read('supabase/schema.sql');
  for(const title of ['סייעת/ סייע','סייעת מובילה','גננת','מנהלת מעון','מזכירה','אחות']) assert.match(html,new RegExp(`value="${title}"`));
  assert.doesNotMatch(html,/name="can_lead"/);
  assert.match(html,/id="weeklyPatternFields"/);
  assert.match(html,/name="max_weekly_hours"/);
  assert.match(html,/name="assignment_mode"/);
  assert.match(app,/collectWeeklyPatterns/);
  assert.match(app,/syncShiftHoursFromPattern/);
  assert.match(employeesApi,/hadas_employee_weekly_patterns/);
  assert.match(schema,/create table if not exists public\.hadas_employee_weekly_patterns/);
  assert.match(schema,/max_weekly_hours/);
});

test('0.9 nurse and secretary content permissions and version badge are wired', () => {
  const html=read('index.html'); const app=read('app.js'); const server=read('lib/server.js'); const calendar=read('handlers/calendar.js');
  assert.match(html,/id="appVersionBadge"/);
  assert.match(app,/\['אחות','מזכירה'\]/);
  assert.match(server,/\['אחות','מזכירה'\]/);
  assert.match(calendar,/canCreateContent/);
  assert.match(html,/id="newCalendarBtn" class="primary-btn content-creator-only"/);
});

test('0.10 schedule privacy gives full view only to approved roles and personal view to assistants', () => {
  const server=read('lib/server.js'); const data=read('handlers/data.js'); const shifts=read('handlers/shifts.js'); const app=read('app.js');
  assert.match(server,/function canViewFullSchedule/);
  assert.match(server,/\['אחות','מנהלת מעון','מזכירה'\]/);
  assert.match(data,/if \(!fullScheduleViewer\) \{[\s\S]*?shifts = shifts\.filter\(\(row\) => row\.employee_id === caller\.employee\.id\)/);
  assert.match(shifts,/if \(!fullScheduleViewer\) shifts = shifts\.filter\(\(row\) => row\.employee_id === caller\.employee\.id\)/);
  assert.match(app,/state\.scheduleMode = 'mine'/);
  assert.match(app,/#scheduleMode \[data-mode="week"\], #scheduleMode \[data-mode="day"\]/);
});

test('0.10 swap requests use only day-off employees and require target approval before management', () => {
  const html=read('index.html'); const app=read('app.js'); const requests=read('handlers/requests.js'); const schema=read('supabase/schema.sql');
  assert.match(html,/עובד שנמצא ביום חופשי/);
  assert.doesNotMatch(html,/name="target_shift_id"/);
  assert.match(requests,/action === 'swap_candidates'/);
  assert.match(requests,/requestedOff\.has\(employee\.id\) \|\| pattern === 'day_off'/);
  assert.match(requests,/activeAccounts\.has\(employee\.id\)/);
  assert.match(requests,/unavailable\.has\(employee\.id\)/);
  assert.match(requests,/action === 'target_accept'/);
  assert.match(requests,/action === 'target_reject'/);
  assert.match(requests,/body\.status === 'approved' && !request\.target_approved/);
  assert.match(app,/data-action="target_accept"/);
  assert.match(app,/data-action="target_reject"/);
  assert.match(schema,/r\.target_approved is not true/);
  assert.match(schema,/set employee_id=r\.target_employee_id, status='draft'/);
});

test('0.10 vacation and sick requests support ranges and private medical certificates', () => {
  const html=read('index.html'); const app=read('app.js'); const requests=read('handlers/requests.js'); const migration=read('supabase/update-v0.10.0.sql');
  assert.match(html,/name="request_end_date"/);
  assert.match(html,/name="sick_certificate"/);
  assert.match(app,/\['leave','sick'\]\.includes/);
  assert.match(app,/fileToDataUrl/);
  assert.match(requests,/CERTIFICATE_BUCKET = 'hadas-sick-certificates'/);
  assert.match(requests,/action === 'attachment_url'/);
  assert.match(requests,/request_end_date:endDate/);
  assert.match(migration,/request_end_date date/);
  assert.match(migration,/attachment_path text/);
  assert.match(migration,/hadas-sick-certificates/);
  assert.match(migration,/public=false/);
});

test('0.10 notifications are personal, actionable and available from header and dashboard', () => {
  const html=read('index.html'); const app=read('app.js'); const notifications=read('handlers/notifications.js'); const data=read('handlers/data.js');
  for(const id of ['notificationsBtn','notificationBadge','notificationsDialog','notificationsList','markAllNotificationsBtn']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(notifications,/eq\('employee_id', caller\.employee\.id\)/);
  assert.match(data,/hadas_notifications/);
  assert.match(app,/renderNotifications/);
  assert.match(app,/data-dashboard-notifications/);
  assert.match(app,/if\(type==='request'\) switchTab\('requests'\)/);
});

test('0.10 removes the generic Other request from both UI and API', () => {
  const html=read('index.html'); const requests=read('handlers/requests.js'); const schema=read('supabase/schema.sql');
  const requestPicker=html.match(/<fieldset class="request-type-picker"[\s\S]*?<\/fieldset>/)?.[0]||'';
  assert.doesNotMatch(requestPicker,/value="other"|>אחר</);
  assert.doesNotMatch(requests,/REQUEST_TYPES[^\n]*other/);
  assert.doesNotMatch(schema,/request_type in \([^)]*'other'/);
});
