const test=require('node:test');
const assert=require('node:assert/strict');
const { generateAutomaticSchedule }=require('../lib/auto-schedule');
const { leaderRequiredAt, coverageSlots, validateWeek }=require('../lib/schedule');

function settings(extra={}) { return { opening_time:'07:30', morning_end_time:'08:15', morning_required_staff:3, closing_time:'15:30', friday_closing_time:'12:00', required_staff:4, closing_required_staff:3, closing_window_minutes:30, validation_slot_minutes:30, require_leader:true, ...extra }; }
function employee(id,extra={}) { return { id,full_name:id,job_title:'סייעת/ סייע',active:true,is_schedulable:true,assignment_mode:'fixed',primary_class_id:'c1',default_start:'07:30',default_end:'15:30',weekly_hours:null,max_weekly_hours:null,...extra }; }
function work(employeeId,weekday,start='07:30',end='15:30'){return {employee_id:employeeId,weekday,day_type:'work',start_time:start,end_time:end};}
function off(employeeId,weekday){return {employee_id:employeeId,weekday,day_type:'day_off',start_time:null,end_time:null};}
function need(employeeId,weekday){return {employee_id:employeeId,weekday,day_type:'as_needed',start_time:null,end_time:null};}
function fillOtherDays(employees,patterns){ for(const e of employees) for(let d=1;d<=5;d++) if(!patterns.some(p=>p.employee_id===e.id&&p.weekday===d)) patterns.push(off(e.id,d)); }

test('0.21 quality: every explicit fixed work day is rostered even above minimum staffing',()=>{
  const classes=[{id:'c1',name:'כיתה',active:true,sort_order:1}];
  const employees=[employee('teacher',{job_title:'גננת'}),employee('lead',{job_title:'סייעת מובילה'}),employee('a'),employee('b'),employee('extra')];
  const patterns=employees.map(e=>work(e.id,0)); fillOtherDays(employees,patterns);
  const plan=generateAutomaticSchedule({weekStart:'2026-08-30',employees,classes,patterns,constraints:[],requests:[],settings:settings(),existingShifts:[],previousShifts:[]});
  const sunday=plan.finalRows.filter(r=>r.shift_date==='2026-08-30');
  assert.equal(sunday.length,5);
  assert.deepEqual(new Set(sunday.map(r=>r.employee_id)),new Set(employees.map(e=>e.id)));
  assert.equal(plan.metrics.mandatoryWorkMissed,0);
});

test('0.21 quality: scarcity-aware allocation protects morning bottleneck and uses late worker late',()=>{
  const classes=[{id:'c1',name:'סיני',active:true,sort_order:1}];
  const employees=[
    employee('teacher',{job_title:'גננת',default_start:'08:00',default_end:'13:30'}),
    employee('lead',{job_title:'סייעת מובילה',default_start:'08:15'}), employee('a'), employee('b'),
    employee('full',{assignment_mode:'substitute',primary_class_id:null}),
    employee('late',{assignment_mode:'substitute',primary_class_id:null,default_start:'13:30'}),
  ];
  const patterns=[work('teacher',0,'08:00','13:30'),work('lead',0,'08:15','15:30'),work('a',0),work('b',0),need('full',0),need('late',0)]; fillOtherDays(employees,patterns);
  const plan=generateAutomaticSchedule({weekStart:'2026-08-30',employees,classes,patterns,constraints:[],requests:[],settings:settings(),existingShifts:[],previousShifts:[]});
  const full=plan.finalRows.find(r=>r.employee_id==='full'&&r.shift_date==='2026-08-30');
  const late=plan.finalRows.find(r=>r.employee_id==='late'&&r.shift_date==='2026-08-30');
  assert.deepEqual([full.start_time,full.end_time],['07:30','08:00']);
  assert.deepEqual([late.start_time,late.end_time],['13:30','15:00']);
});

test('0.21 quality: as-needed staff are not added when fixed work already covers the class',()=>{
  const classes=[{id:'c1',name:'כיתה',active:true,sort_order:1}];
  const employees=[employee('teacher',{job_title:'גננת'}),employee('a'),employee('b'),employee('c'),employee('sub',{assignment_mode:'substitute',primary_class_id:null})];
  const patterns=[work('teacher',0),work('a',0),work('b',0),work('c',0),need('sub',0)]; fillOtherDays(employees,patterns);
  const plan=generateAutomaticSchedule({weekStart:'2026-08-30',employees,classes,patterns,constraints:[],requests:[],settings:settings(),existingShifts:[],previousShifts:[]});
  assert.equal(plan.finalRows.some(r=>r.employee_id==='sub'),false);
  assert.equal(plan.metrics.asNeededCount,0);
});

