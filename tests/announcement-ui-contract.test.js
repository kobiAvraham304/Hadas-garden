const fs = require('fs');
const path = require('path');
const assert = require('node:assert');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const patch = fs.readFileSync(path.join(root, 'patch-v0343.js'), 'utf8');
const handler = fs.readFileSync(path.join(root, 'handlers', 'announcements.js'), 'utf8');

test('announcement composer uses capture handlers so edit/save bypass stale listeners', () => {
  assert.match(patch, /addEventListener\('submit', saveComposer, true\)/);
  assert.match(patch, /edit_announcement/);
  assert.match(patch, /stopImmediatePropagation\(\)/);
});

test('announcement publication date is rendered as fixed numeric Israel date/time', () => {
  assert.match(patch, /Asia\/Jerusalem/);
  assert.match(patch, /publishedInput\.type = 'text'/);
  assert.match(patch, /Number\(get\('day'\)\).*Number\(get\('month'\)\).*get\('year'\)/s);
});

test('announcement composer offers gallery image selection and inline images', () => {
  assert.match(patch, /accept=\"image\/\*\"/);
  assert.match(patch, /בחירה מהגלריה/);
  assert.match(patch, /announcement-inline-attachment/);
  assert.match(handler, /image\/jpeg/);
  assert.match(handler, /application\/pdf/);
});

test('teachers edit their own announcements while managers can edit all', () => {
  assert.match(handler, /isManager\(caller\) \|\| item\?\.created_by === caller\.employee\.id/);
});
