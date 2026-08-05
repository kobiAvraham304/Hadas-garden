const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('0.18 selector helpers accept DOM roots, selector strings and missing roots safely', () => {
  const app = read('app.js');
  assert.match(app, /function resolveRoot\(root = document\)/);
  assert.match(app, /typeof root === 'string'/);
  assert.match(app, /scope\?\.querySelectorAll/);
  assert.match(app, /\$\$\('\[data-daily-summary-filter\]','#dailySummary'\)/);
});

test('0.18 request dialog distinguishes leave and day off and supports accessible fixed-day selection', () => {
  const html = read('index.html');
  const app = read('app.js');
  const sql = read('supabase/update-v0.18.0.sql');
  assert.match(html, /חופשה מתוכננת מראש/);
  assert.match(html, /יום חופשי חד־פעמי/);
  assert.match(html, /id="fixedDayOffOptions"/);
  assert.match(html, /id="swapCandidateCards"/);
  assert.match(app, /profileDayOffPatterns/);
  assert.match(app, /available_fixed_day_weekday/);
  assert.match(sql, /available_fixed_day_weekday/);
});

test('0.18 announcements and tasks support pinning and task completion tracking', () => {
  const html = read('index.html');
  const app = read('app.js');
  const announcements = read('handlers/announcements.js');
  const tasks = read('handlers/tasks.js');
  const sql = read('supabase/update-v0.18.0.sql');
  assert.match(html, /id="taskTrackingDialog"/);
  assert.match(html, /name="is_pinned"/);
  assert.match(html, /requires_acknowledgement/);
  assert.match(app, /openTaskTracking/);
  assert.match(app, /pinned-ribbon/);
  assert.match(announcements, /requires_acknowledgement/);
  assert.match(tasks, /action_required:false/);
  assert.match(sql, /hadas_announcements[\s\S]*is_pinned/);
  assert.match(sql, /hadas_tasks[\s\S]*is_pinned/);
});

test('0.18 daily operations has safe date navigation and adjacent-date prefetch', () => {
  const html = read('index.html');
  const app = read('app.js');
  for (const id of ['prevDailyBtn','nextDailyBtn','todayDailyBtn']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, /function changeDailyDate/);
  assert.match(app, /function prefetchDailyDates/);
  assert.match(app, /data-retry-daily/);
});

test('0.18 calendar uses type cards, legend and monthly agenda', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  assert.match(html, /calendar-type-grid/);
  assert.match(html, /calendar-legend/);
  assert.match(app, /calendar-agenda/);
  assert.match(css, /\.agenda-event\.birthday/);
});

test('0.18 migration is non-destructive and updates schema metadata', () => {
  const sql = read('supabase/update-v0.18.0.sql');
  assert.doesNotMatch(sql, /drop table/i);
  assert.match(sql, /begin;/i);
  assert.match(sql, /commit;/i);
  assert.match(sql, /'0\.18\.0'/);
});
