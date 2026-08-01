const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test';
process.env.SUPABASE_SECRET_KEY = 'server-test-key';

const {
  normalizePhone, displayPhone, hashPassword, verifyPassword, isTeacher, canCreateContent,
} = require('../lib/server');

test('normalizes Israeli phone numbers without using email', () => {
  assert.equal(normalizePhone('052-123-4567'), '+972521234567');
  assert.equal(normalizePhone('+972 52 123 4567'), '+972521234567');
  assert.equal(normalizePhone('521234567'), '+972521234567');
  assert.equal(displayPhone('+972521234567'), '052-123-4567');
  assert.throws(() => normalizePhone('1234'), /אינו תקין/);
});

test('password hashes are salted and verifiable with scrypt', async () => {
  const first = await hashPassword('hadas-strong-password');
  const second = await hashPassword('hadas-strong-password');
  assert.match(first, /^scrypt\$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('hadas-strong-password', first), true);
  assert.equal(await verifyPassword('wrong-password', first), false);
  assert.equal(await verifyPassword('anything', 'invalid-hash'), false);
});

test('teachers can create announcements and tasks while other employees cannot', () => {
  const teacher={ user:{ role:'employee' }, employee:{ job_title:'גננת' } };
  const assistant={ user:{ role:'employee' }, employee:{ job_title:'סייעת' } };
  const manager={ user:{ role:'scheduler' }, employee:{ job_title:'גננת' } };
  assert.equal(isTeacher(teacher),true);
  assert.equal(canCreateContent(teacher),true);
  assert.equal(canCreateContent(manager),true);
  assert.equal(canCreateContent(assistant),false);
});

test('the clean SQL initial password hash is exactly the temporary password hadas', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const schema = fs.readFileSync(path.join(__dirname,'..','supabase','schema.sql'),'utf8');
  const encoded = schema.match(/v_initial_hash text := '([^']+)'/)?.[1];
  assert.ok(encoded);
  assert.equal(await verifyPassword('hadas', encoded), true);
  assert.equal(await verifyPassword('Hadas', encoded), false);
});
