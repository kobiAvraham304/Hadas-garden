const test=require('node:test');
const assert=require('node:assert/strict');
const server=require('../lib/server');
const handler=require('../lib/requests-v030');
function response(){return {statusCode:200,headers:{},status(code){this.statusCode=code;return this},setHeader(k,v){this.headers[k]=v},getHeader(k){return this.headers[k]},end(value){this.body=JSON.parse(value)}};}
async function create(body){
 const oldFetch=global.fetch;
 const previousEnv=Object.fromEntries(['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY'].map(key=>[key,process.env[key]]));
 Object.assign(process.env,{SUPABASE_URL:'https://fixture.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture-public',SUPABASE_SECRET_KEY:'fixture-secret'});
 const inserted=[];
 global.fetch=async(url,options={})=>{
  const path=new URL(url).pathname;
  let data=[];
  if(path.endsWith('/rpc/hadas_get_session_context'))data=[{session_data:{id:'s',csrf_token:'csrf',last_seen_at:new Date().toISOString()},user_data:{active:true,role:'employee',employee_id:'employee'},employee_data:{id:'employee',active:true,full_name:'Test employee'}}];
  else if(path.endsWith('/hadas_requests')&&options.method==='POST'){const payload=JSON.parse(options.body);inserted.push(payload);data=[{...payload,id:'request'}];}
  return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
 };
 try{
  const res=response();await handler({method:'POST',headers:{cookie:`${server.SESSION_COOKIE}=test-session`,'x-csrf-token':'csrf'},body:{action:'create',...body}},res);return {res,inserted};
 }finally{global.fetch=oldFetch;for(const[key,value]of Object.entries(previousEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
test('API creates early finish request with no existing shifts',async()=>{
 const {res,inserted}=await create({request_type:'early_finish',request_date:'2026-09-27',requested_end:'12:00'});
 assert.equal(res.statusCode,201,JSON.stringify(res.body));assert.equal(inserted[0].shift_id,null);assert.equal(inserted[0].status,'pending');assert.equal(res.body.request.requested_end,'12:00');
});
test('API creates late start request with no existing shifts',async()=>{
 const {res,inserted}=await create({request_type:'late_start',request_date:'2026-09-27',requested_start:'09:00'});
 assert.equal(res.statusCode,201,JSON.stringify(res.body));assert.equal(inserted[0].shift_id,null);assert.equal(inserted[0].requested_start,'09:00');
});
test('API stores multiple day-off choices with the selected preference',async()=>{
 const {res,inserted}=await create({request_type:'leave',request_date:'2026-09-27',allow_schedule_on_day_off:true,available_fixed_day_weekdays:[1,3],preferred_fixed_day_weekday:3});
 assert.equal(res.statusCode,201,JSON.stringify(res.body));assert.deepEqual(inserted[0].available_fixed_day_weekdays,[1,3]);assert.equal(inserted[0].preferred_fixed_day_weekday,3);
});
test('API rejects preference outside the selected days',async()=>{
 const {res,inserted}=await create({request_type:'leave',request_date:'2026-09-27',allow_schedule_on_day_off:true,available_fixed_day_weekdays:[1,3],preferred_fixed_day_weekday:4});
 assert.equal(res.statusCode,400);assert.equal(inserted.length,0);
});
test('API rejects invalid early finish times before persisting',async()=>{
 const {res,inserted}=await create({request_type:'early_finish',request_date:'2026-09-27',requested_end:'27:10'});
 assert.equal(res.statusCode,400);assert.equal(inserted.length,0);
});

test('API rejects invalid late start time without a shift',async()=>{
 const {res,inserted}=await create({request_type:'late_start',request_date:'2026-09-27',requested_start:'27:10'});
 assert.equal(res.statusCode,400);assert.equal(inserted.length,0);
});
