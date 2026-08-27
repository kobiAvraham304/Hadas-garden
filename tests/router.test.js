const test = require('node:test');
const assert = require('node:assert/strict');
function responseMock() { return { statusCode:200,headers:{},body:'',status(code){this.statusCode=code;return this;},setHeader(name,value){this.headers[name]=value;},getHeader(name){return this.headers[name];},end(value=''){this.body=value;} }; }

test('unified router resolves rewritten and direct API routes', () => {
  const router=require('../api/index');
  assert.equal(router.getRoute({query:{route:'shifts'},url:'/api/index?route=shifts'}),'shifts');
  assert.equal(router.getRoute({query:{},url:'/api/employees'}),'employees');
});

test('unified router returns JSON 404 for unknown and removed document routes', async () => {
  const router=require('../api/index');
  for(const route of ['not-real','documents']){
    const res=responseMock();
    await router({method:'GET',query:{route},url:`/api/index?route=${route}`},res);
    assert.equal(res.statusCode,404);
    assert.deepEqual(JSON.parse(res.body),{ok:false,error:'נתיב API לא נמצא'});
  }
});

test('unified router forwards config without exposing the secret key', async () => {
  process.env.SUPABASE_URL='https://project.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY='publishable-test';
  process.env.SUPABASE_SECRET_KEY='do-not-return-this';
  delete require.cache[require.resolve('../lib/server')];
  delete require.cache[require.resolve('../handlers/config')];
  delete require.cache[require.resolve('../api/index')];
  const router=require('../api/index');
  const res=responseMock();
  await router({method:'GET',query:{route:'config'},url:'/api/index?route=config',headers:{}},res);
  assert.equal(res.statusCode,200);
  const body=JSON.parse(res.body);
  assert.equal(body.version,'0.20.0');
  assert.equal(body.supabasePublishableKey,'publishable-test');
  assert.doesNotMatch(res.body,/do-not-return-this/);
});
