const test = require('node:test');
const assert = require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('0.40.3 clickable problem badge and green quick approval target a concrete date/class',()=>{
 const patch=read('patch-v027.js');
 assert.match(patch,/data-v0403-issue-open/);
 assert.match(patch,/data-v0403-issue-quick/);
 assert.match(patch,/cellIssues\.every/);
 assert.match(patch,/if \(!isManager\(\)\)/);
 const ui=read('schedule-issues-v0403.js');
 assert.match(ui,/action:'approve_issue'/);
 assert.match(ui,/__hadasV030RefreshValidation/);
 assert.match(ui,/approveItems\(getErrors\(selected.date,selected.classId\)\)/);
});
test('schedule issue UI registers capture click handling, denies unsafe quick approvals',()=>{
 const callbacks=[];
 vm.runInNewContext(read('schedule-issues-v0403.js'),{
  window:{},document:{addEventListener:(name,fn,capture)=>callbacks.push({name,fn,capture})}
 });
 assert.equal(callbacks.length,1);
 assert.equal(callbacks[0].name,'click');
 assert.equal(callbacks[0].capture,true);
 for(const code of ['overlap','outside_opening_hours','approved_absence','forbidden_class','teacher_fixed_class'])
  assert.match(read('schedule-issues-v0403.js'),new RegExp(code));
});
test('one recommended action and a real modal per issue',()=>{
 const ui=read('schedule-issues-v0403.js');
 assert.match(ui,/data-v0403-fix-index/);
 assert.match(ui,/data-v0403-approve-index/);
 assert.match(ui,/openShiftDialog\(/);
 assert.match(ui,/showModal\(\)/);
 assert.match(ui,/הפתרון המומלץ/);
});
test('weekly default is inherited and a manually overridden day is preserved',()=>{
 const app=read('app.js');
 const start=app.indexOf('function weeklyEffectiveDefault(weekday)');
 const stop=app.indexOf('function renderWeeklyPatternFields(employee = {})',start);
 assert.ok(start>0&&stop>start);
 const form={elements:{default_start:{value:'09:00'},default_end:{value:'15:00'}}};
 const mkRow=(weekday,override,start,end)=>{
  const elements={'.weekly-day-type':{value:'work'},'.weekly-start':{value:start},'.weekly-end':{value:end},'.v0403-hours-badge':{textContent:''},'.v0403-reset-hours':{hidden:true}};
  return {dataset:{weekday:String(weekday),hoursOverride:String(override)},classList:{toggle(){}},elements};
 };
 const a=mkRow(0,false,'08:00','15:30'),b=mkRow(1,true,'08:30','14:00'),fri=mkRow(5,false,'08:00','12:00');
 const context={
  $:(selector,root)=>root?root.elements[selector]:form,
  $$:()=>[a,b,fri],
  trimTime:value=>String(value||'').slice(0,5),
  timeToMinutes:time=>{const [h,m]=time.split(':').map(Number);return h*60+m;}
 };
 const fn=new Function('$','$$','trimTime','timeToMinutes',app.slice(start,stop)+' return syncInheritedWeeklyHours;')(context.$,context.$$,context.trimTime,context.timeToMinutes);
 fn();
 assert.equal(a.elements['.weekly-start'].value,'09:00');
 assert.equal(a.elements['.weekly-end'].value,'15:00');
 assert.equal(b.elements['.weekly-start'].value,'08:30');
 assert.equal(b.elements['.weekly-end'].value,'14:00');
 assert.equal(fri.elements['.weekly-end'].value,'12:00');
});
test('employee hours form includes clear weekly baseline and visible day override/reset',()=>{
 const html=read('index.html'),app=read('app.js'),css=read('schedule-issues-v0403.css');
 assert.match(html,/v0403-default-hours/);
 assert.equal((html.match(/name="default_start"/g)||[]).length,1);
 assert.equal((html.match(/name="default_end"/g)||[]).length,1);
 assert.match(app,/weekly-pattern-row/);
 assert.match(app,/!hasPatterns && weekday!==5 \? 'work'/);
 assert.match(app,/שעות שונות ביום הזה/);
 assert.match(app,/v0403-reset-hours/);
 assert.match(css,/weekly-pattern-row\.hours-override/);
 assert.match(read('patch-v028.js'),/patch-v027\.js\?v=0403/);
});