test('0.21 quality: an as-needed worker may cover two non-overlapping critical windows in one day',()=>{
  const classes=[{id:'c1',name:'א',active:true,sort_order:1},{id:'c2',name:'ב',active:true,sort_order:2}];
  const employees=[
    employee('t1',{job_title:'גננת',primary_class_id:'c1'}), employee('a1',{primary_class_id:'c1'}),employee('a2',{primary_class_id:'c1'}),employee('a3',{primary_class_id:'c1'}),
    employee('t2',{job_title:'גננת',primary_class_id:'c2',default_start:'08:00',default_end:'14:30'}),employee('b1',{primary_class_id:'c2'}),employee('b2',{primary_class_id:'c2'}),employee('b3',{primary_class_id:'c2',default_start:'07:45'}),
    employee('sub',{assignment_mode:'substitute',primary_class_id:null}),
  ];
  const patterns=[work('t1',0),work('a1',0),work('a2',0),work('a3',0),work('t2',0,'08:00','14:30'),work('b1',0),work('b2',0),work('b3',0,'07:45','15:30'),need('sub',0)]; fillOtherDays(employees,patterns);
  const plan=generateAutomaticSchedule({weekStart:'2026-08-30',employees,classes,patterns,constraints:[],requests:[],settings:settings(),existingShifts:[],previousShifts:[]});
  const subRows=plan.finalRows.filter(r=>r.employee_id==='sub'&&r.shift_date==='2026-08-30');
  assert.equal(subRows.length,2);
  assert.ok(subRows.some(r=>r.start_time==='07:30'&&r.end_time==='07:45'));
  assert.ok(subRows.some(r=>r.start_time==='14:30'&&r.end_time==='15:00'));
});

test('0.21 quality: borrowing fixed staff is a last resort and source class remains compliant',()=>{
  const classes=[{id:'c1',name:'א',active:true,sort_order:1},{id:'c2',name:'ב',active:true,sort_order:2}];
  const employees=[employee('t1',{job_title:'גננת'}),employee('a1'),employee('a2'),employee('a3'),employee('surplus'),employee('t2',{job_title:'גננת',primary_class_id:'c2'}),employee('b1',{primary_class_id:'c2'}),employee('b2',{primary_class_id:'c2'})];
  const patterns=employees.map(e=>work(e.id,0)); fillOtherDays(employees,patterns);
  const plan=generateAutomaticSchedule({weekStart:'2026-08-30',employees,classes,patterns,constraints:[],requests:[],settings:settings({morning_required_staff:4}),existingShifts:[],previousShifts:[]});
  assert.equal(plan.metrics.borrowedCount,1);
  const sunday=plan.finalRows.filter(r=>r.shift_date==='2026-08-30');
  assert.equal(sunday.filter(r=>r.class_id==='c1').length,4);
  assert.equal(sunday.filter(r=>r.class_id==='c2').length,4);
  assert.equal(sunday.find(r=>r.employee_id==='t1').class_id,'c1');
  assert.equal(sunday.find(r=>r.employee_id==='t2').class_id,'c2');
});

test('0.21 quality: zero weekly hours means unset, not zero-hour contract',()=>{
  const classes=[{id:'c1',name:'כיתה',active:true,sort_order:1}];
  const employees=[employee('teacher',{job_title:'גננת',weekly_hours:0}),employee('a'),employee('b'),employee('c')];
  const patterns=employees.map(e=>work(e.id,0)); fillOtherDays(employees,patterns);
  const plan=generateAutomaticSchedule({weekStart:'2026-08-30',employees,classes,patterns,constraints:[],requests:[],settings:settings(),existingShifts:[],previousShifts:[]});
  assert.equal(plan.employeeHours.find(x=>x.employee_id==='teacher').target,null);
});

test('0.21 quality: morning staffing is precise and leader duty starts at morning-zone end',()=>{
  const s=settings();
  assert.equal(leaderRequiredAt(s,'2026-08-30',450),false);
  assert.equal(leaderRequiredAt(s,'2026-08-30',480),false);
  assert.equal(leaderRequiredAt(s,'2026-08-30',495),true);
  const slots=coverageSlots(s,'2026-08-30',[{start_time:'07:45',end_time:'15:30'}]);
  assert.ok(slots.some(slot=>slot.start===450&&slot.end===465));
  const result=validateWeek({shifts:[
    {shift_date:'2026-08-30',class_id:'c1',employee_id:'a',start_time:'07:30',end_time:'15:30',shift_role:'staff'},
    {shift_date:'2026-08-30',class_id:'c1',employee_id:'b',start_time:'07:30',end_time:'15:30',shift_role:'staff'},
    {shift_date:'2026-08-30',class_id:'c1',employee_id:'lead',start_time:'07:45',end_time:'15:30',shift_role:'lead'},
    {shift_date:'2026-08-30',class_id:'c1',employee_id:'c',start_time:'08:15',end_time:'15:30',shift_role:'staff'},
  ],classes:[{id:'c1',name:'כיתה',active:true}],employees:[employee('a'),employee('b'),employee('lead',{job_title:'סייעת מובילה'}),employee('c')],settings:s,weekStart:'2026-08-30'});
  assert.ok(result.errors.some(e=>e.code==='understaffed'&&e.time==='07:30'&&e.end_time==='07:45'));
  assert.equal(result.errors.some(e=>e.code==='missing_leader'&&e.time==='07:30'),false);
});
