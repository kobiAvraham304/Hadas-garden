const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test';
process.env.SUPABASE_SECRET_KEY = 'server-test-key';

const {
  normalizePhone, displayPhone, hashPassword, verifyPassword, db,
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

test('signed storage URLs keep the Supabase /storage/v1 prefix', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /\/storage\/v1\/object\/upload\/sign\/hadas-documents\//);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ url: '/object/upload/sign/hadas-documents/a.pdf?token=test-token' }),
    };
  };
  try {
    const result = await db().storage.from('hadas-documents').createSignedUploadUrl('a.pdf');
    assert.equal(result.error, null);
    assert.equal(result.data.token, 'test-token');
    assert.equal(result.data.signedUrl, 'https://example.supabase.co/storage/v1/object/upload/sign/hadas-documents/a.pdf?token=test-token');
  } finally {
    global.fetch = originalFetch;
  }
});


test('the SQL initial password hash is exactly the temporary password hadas', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const schema = fs.readFileSync(path.join(__dirname,'..','supabase','schema.sql'),'utf8');
  const encoded = schema.match(/v_initial_hash text := '([^']+)'/)?.[1];
  assert.ok(encoded);
  assert.equal(await verifyPassword('hadas', encoded), true);
  assert.equal(await verifyPassword('Hadas', encoded), false);
});
