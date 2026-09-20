const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('0.36 request UI hides technical applied state while preserving compatibility', () => {
  const app = read('app.js');
  const index = read('index.html');
  const handler = read('handlers/requests.js');
  assert.doesNotMatch(index, /data-value="applied"/);
  assert.doesNotMatch(index, />הוזרמו</);
  assert.doesNotMatch(app, /\['נשלח','אישור הנהלה','הוזרם'\]/);
  assert.doesNotMatch(app, /<span>הוזרמו<\/span>/);
  assert.match(app, /applied: 'אושר'/);
  assert.match(app, /\['approved','applied'\]\.includes\(request\.status\)/);
  assert.match(app, /requestStatusFilter==='applied'\) state\.requestStatusFilter='approved'/);
  assert.match(handler, /hadas_apply_approved_request/);
  assert.match(handler, /action === 'apply'/);
});

test('0.36 preapproval copy describes automatic schedule update', () => {
  const v026 = read('patch-v026.js');
  const v030 = read('patch-v030.js');
  assert.match(v026, /אישור מנהלת מראש/);
  assert.match(v030, /אישור מנהלת מראש/);
  assert.match(v030, /המערכת תעדכן את השיבוץ אוטומטית/);
  assert.doesNotMatch(v030, /ניתן יהיה להזרים אותה לשיבוץ/);
});

test('0.36 shift editor explains real unavailability and assignment conflicts', () => {
  const app = read('app.js');
  const patch = read('patch-v0342.js');
  const v026 = read('patch-v026.js');
  assert.match(app, /function shiftWorkerAvailabilityDetails/);
  assert.match(app, /חופשה מאושרת/);
  assert.match(app, /יום חופשי קבוע/);
  assert.match(app, /משובץ\/ת ב־/);
  assert.match(app, /state\.shifts\s*\|\|\s*\[\]/);
  assert.match(app, /overlaps\(start,\s*end,\s*shift\.start_time,\s*shift\.end_time\)/);
  assert.match(app, /shift-worker-reasons/);
  assert.match(v026, /v026-selected-employee-copy/);
  assert.match(v026, /עובד\/ת בשיבוץ הנוכחי/);
  assert.match(patch, /\.v026-selected-employee-copy/);
  assert.match(patch, /gap:5px/);
});

test('0.36 role and mobile guards remain intact across schedule and administration', () => {
  const app = read('app.js');
  const v033 = read('patch-v033.js');
  const css = read('patch-v033.css');
  const data = read('handlers/data.js');
  const shifts = read('handlers/shifts.js');
  assert.match(app, /if \(tab === 'employees' && !isManager\(\)\) tab = 'dashboard'/);
  assert.match(app, /if \(tab === 'daily' && !canManageDailyOperations\(\)\) tab = 'dashboard'/);
  assert.match(v033, /if \(isManager\(\)\) return 'manager'/);
  assert.match(v033, /schedule_scope === 'class'/);
  assert.match(v033, /return 'lead'/);
  assert.match(v033, /return 'regular'/);
  assert.match(v033, /setHidden\('#publishScheduleBtn', kind !== 'manager'\)/);
  assert.match(v033, /setHidden\('#scheduleIssuesToggle', kind !== 'manager'\)/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /scroll-snap-type:x mandatory/);
  assert.match(data, /publication: manager \? publication : null/);
  assert.match(shifts, /publication: isManager\(caller\) \? publication : null/);
});

test('0.36 hf8 cache chain delivers all changed request and shift layers', () => {
  const index = read('index.html');
  const entry = read('patch-v025.js');
  const v033 = read('patch-v033.js');
  const v032 = read('patch-v032.js');
  const v031 = read('patch-v031.js');
  assert.match(index, /app\.js\?v=0362/);
  assert.match(index, /patch-v025\.js\?v=0363/);
  assert.match(entry, /patch-v026\.js\?v=0321hf12/);
  assert.match(entry, /patch-v033\.js\?v=0333hf9/);
  assert.match(entry, /patch-v0342\.js\?v=0362/);
  assert.match(v033, /patch-v032\.js\?v=0321hf9/);
  assert.match(v032, /patch-v031\.js\?v=0321hf8/);
  assert.match(v031, /patch-v030\.js\?v=0310hf8/);
});
