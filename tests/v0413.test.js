const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const {isNormallyOff}=require('../lib/work-request-v0413');

test('regular work and as-needed days are not eligible for a work request',()=>{
 const patterns=[{weekday:1,day_type:'day_off'},{weekday:2,day_type:'work'},{weekday:3,day_type:'as_needed'}];
 assert.equal(isNormallyOff({fixed_day_off:1},patterns,'2026-11-16'),true);
 assert.equal(isNormallyOff({fixed_day_off:1},patterns,'2026-11-17'),false);
 assert.equal(isNormallyOff({fixed_day_off:1},patterns,'2026-11-18'),false);
 assert.equal(isNormallyOff({fixed_day_off:null},[],'2026-11-15'),false);
 assert.equal(isNormallyOff({fixed_day_off:0},[],'2026-11-15'),true);
 assert.equal(isNormallyOff({fixed_day_off:6},[],'2026-11-14'),false);
});
test('work requests check occupied days, approved absences and duplicate pending requests',()=>{
 const s=read('lib/work-request-v0413.js');
 for(const a of ['action===\'work_days\'','assigned.has(d)','workPending.has(d)','closed.some(row=>','!available.dates.includes(date)','status:\'pending\'','push:true'])assert.ok(s.includes(a),a);
 assert.ok(read('lib/requests-v039.js').includes("require('./work-request-v0413')"));
});
test('work approval is a single SQL transaction with restricted execute permission and a linked editable shift',()=>{
 const sql=read('migrations/20261113_work_requests.sql');
 for(const line of ['ALTER TABLE public.hadas_requests','CREATE OR REPLACE FUNCTION public.hadas_approve_work_request','FOR UPDATE','INSERT INTO public.hadas_shifts','UPDATE public.hadas_requests SET',"status='applied',shift_id=v_shift.id",'INSERT INTO public.hadas_schedule_changes','REVOKE ALL ON FUNCTION','TO service_role'])
   assert.ok(sql.includes(line),line);
 assert.match(read('lib/shifts-v039.js'),/workLinked/);
 assert.match(read('lib/schedule.js'),/linkedWorkRequest/);
});
test('the scheduler sees three active classroom choices, preselected home class and requested hours',()=>{
 const html=read('index.html'),ui=read('work-ui-v0413.js');
 for(const needle of ['value="work"','id="workDaySelect"','id="workApprovalClasses"'])assert.ok(html.includes(needle));
 for(const needle of ['state.classes.filter(row=>row.active!==false)','person.primary_class_id','תעדוף כיתה קבועה',"action:'approve_work'"])assert.ok(ui.includes(needle));
 assert.match(read('app.js'),/window\.HadasWork\?\.interceptApproval\(event\)/);
});
test('time fields allow 4 digit keyboard typing on desktop while preserving native time inputs on phones',()=>{
 const s=read('app.js');
 assert.ok(s.includes("matchMedia('(pointer:fine)')"));
 assert.ok(s.includes("input.type = 'text'"));
 assert.ok(s.includes("input.value.trim()"));
 assert.match(s,/initializeWindows24HourFields\(\)/);
});
test('new version assets are aligned',()=>{
 assert.equal(require('../package.json').version,'0.40.14');
 const html=read('index.html');
 for(const file of ['app.js?v=0414','work-ui-v0413.js?v=0414','styles.css?v=0414','patch-v025.js?v=0414'])assert.ok(html.includes(file));
 assert.match(read('patch-v025.js'),/const VERSION = '0\.40\.14'/);
});
