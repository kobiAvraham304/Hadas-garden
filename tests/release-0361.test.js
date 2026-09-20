const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {employeeAvailability} = require('../lib/auto-schedule');
const input = {employee:{id:'e',active:true,default_start:'07:30',default_end:'15:30'},date:'2026-09-20',patterns:[{employee_id:'e',weekday:0,day_type:'work',start_time:'07:30',end_time:'15:30'}],settings:{opening_time:'07:30',closing_time:'15:30'},requests:[]};
test('approved early finish bounds automatic shifts before any shift exists',()=>{
 assert.equal(employeeAvailability({...input,requests:[{requester_id:'e',request_type:'early_finish',request_date:input.date,requested_end:'12:00',status:'approved'}]}).end,'12:00');
});
test('pending early finish does not change scheduling',()=>{
 assert.equal(employeeAvailability({...input,requests:[{requester_id:'e',request_type:'early_finish',request_date:input.date,requested_end:'12:00',status:'pending'}]}).end,'15:30');
});
test('early finish before opening leaves no automatic availability',()=>{
 assert.equal(employeeAvailability({...input,requests:[{requester_id:'e',request_type:'early_finish',request_date:input.date,requested_end:'07:00',status:'applied'}]}),null);
});
function context(){
 const c={state:{weekStart:new Date('2026-09-20T12:00:00'),weekCache:new Map(),weekInflight:new Map(),weekRequestId:0,dataRevision:0},document:{body:{classList:{add(){},remove(){}}}},renderSchedule(){},setSyncState(){},showToast(){},requests:[]};
 c.apiFetch=()=>new Promise(resolve=>c.requests.push(resolve));
 vm.createContext(c);
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
 for(const name of ['dateISO','startOfWeek','scheduleCacheKey','cacheSchedulePayload','applySchedulePayload','fetchScheduleWeek']){
  const at=source.indexOf(`function ${name}(`);const end=source.indexOf('\n}',at)+2;
  // Single line helpers do not have a standalone closing brace.
  const line=source.slice(at,source.indexOf('\n',at));
  vm.runInContext((name==='fetchScheduleWeek'?'async ':'')+(line.endsWith('}')?line:source.slice(at,end)),c);
 }
 return c;
}
test('an older prefetch cannot replace a newer week response',async()=>{
 const c=context();const a=c.fetchScheduleWeek(c.state.weekStart,{apply:false});const b=c.fetchScheduleWeek(c.state.weekStart,{force:true});
 c.requests[1]({shifts:[{id:'saved'}]});await b;c.requests[0]({shifts:[]});await a;
 assert.equal(c.state.weekCache.get('2026-09-20').payload.shifts[0]?.id,'saved');
});
test('foreground navigation sharing a prefetch still applies the returned week',async()=>{
 const c=context();const a=c.fetchScheduleWeek(c.state.weekStart,{apply:false});const b=c.fetchScheduleWeek(c.state.weekStart);
 assert.equal(c.requests.length,1);c.requests[0]({shifts:[{id:'shared'}]});await Promise.all([a,b]);
 assert.equal(c.state.shifts?.[0]?.id,'shared');
});

test('approved late start bounds automatic shifts before any shift exists',()=>{
 assert.equal(employeeAvailability({...input,requests:[{requester_id:'e',request_type:'late_start',request_date:input.date,requested_start:'10:00',status:'approved'}]}).start,'10:00');
});
test('pending late start does not change scheduling',()=>{
 assert.equal(employeeAvailability({...input,requests:[{requester_id:'e',request_type:'late_start',request_date:input.date,requested_start:'10:00',status:'pending'}]}).start,'07:30');
});
test('conflicting approved start and end constraints exclude automatic shift',()=>{
 assert.equal(employeeAvailability({...input,requests:[{requester_id:'e',request_type:'late_start',request_date:input.date,requested_start:'13:00',status:'applied'},{requester_id:'e',request_type:'early_finish',request_date:input.date,requested_end:'12:00',status:'approved'}]}),null);
});
