const test = require('node:test');
const assert = require('node:assert/strict');

function setupEnv() {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test';
  process.env.SUPABASE_SECRET_KEY = 'secret-test';
}

test('server retries transient Supabase gateway errors for safe reads', async () => {
  setupEnv();
  delete require.cache[require.resolve('../lib/server')];
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls < 3) {
      return new Response(JSON.stringify({ message:'Gateway Timeout' }), {
        status:504,
        headers:{ 'content-type':'application/json' },
      });
    }
    return new Response(JSON.stringify([{ id:'ok' }]), {
      status:200,
      headers:{ 'content-type':'application/json' },
    });
  };
  try {
    const { db } = require('../lib/server');
    const result = await db().from('hadas_test').select('*');
    assert.equal(calls, 3);
    assert.equal(result.error, null);
    assert.deepEqual(result.data, [{ id:'ok' }]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('server never retries Supabase writes automatically', async () => {
  setupEnv();
  delete require.cache[require.resolve('../lib/server')];
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ message:'Gateway Timeout' }), {
      status:504,
      headers:{ 'content-type':'application/json' },
    });
  };
  try {
    const { db } = require('../lib/server');
    const result = await db().from('hadas_test').insert({ value:1 });
    assert.equal(calls, 1);
    assert.equal(result.error?.status, 504);
  } finally {
    global.fetch = originalFetch;
  }
});

test('server stops retrying after a read timeout instead of exceeding function duration', async () => {
  setupEnv();
  delete require.cache[require.resolve('../lib/server')];
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new DOMException('Timed out', 'TimeoutError'); };
  try {
    const result = await require('../lib/server').db().from('hadas_test').select('*');
    assert.equal(calls, 1);
    assert.match(result.error.message, /לא הגיב בזמן/);
  } finally { global.fetch = originalFetch; }
});
