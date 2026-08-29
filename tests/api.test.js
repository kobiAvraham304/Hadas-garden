const test = require('node:test');
const assert = require('node:assert/strict');

function responseMock() {
  return {
    statusCode:200, headers:{}, body:'',
    status(code){ this.statusCode=code; return this; },
    setHeader(name,value){ this.headers[name]=value; },
    getHeader(name){ return this.headers[name]; },
    end(value=''){ this.body=value; },
  };
}
function requestMock(method='GET', query={}) { return { method, query, headers:{}, socket:{ remoteAddress:'127.0.0.1' } }; }
function clearEnv(){ for(const key of ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','BOOTSTRAP_TOKEN','SESSION_PEPPER','APP_URL']) delete process.env[key]; }

test('public config exposes only publishable configuration', async () => {
  process.env.SUPABASE_URL='https://project.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY='publishable-test';
  process.env.SUPABASE_SECRET_KEY='secret-test-not-returned';
  delete require.cache[require.resolve('../handlers/config')];
  const handler = require('../handlers/config');
  const res=responseMock();
  await handler(requestMock(),res);
  const body=JSON.parse(res.body);
  assert.equal(res.statusCode,200);
  assert.equal(body.version,'0.24.0');
  assert.equal(body.supabasePublishableKey,'publishable-test');
  assert.doesNotMatch(res.body,/secret-test-not-returned/);
  assert.equal(body.bootstrapToken,undefined);
  assert.equal(body.sessionPepper,undefined);
});

test('health endpoint requires only the three Supabase variables', async () => {
  clearEnv();
  delete require.cache[require.resolve('../handlers/health')];
  const handler = require('../handlers/health');
  const res=responseMock();
  await handler(requestMock(),res);
  const body=JSON.parse(res.body);
  assert.equal(res.statusCode,503);
  assert.equal(body.version,'0.24.0');
  assert.deepEqual(body.checks.environment.missing.sort(),['SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','SUPABASE_URL'].sort());
  assert.doesNotMatch(res.body,/BOOTSTRAP_TOKEN|SESSION_PEPPER|APP_URL/);
});

test('session pepper is derived internally from the existing Supabase connection', () => {
  process.env.SUPABASE_URL='https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY='publishable';
  process.env.SUPABASE_SECRET_KEY='secret';
  delete require.cache[require.resolve('../lib/server')];
  const { getEnv } = require('../lib/server');
  const env=getEnv();
  assert.equal(typeof env.sessionPepper,'string');
  assert.ok(env.sessionPepper.length >= 64);
  assert.notEqual(env.sessionPepper,'secret');
});

test('Israel date helper uses Asia/Jerusalem rather than UTC date', () => {
  process.env.SUPABASE_URL='https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY='publishable';
  process.env.SUPABASE_SECRET_KEY='secret';
  delete require.cache[require.resolve('../lib/server')];
  const { israelDateISO } = require('../lib/server');
  assert.equal(israelDateISO(new Date('2026-07-31T21:30:00Z')), '2026-08-01');
});
