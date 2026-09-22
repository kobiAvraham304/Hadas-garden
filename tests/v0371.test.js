const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const { generateAutomaticSchedule }=require('../lib/auto-schedule');

const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

function employee(id,extra={}) {
  return {id,full_name:id,job_title:'סייעת/ סייע',active:true,is_schedulable:true,assignment_mode:'fixed',primary_class_id:'c1',default_start:'07:30',default_end:'15:30',weekly_hours:null,max_weekly_hours:null,...extra};
}
function pattern(id,day_type,start='07:30',end='15:30') {
  return {employee_id:id,weekday:0,day_type,start_time:start,end_time:end};
}
function settings(extra={}) {
  return {opening_time:'07:30',morning_end_time:'08:15',morning_required_staff:2,closing_time:'15:30',friday_closing_time:'12:00',required_staff:2,closing_required_staff:2,closing_window_minutes:30,validation_slot_minutes:15,require_leader:false,max_daily_staff:5,...extra};
}

test('0.37.1 merges separated gaps for the same worker into one continuous same-class plan',()=>{
  const plan=generateAutomaticSchedule({
    weekStart:'2026-09-27',selectedDates:['2026-09-27'],
    employees:[
      employee('full'),
      employee('middle',{default_start:'09:30',default_end:'12:45'}),
      employee('lihi',{assignment_mode:'substitute',primary_class_id:null}),
    ],
    classes:[{id:'c1',name:'סיני',active:true,sort_order:1}],
    patterns:[
      pattern('full','work','07:30','15:30'),
      pattern('middle','work','09:30','12:45'),
      pattern('lihi','as_needed','07:30','15:30'),
    ],
    constraints:[],requests:[],settings:settings(),existingShifts:[],previousShifts:[],
  });
  assert.equal(plan.generated.some((row)=>row.employee_id==='lihi'),false);
  assert.equal(plan.reviewSuggestions.length,1);
  const suggestion=plan.reviewSuggestions[0];
  assert.equal(suggestion.employee_id,'lihi');
  assert.equal(suggestion.plan,true);
  assert.equal(suggestion.start_time,'07:30');
  assert.equal(suggestion.end_time,'15:30');
  assert.equal(suggestion.segments.length,1);
  assert.equal(suggestion.segments[0].class_id,'c1');
  assert.equal(suggestion.segments[0].start_time,'07:30');
  assert.equal(suggestion.segments[0].end_time,'15:30');
  assert.match(suggestion.explanation,/רצף עבודה אחד/);
});

test('0.37.1 may move one as-needed worker between classes instead of proposing two workers',()=>{
  const plan=generateAutomaticSchedule({
    weekStart:'2026-09-27',selectedDates:['2026-09-27'],
    employees:[
      employee('sinai-afternoon',{primary_class_id:'c1',default_start:'12:45',default_end:'15:30'}),
      employee('gilboa-morning',{primary_class_id:'c2',default_start:'07:30',default_end:'12:45'}),
      employee('lihi',{assignment_mode:'substitute',primary_class_id:null}),
    ],
    classes:[
      {id:'c1',name:'סיני',active:true,sort_order:1},
      {id:'c2',name:'גלבוע',active:true,sort_order:2},
    ],
    patterns:[
      pattern('sinai-afternoon','work','12:45','15:30'),
      pattern('gilboa-morning','work','07:30','12:45'),
      pattern('lihi','as_needed','07:30','15:30'),
    ],
    constraints:[],requests:[],settings:settings({morning_required_staff:1,required_staff:1,closing_required_staff:1,max_daily_staff:2}),existingShifts:[],previousShifts:[],
  });
  assert.equal(plan.generated.some((row)=>row.employee_id==='lihi'),false);
  assert.equal(plan.reviewSuggestions.length,1);
  const suggestion=plan.reviewSuggestions[0];
  assert.equal(suggestion.employee_id,'lihi');
  assert.equal(suggestion.plan,true);
  assert.deepEqual(suggestion.segments.map((row)=>[row.class_id,row.start_time,row.end_time]),[
    ['c1','07:30','12:45'],
    ['c2','12:45','15:30'],
  ]);
  assert.match(suggestion.explanation,/סיני/);
  assert.match(suggestion.explanation,/גלבוע/);
});

test('0.37.1 suggestion UI supports multi-segment plans and safe rollback after revalidation',()=>{
  const app=read('app.js');
  const handler=read('handlers/shifts.js');
  assert.match(app,/autoReviewSuggestionRows/);
  assert.match(app,/פתרון מרוכז לעובד\/ת אחת/);
  assert.match(app,/הוסף את התכנית לשיבוץ/);
  assert.match(app,/introducedHard/);
  assert.match(app,/render:false/);
  assert.match(handler,/Array\.isArray\(suggestion\.segments\)/);
  assert.match(handler,/allAdded=segments\.every/);
});

test('0.37.1 release chain exposes the updated planner and UI',()=>{
  assert.equal(JSON.parse(read('package.json')).version,'0.37.3');
  assert.match(read('index.html'),/app\.js\?v=0373/);
  assert.match(read('index.html'),/patch-v025\.js\?v=0373/);
  assert.match(read('patch-v025.js'),/VERSION = '0\.37\.3'/);
  assert.match(read('patch-v025.js'),/patch-v033\.js\?v=0333hf14/);
  assert.match(read('patch-v033.js'),/auto-review-route/);
});
