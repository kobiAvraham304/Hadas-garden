const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=(p)=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

const app=read('app.js'),handler=read('handlers/shifts.js'),fast=read('lib/shifts-v025.js'),week=read('lib/schedule.js');
const begin=handler.indexOf('async function validateShift('),end=handler.indexOf('async function loadAutomaticScheduleData(',begin);
assert.ok(begin>=0&&end>begin,'validator source exists');
const {timeToMinutes,validateWeek}=require('../lib/schedule');
const makeError=(status,message)=>Object.assign(new Error(message),{status});
function createValidationFixture({overlap=false,sick=false,forbidden=false,close='15:30'}={}){
 const date='2026-11-10';
 const employee={id:'e1',active:true,is_schedulable:true,job_title:'סייעת מובילה',can_lead:true,max_work_days_per_week:5,full_name:'דנה'};
 const info={hadas_employees:employee,hadas_classes:{id:'c1',active:true},hadas_app_settings:{id:1,opening_time:'07:30',closing_time:close,friday_closing_time:'12:00'},hadas_employee_weekly_patterns:[{employee_id:'e1',weekday:2,day_type:'work',start_time:'07:40:00',end_time:'13:00:00'}],hadas_requests:sick?[{request_type:'sick',status:'approved',request_date:date,request_end_date:date}]:[],hadas_shifts:overlap?[{id:'other'}]:[],hadas_employee_class_constraints:forbidden?[{id:'f1',reason:'לא מתאים'}]:[]};
 const db=()=>({from(table){const chain={select(){return chain},eq(){return chain},in(){return chain},lte(){return chain},gte(){return chain},lt(){return chain},gt(){return chain},neq(){return chain},limit(){return chain},maybeSingle(){return Promise.resolve({data:info[table]})},then(resolve,reject){return Promise.resolve({data:info[table]}).then(resolve,reject)}};return chain}});
 const validator=new Function('db','assertDb','httpError','timeToMinutes','closingTimeForDate','employeeCanLead','getSunday','addDays',handler.slice(begin,end)+'return validateShift;')(
 db,r=>r?.data,makeError,timeToMinutes,()=>close,()=>true,()=> '2026-11-08',()=> '2026-11-13');
 const payload={employee_id:'e1',class_id:'c1',shift_date:date,start_time:'07:40',end_time:'15:30',shift_role:'lead'};
 return {validator,payload};
}
test('fixed working hours reject a direct shift until the supervisor confirms',async()=>{
 const {validator,payload}=createValidationFixture();
 await assert.rejects(validator({...payload},null,false,false,false,false),/השעות חורגות מהשעות הקבועות 07:40–13:00/);
 const result=await validator({...payload},null,false,false,false,true);
 assert.match(result.hoursOverrideNote,/חריגה מאושרת משעות קבועות 07:40–13:00/);
 assert.match(result.hoursOverrideNote,/07:40–15:30/);
});
test('hours-only confirmation never bypasses overlaps, approved illness or forbidden classes',async()=>{
 for(const option of [{overlap:true,pattern:/שעות חופפות/},{sick:true,pattern:/מחלה מאושרת/},{forbidden:true,pattern:/איסור שיבוץ בכיתה/},{close:'15:00',pattern:/השיבוץ חייב להיות/}]){
  const {validator,payload}=createValidationFixture(option);
  await assert.rejects(validator({...payload},null,false,false,false,true),option.pattern);
 }
});
test('the fast POST and PATCH paths route the explicitly confirmed hours exception to the full validator',()=>{
 assert.match(fast,/body\.override_approved_leave === true \|\| body\.override_hours === true/);
 assert.match(handler,/body\.override_hours === true/);
 assert.match(handler,/payload\.rule_override_note=checked\.hoursOverrideNote/);
 assert.match(handler,/payload\.rule_override=true/);
 assert.match(handler,/recordChange\(caller, 'create'/);
 assert.match(handler,/recordChange\(caller, 'update'/);
});
test('week checks keep all unrelated rules in force for hours-only overrides',()=>{
 assert.match(week,/const hoursOnlyOverride=Boolean\(shift\.rule_override\)/);
 assert.match(week,/const manualOverride=Boolean\(shift\.rule_override\)&&!hoursOnlyOverride/);
 const params={
 shifts:[{employee_id:'e1',class_id:'c1',shift_date:'2026-11-10',start_time:'07:40',end_time:'15:30',shift_role:'lead',rule_override:true,rule_override_note:'חריגה מאושרת משעות קבועות 07:40–13:00 ← שיבוץ 07:40–15:30'}],
 employees:[{id:'e1',full_name:'דנה',active:true,is_schedulable:true,job_title:'סייעת מובילה'}],
 classes:[{id:'c1',name:'אודם',active:true}],
 settings:{opening_time:'07:30',closing_time:'15:30',friday_closing_time:'12:00',require_leader:false,max_daily_staff:20,validation_slot_minutes:30},
 constraints:[{employee_id:'e1',class_id:'c1',constraint_type:'forbidden'}],
 weeklyPatterns:[{employee_id:'e1',weekday:2,day_type:'work',start_time:'07:40',end_time:'13:00'}],
 requests:[{requester_id:'e1',request_type:'sick',status:'approved',request_date:'2026-11-10'}],
 weekStart:'2026-11-08'
 };
 const result=validateWeek(params);
 assert.ok(result.errors.some(x=>x.code==='approved_absence'));
 assert.ok(result.errors.some(x=>x.code==='forbidden_class'));
 assert.ok(!result.warnings.some(x=>x.code==='outside_fixed_hours'));
 assert.ok(result.warnings.some(x=>x.code==='manual_rule_override'));
});
test('the UI provides an explicit accessible approve/cancel dialog and retains the exception for unchanged edits',()=>{
 const html=read('index.html');
 assert.match(html,/id="shiftHoursOverrideDialog"/);
 assert.match(html,/value="approve">✓ אשר כחריגה ושמור/);
 assert.match(html,/value="cancel">חזרה לעריכה/);
 assert.match(app,/isFixedHoursShiftError\(error\)/);
 assert.match(app,/if\(!await confirmFixedHoursShiftOverride\(data,employeeName,error\.message\)\) return/);
 assert.match(app,/data\.override_hours=true/);
 assert.match(app,/data\.override_hours=data\.override_hours==='true' && form\.dataset\.hoursOverrideSignature===fixedHoursOverrideSignature\(data\)/);
 assert.match(app,/const existingHoursOverride = Boolean\(shift\.rule_override\)/);
 assert.match(app,/await apiFetch\('\/api\/shifts', \{method:data\.id\?'PATCH':'POST',body:data\}\)/);
 assert.match(read('patch-v025.js'),/const VERSION = '0\.40\.13'/);
 assert.equal(require('../package.json').version,'0.40.13');
});
