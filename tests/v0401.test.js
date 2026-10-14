const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const root=path.join(__dirname,'..');
const serverPath=path.join(root,'handlers/employees.js');
const src=fs.readFileSync(serverPath,'utf8');
const mod={exports:{}};
new Function('require','module','exports',src+'\nmodule.exports._testOnly={employeePayload,normalizeWeeklyPatterns};')(createRequire(serverPath),mod,mod.exports);
const {employeePayload,normalizeWeeklyPatterns}=mod.exports._testOnly;
test('editing hours preserves an existing fixed class even if stale form sends blank',()=>{
 const payload=employeePayload({job_title:'סייעת/ סייע',current_job_title:'סייעת/ סייע',assignment_mode:'fixed',current_assignment_mode:'fixed',primary_class_id:'',current_primary_class_id:'class-original',default_start:'08:00',default_end:'15:30'});
 assert.equal(payload.primary_class_id,'class-original');
 assert.equal(payload.default_start,'08:00');
});
test('explicit rotation still clears a previous fixed class',()=>{
 const payload=employeePayload({job_title:'סייעת/ סייע',current_job_title:'סייעת/ סייע',assignment_mode:'rotation',current_assignment_mode:'fixed',primary_class_id:'',current_primary_class_id:'class-original'});
 assert.equal(payload.primary_class_id,null);
});
test('weekly time input validates all six days before any writes',()=>{
 const rows=Array.from({length:6},(_,weekday)=>({weekday,day_type:'work',start_time:'08:00',end_time:weekday===5?'12:00':'15:30'}));
 assert.equal(normalizeWeeklyPatterns(rows,'fixed').length,6);
 assert.throws(()=>normalizeWeeklyPatterns(rows.map((row)=>row.weekday===2?{...row,end_time:'07:00'}:row),'fixed'));
});
test('realtime selector and Windows 24h validation repairs are present',()=>{
 const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
 assert.match(app,/selectedClassId = employeeClassSelect\.value/);
 assert.match(app,/employeeClassSelect\.value=selectedClassId/);
 assert.match(app,/input\.addEventListener\('focus',normalize\)/);
 assert.match(app,/if \(!form\.reportValidity\(\)\) return/);
});
test('patterns are updated with conflict-safe upsert, not delete first',()=>{
 assert.match(src,/onConflict:'employee_id,weekday'/);
 assert.match(src,/if \(Array\.isArray\(body\.weekly_patterns\)\) normalizeWeeklyPatterns/);
});
