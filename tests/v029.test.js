const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const announcements = require('../handlers/announcements');
const legacyPatch = () => read('patch-v029-legacy.js');

test('0.29 migration remains aligned under current release', () => {
  assert.equal(JSON.parse(read('package.json')).version, '0.30.0');
  assert.match(read('VERSION.md'), /גרסה 0\.30\.0/);
  assert.match(read('handlers/health.js'), /schema_version === '0\.30\.0'/);
  assert.match(read('health.js'), /update-v0\.30\.0\.sql/);
  const sql = read('supabase/update-v0.29.0.sql');
  assert.match(sql, /add column if not exists popup_on_login boolean not null default false/i);
  assert.match(sql, /hadas_announcements_popup_login_idx/);
  assert.match(sql, /schema_version='0\.29\.0'/);
  assert.doesNotMatch(sql, /drop table|truncate table|delete from/i);
});

test('0.29 announcement API persists login push without changing importance types', () => {
  const source = read('handlers/announcements.js');
  assert.match(source, /popup_on_login: truthy\(body\.popup_on_login\)/);
  assert.match(source, /row\.popup_on_login = truthy\(body\.popup_on_login\)/);
  assert.match(source, /\['info', 'important', 'urgent'\]/);
  assert.equal(announcements.truthy(true), true);
  assert.equal(announcements.truthy('true'), true);
  assert.equal(announcements.truthy('on'), true);
  assert.equal(announcements.truthy('false'), false);
});

test('0.29 login push is one-per-session until explicit read and respects audience', () => {
  const patch = legacyPatch();
  assert.match(patch, /popup_on_login/);
  assert.match(patch, /announcementIsForCurrentUser/);
  assert.match(patch, /audience_type === 'employees'/);
  assert.match(patch, /announcementRecipients\.some/);
  assert.match(patch, /sessionStorage\.setItem/);
  assert.match(patch, /action:'read'/);
  assert.match(patch, /הבנתי, קראתי/);
  assert.match(patch, /published_at/);
  assert.match(patch, /expires_at/);
});

test('0.29 announcement composer exposes explicit Push-on-login option', () => {
  const patch = legacyPatch();
  assert.match(patch, /name=\"popup_on_login\"/);
  assert.match(patch, /Push בכניסה למערכת/);
  assert.match(read('patch-v029.css'), /v029-push-toggle/);
  assert.match(read('patch-v029.css'), /v029-push-dialog/);
});

test('0.29 calendar has personal general and combined scopes', () => {
  const patch = legacyPatch();
  assert.match(patch, /data-v029-calendar-filter=\"personal\"/);
  assert.match(patch, /data-v029-calendar-filter=\"general\"/);
  assert.match(patch, /data-v029-calendar-filter=\"combined\"/);
  assert.match(patch, /calendarEventIsGeneral/);
  assert.match(patch, /calendarEventIsPersonal/);
  assert.match(patch, /source === 'approved_leave'/);
  assert.match(patch, /visibility === 'class'/);
  assert.match(patch, /visibility === 'managers'/);
});

test('0.29 clicking a populated calendar day opens day events and creation uses a dedicated plus', () => {
  const patch = legacyPatch();
  assert.match(patch, /openCalendarDay/);
  assert.match(patch, /data-v029-add-day/);
  assert.match(patch, /stopImmediatePropagation/);
  assert.match(patch, /if \(!events\.length\) return/);
  assert.match(patch, /openCalendarDialog\(\{ event_date:addButton\.dataset\.v029AddDay \}\)/);
  assert.match(patch, /אירוע חדש ביום זה/);
  assert.match(read('patch-v029.css'), /v029-calendar-add-day/);
  assert.match(read('patch-v029.css'), /calendar-day-tools>i\{display:none!important\}/);
});

test('0.29 stale client entrypoints resolve through legacy behavior into the current no-store patch', () => {
  const vercel = JSON.parse(read('vercel.json'));
  assert.ok(vercel.rewrites.some((item) => item.source === '/patch-v025.js' && item.destination === '/patch-v031.js'));
  assert.ok(vercel.rewrites.some((item) => item.source === '/patch-v025.css' && item.destination === '/patch-v031.css'));
  const headers = new Map(vercel.headers.map((item) => [item.source, item.headers]));
  for (const route of ['/patch-v025.js','/patch-v029.js','/patch-v030.js','/patch-v031.js','/patch-v031.css']) assert.ok(headers.has(route), route);
  assert.match(read('patch-v029.js'), /patch-v029-legacy\.js/);
  assert.match(legacyPatch(), /const VERSION = '0\.29\.0'/);
  assert.match(legacyPatch(), /PREVIOUS_PATCH = '\/patch-v028\.js\?v=0290'/);
  assert.match(read('patch-v030.js'), /PREVIOUS_PATCH = '\/patch-v029\.js\?v=0300'/);
  assert.match(read('patch-v031.js'), /PREVIOUS_PATCH = '\/patch-v030\.js\?v=0310'/);
});