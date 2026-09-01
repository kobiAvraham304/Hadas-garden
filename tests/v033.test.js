const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('0.33 release remains in the 0.34 compatibility chain', () => {
  assert.equal(JSON.parse(read('package.json')).version, '0.35.0');
  const entry = read('patch-v025.js');
  const patch = read('patch-v033.js');
  const vercel = JSON.parse(read('vercel.json'));
  assert.match(entry, /V033 = '\/patch-v033\.js\?v=0333'/);
  assert.match(entry, /__hadasV033BootstrapPromise/);
  assert.match(patch, /PREVIOUS = '\/patch-v032\.js\?v=0321'/);
  assert.match(patch, /releaseBootstrap/);
  assert.match(entry, /V034 = '\/patch-v034\.js\?v=0350'/);
  assert.ok(!vercel.rewrites.some((item) => item.source === '/patch-v025.js' || item.source === '/patch-v025.css'));
});

test('0.33 startup tolerates optional export controls and fixes mobile password zoom', () => {
  const app = read('app.js');
  const css = read('patch-v033.css');
  const patch = read('patch-v033.js');
  assert.match(app, /\$\('#printBtn'\)\?\.addEventListener/);
  assert.match(app, /\$\('#imageBtn'\)\?\.addEventListener/);
  assert.match(css, /input,\s*\n\s*select,\s*\n\s*textarea\s*\{\s*\n\s*font-size:16px !important/);
  assert.match(css, /#appVersionBadge::after[\s\S]*content:none !important/);
  assert.match(patch, /v033-password-toggle/);
  assert.match(patch, /input\.type = reveal \? 'text' : 'password'/);
  assert.match(patch, /__hadasV033PasswordRevealInstalled/);
  assert.match(patch, /button\.closest\('\.v033-password-field'\)/);
  assert.match(read('index.html'), /id="loginPassword"[\s\S]*v033-password-toggle/);
  assert.match(read('index.html'), /class="v033-password-group"/);
  assert.match(patch, /__hadasV032VersionObservers/);
  assert.match(patch, /window\.__hadasV033VersionObservers = observers/);
});

test('0.33 schedule scope hides publication and availability data at the server boundary', () => {
  const data = read('handlers/data.js');
  const shifts = read('handlers/shifts.js');
  const patch = read('patch-v033.js');
  assert.match(data, /publication: manager \? publication : null/);
  assert.match(data, /const visibleScheduleAbsences = fullScheduleViewer/);
  assert.match(shifts, /publication: isManager\(caller\) \? publication : null/);
  assert.match(shifts, /const scheduleAbsences = fullScheduleViewer/);
  assert.match(patch, /roleKind\(\) === 'regular'/);
  assert.match(patch, /v033-personal-week/);
  assert.match(patch, /installLeadExports/);
  assert.match(patch, /drawLeadSchedule/);
  assert.match(data, /employees: visibleEmployees/);
  assert.match(data, /classScheduleViewer[\s\S]*visibleEmployeeIds\.add/);
});

test('0.33.1 regular assistant controls stay hidden after legacy rerenders', () => {
  const patch = read('patch-v033.js');
  const css = read('patch-v033.css');
  assert.match(patch, /dataset\.hadasRole = kind/);
  assert.match(patch, /setHidden\('#v028ScheduleEmployeeSearch', kind === 'regular'\)/);
  assert.match(patch, /setHidden\('#scheduleDayField', kind === 'regular'\)/);
  assert.match(patch, /installRoleGuard/);
  assert.match(css, /data-hadas-role="regular"\]\s+#v028ScheduleEmployeeSearch/);
  assert.match(css, /data-hadas-role="regular"\]\s+#publishScheduleBtn/);
  assert.match(css, /data-hadas-role="regular"\]\s+\.schedule-command-bar/);
  assert.match(patch, /השבוע מוצג לרוחב · החליקו לצדדים/);
  assert.match(css, /scroll-snap-type:x mandatory/);
});

test('0.33 calendar supports private self events, own-class events and editing', () => {
  const calendar = read('handlers/calendar.js');
  const patch = read('patch-v033.js');
  const migration = read('supabase/update-v0.33.0.sql');
  assert.match(calendar, /event\.visibility === 'private'/);
  assert.match(calendar, /new Set\(\['class', 'private'\]\)/);
  assert.match(calendar, /new Set\(\['private'\]\)/);
  assert.match(calendar, /normalizeEventRow/);
  assert.match(calendar, /\.update\(row\).*\.select\('\*'\)\.single\(\)/);
  assert.match(patch, /data-action="edit-event"/);
  assert.match(patch, /method:editing \? 'PATCH' : 'POST'/);
  assert.doesNotMatch(patch, /calendar-agenda-heading/);
  assert.match(migration, /drop constraint if exists hadas_calendar_events_visibility_check/i);
  assert.match(migration, /'private'/);
  assert.match(migration, /schema_version = '0\.33\.0'/);
  assert.match(patch, /mobileCalendarMarkup/);
  assert.match(patch, /matchMedia\('\(max-width:760px\)'\)/);
  assert.match(patch, /calendarTypeClass/);
});

test('0.33 removes tasks from runtime data and restricts teacher announcements to own class', () => {
  const data = read('handlers/data.js');
  const announcements = read('handlers/announcements.js');
  const patch = read('patch-v033.js');
  const css = read('patch-v033.css');
  assert.doesNotMatch(data, /from\('hadas_tasks'\)/);
  assert.doesNotMatch(data, /from\('hadas_task_assignees'\)/);
  assert.match(announcements, /isTeacher\(caller\) && !isManager\(caller\)/);
  assert.match(announcements, /audienceType:'class', classId:caller\.employee\.primary_class_id/);
  assert.match(patch, /נקרא ב־/);
  assert.match(css, /\[data-tab="tasks"\][\s\S]*display:none !important/);
});

test('0.33 onboarding is server-authoritative and can be queued from an employee card', () => {
  const auth = read('handlers/auth-me.js');
  const employees = read('handlers/employees.js');
  const data = read('handlers/data.js');
  const patch = read('patch-v033.js');
  assert.match(auth, /onboarding_required:!onboardingCompleted/);
  assert.match(data, /onboarding_required: !caller\.user\.onboarding_completed_at/);
  assert.match(employees, /body\.restart_onboarding/);
  assert.match(employees, /onboarding_completed_at = null/);
  assert.match(patch, /restart-onboarding/);
  assert.match(patch, /profile\.onboarding_required !== true/);
  assert.match(patch, /דלג על הסיור/);
  assert.match(patch, /data-v033-tour-next/);
  assert.match(patch, /v033TourSpotlight/);
  assert.match(patch, /dialog\.show\(\)/);
  assert.doesNotMatch(patch, /if \(!dialog\.open\) dialog\.showModal\(\);/);
  assert.doesNotMatch(patch, /localStorage\.getItem/);
});

test('0.33.1 mobile request and announcement presentation follows worker permissions', () => {
  const patch = read('patch-v033.js');
  const css = read('patch-v033.css');
  assert.match(patch, /dataset\.hadasCanCreate = canCreateContent\(\)/);
  assert.match(css, /data-hadas-can-create="false"[\s\S]*\.audience-label[\s\S]*display:none !important/);
  assert.match(css, /#leaveDayOffField \.compact-radio-row input\[type="radio"\][\s\S]*width:21px !important/);
});

test('0.33.1 managers can inspect schedule acknowledgements by week and timestamp', () => {
  const patch = read('patch-v033.js');
  assert.match(patch, /v033ScheduleAckViewerBtn/);
  assert.match(patch, /אישורי קריאה ·/);
  assert.match(patch, /acknowledged_at/);
  assert.match(patch, /שיבוץ שבוע/);
  assert.match(patch, /state\.publication\?\.revision/);
});
