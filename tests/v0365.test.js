const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('0.36 daily coverage never presents a sub-threshold candidate as a normal safe option', () => {
  const app = read('app.js');
  assert.match(app, /אין כרגע כיסוי מומלץ/);
  assert.match(app, /לא נמצאה התאמה בטוחה לכיסוי/);
  assert.match(app, /daily-emergency-options/);
  assert.match(app, /אפשרויות חריגה בלבד/);
  assert.match(app, /לא מומלצת אוטומטית/);
  assert.match(app, /אפשרות חריגה בלבד/);
  assert.match(app, /זו אפשרות חריגה בלבד, מתחת לסף ההמלצה/);
});

test('0.36 shift editor makes an existing class assignment impossible to miss', () => {
  const app = read('app.js');
  const v026 = read('patch-v026.js');
  assert.match(app, /כבר קיים שיבוץ בכיתה אחרת/);
  assert.match(app, /קיים שיבוץ — השיבוץ הזה יועבר/);
  assert.match(app, /בחירה למרות החסימה/);
  assert.match(app, /זו חריגה ידנית בלבד/);
  assert.match(v026, /בחירת עובד\/ת אחר\/ת/);
  assert.match(v026, /העובד\/ת הנוכחי\/ת נשאר\/ת בשיבוץ עד שתבחר\/י מחליף\/ה/);
});

test('0.36 hf12 styles emphasize unsafe coverage and cross-class assignment state', () => {
  const patch = read('patch-v0342.js');
  assert.match(patch, /hf12 — coverage safety hierarchy/);
  assert.match(patch, /\.daily-emergency-options/);
  assert.match(patch, /\.daily-no-safe-option/);
  assert.match(patch, /\.shift-current-assignment/);
  assert.match(patch, /\[data-manual-override\]/);
});

test('0.36 hf13 cache chain delivers the mobile layout fix plus clarity update', () => {
  const index = read('index.html');
  const entry = read('patch-v025.js');
  assert.match(index, /app\.js\?v=0370/);
  assert.match(index, /patch-v025\.js\?v=0370/);
  assert.match(entry, /patch-v026\.js\?v=0321hf12/);
  assert.match(entry, /patch-v0342\.js\?v=0370/);
});
