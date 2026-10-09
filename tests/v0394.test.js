const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const rules = require('../lib/request-rules-v039');

function loadPrecheck(requests, pattern = {day_type:'work'}) {
  const source = fs.readFileSync('lib/shifts-v039.js','utf8');
  const previousHandler = async () => ({ ok:true });
  const query = (table) => {
    const chain = {
      select(){return chain;},eq(){return chain;},in(){return chain;},lte(){return chain;},
      maybeSingle(){return Promise.resolve({data:pattern,error:null});},
      then(resolve,reject){return Promise.resolve({data:requests,error:null}).then(resolve,reject);}
    };
    if (!['hadas_requests','hadas_employee_weekly_patterns'].includes(table)) throw Error('Unexpected database read: '+table);
    return chain;
  };
  const deps = {
    './shifts-v032': previousHandler,
    './server': {
      requireSession: async (_req,opts)=>{assert.equal(opts.manager,true);return {employee:{id:'manager'}};},
      parseBody: req=>req.body,
      db: ()=>({from:query}),
      assertDb: result=>{if(result.error) throw result.error;return result.data;},
      httpError: (status,message)=>Object.assign(new Error(message),{status}),
      handleError: (_res,error)=>{throw error;}
    },
    './request-rules-v039': rules,
    './schedule': {timeToMinutes:(time)=>{const [h,m]=String(time).split(':').map(Number);return h*60+m;}}
  };
  const mod={exports:{}};
  const factory=vm.runInNewContext('(function(require,module,exports){'+source+'\n})',{});
  factory(name=>{assert.ok(Object.hasOwn(deps,name),'unexpected dependency '+name);return deps[name]},mod,mod.exports);
  return mod.exports;
}

const date='2026-10-08';
const leave={requester_id:'e1',request_type:'leave',status:'approved',request_date:'2026-10-05',request_end_date:'2026-11-30'};
const payload={employee_id:'e1',shift_date:date,start_time:'07:30',end_time:'15:30'};
function request(body){return {method:'POST',body};}

test('0.39.4 regression: approved leave cannot be scheduled without explicitly checking ✓',async()=>{
  const handler=loadPrecheck([leave]);
  await assert.rejects(handler.enforceApprovedRequestRules(request(payload),payload),/חופשה\/יום חופשי מאושרים/);
  await assert.rejects(handler.enforceApprovedRequestRules(request({...payload,override_approved_leave:'true'}),{...payload,override_approved_leave:'true'}),/חופשה\/יום חופשי מאושרים/);
});

test('0.39.4 approved leave + explicit ✓ passes legacy precheck without deleting leave',async()=>{
  const handler=loadPrecheck([leave]);
  const input={...payload,override_approved_leave:true};
  await handler.enforceApprovedRequestRules(request(input),input);
  assert.equal(leave.status,'approved');
  assert.equal(leave.request_end_date,'2026-11-30');
});

test('0.39.4 approved day off can be overridden, but overlapping sick leave remains blocked',async()=>{
  const dayOff={...leave,request_type:'day_off'};
  const input={...payload,override_approved_leave:true};
  await loadPrecheck([dayOff]).enforceApprovedRequestRules(request(input),input);
  const sick={...leave,request_type:'sick',request_date:date,request_end_date:date};
  await assert.rejects(loadPrecheck([leave,sick]).enforceApprovedRequestRules(request(input),input),/מחלה מאושרת/);
});

test('0.39.4 override does not bypass approved late start constraints',async()=>{
  const input={...payload,override_approved_leave:true};
  const late={requester_id:'e1',request_type:'late_start',status:'approved',request_date:date,requested_start:'09:00'};
  await assert.rejects(loadPrecheck([leave,late]).enforceApprovedRequestRules(request(input),input),/התחלה מאוחרת/);
});

test('0.39.4 the primary shift validator retains the same precise override and audit note',()=>{
  const client=fs.readFileSync('app.js','utf8');
  const backend=fs.readFileSync('handlers/shifts.js','utf8');
  assert.match(client,/data\.override_approved_leave = Boolean\(form\.elements\.override_approved_leave\.checked\)/);
  assert.match(backend,/validateShift\(payload, null, Boolean\(body\.override_day_off\), Boolean\(body\.override_rules\), Boolean\(body\.override_approved_leave\)\)/);
  assert.match(backend,/שיבוץ ידני בזמן חופשה מאושרת — אישור מפורש/);
  assert.match(backend,/const approvedSick=requests\.find/);
  assert.equal(JSON.parse(fs.readFileSync('package.json','utf8')).version,'0.39.4');
});

test('0.39.4 fast legacy saves delegate explicitly confirmed leave overrides to current shift handler',async()=>{
  const source=fs.readFileSync('lib/shifts-v025.js','utf8');
  const calls=[];
  const legacyHandler=async(req)=>{calls.push({method:req.method,flag:req.body.override_approved_leave});return {ok:true,legacy:true};};
  const deps={
    '../handlers/shifts':legacyHandler,
    './server':{parseBody:req=>req.body},
    './schedule':{},
    '../handlers/daily-operations':{}
  };
  const mod={exports:{}};
  const factory=vm.runInNewContext('(function(require,module,exports){'+source+'\n})',{});
  factory(name=>{assert.ok(Object.hasOwn(deps,name),'unexpected dependency '+name);return deps[name]},mod,mod.exports);
  const makeBody={...payload,override_approved_leave:true};
  const post=await mod.exports({method:'POST',body:makeBody},{});
  assert.equal(post.legacy,true);
  const patch=await mod.exports({method:'PATCH',body:{...makeBody,id:'existing-id',complete_payload:true}},{});
  assert.equal(patch.legacy,true);
  assert.deepEqual(calls,[{method:'POST',flag:true},{method:'PATCH',flag:true}]);
});
