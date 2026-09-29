const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const format=require('../lib/request-format');
const rules=require('../lib/request-rules-v039');
const read=(path)=>fs.readFileSync(path,'utf8');

test('0.39 request dates and approval messages are clear in Hebrew',()=>{
  const range={request_type:'leave',request_date:'2026-10-15',request_end_date:'2026-10-20'};
  assert.equal(format.requestRangeLabel(range),'15.10.2026 עד 20.10.2026');
  assert.equal(format.requestDatePhrase(range),'לתאריכים 15.10.2026 עד 20.10.2026');
  assert.equal(format.approvalMessage(range),'בקשת החופשה שלך לתאריכים 15.10.2026 עד 20.10.2026 אושרה.');

  assert.equal(
    format.approvalMessage({request_type:'late_start',request_date:'2026-10-06',requested_start:'09:15:00'}),
    'בקשת ההתחלה המאוחרת שלך לתאריך 06.10.2026 אושרה. שעת ההתחלה המאושרת: 09:15.'
  );
  assert.equal(
    format.approvalMessage({request_type:'early_finish',request_date:'2026-10-05',requested_end:'11:00:00'}),
    'בקשת הסיום המוקדם שלך לתאריך 05.10.2026 אושרה. שעת הסיום המאושרת: 11:00.'
  );
});

test('0.39 approved time bounds use the strictest approved hours',()=>{
  const requests=[
    {requester_id:'e1',request_type:'late_start',request_date:'2026-10-05',requested_start:'08:30',status:'approved'},
    {requester_id:'e1',request_type:'late_start',request_date:'2026-10-05',requested_start:'09:00',status:'applied'},
    {requester_id:'e1',request_type:'early_finish',request_date:'2026-10-05',requested_end:'13:00',status:'approved'},
    {requester_id:'e1',request_type:'early_finish',request_date:'2026-10-05',requested_end:'12:30',status:'approved'},
  ];
  assert.deepEqual(rules.approvedTimeBounds(requests,'e1','2026-10-05'),{lateStart:'09:00',earlyFinish:'12:30'});
});

test('0.39 fixed-day authorization works around a multi-day leave without overriding the leave itself',()=>{
  const request={
    requester_id:'e1',
    request_type:'leave',
    request_date:'2026-10-15',
    request_end_date:'2026-10-20',
    status:'approved',
    allow_schedule_on_day_off:true,
    available_fixed_day_weekdays:[3],
    preferred_fixed_day_weekday:3,
  };
  assert.ok(rules.fixedDayWorkAuthorization([request],'e1','2026-10-14'));
  assert.ok(rules.fixedDayWorkAuthorization([request],'e1','2026-10-21'));
  assert.equal(rules.fixedDayWorkAuthorization([request],'e1','2026-10-28'),null);
  assert.ok(rules.approvedAbsence([request],'e1','2026-10-15'));
  assert.equal(rules.approvedAbsence([request],'e1','2026-10-14'),null);
});

test('0.39 API uses the request and scheduling wrappers',()=>{
  const api=read('api/index.js');
  assert.match(api,/hotfix-v039/);
  assert.match(api,/requests-v039/);
  assert.match(api,/shifts-v039/);
});

test('0.39 automatic scheduling adds approved fixed-day availability and a visible note',()=>{
  const hotfix=read('lib/hotfix-v039.js');
  assert.match(hotfix,/approved_fixed_day/);
  assert.match(hotfix,/day_type:'as_needed'/);
  assert.match(hotfix,/עבודה ביום חופשי שאושרה בבקשה/);
  assert.match(hotfix,/approved_late_start/);
  assert.match(hotfix,/approved_early_finish/);
});

test('0.39 request UI includes period filtering, submission metadata and manual leave completion',()=>{
  const patch=read('patch-v039.js');
  assert.match(patch,/requestPeriodMonth/);
  assert.match(patch,/הוגשה ע״י/);
  assert.match(patch,/שעת התחלה/);
  assert.match(patch,/שעת סיום/);
  assert.match(patch,/manual_leave_form_completed/);
  assert.match(patch,/ממתין לעובד בהחלפה/);
  assert.doesNotMatch(patch,/דורש החלטה/);
});

test('0.39 migration canonicalizes historic request hours and adds the missing FK index',()=>{
  const sql=read('supabase/update-v0.39.0.sql');
  assert.match(sql,/manual_leave_form_completed boolean not null default false/);
  assert.match(sql,/request_type='early_finish'/);
  assert.match(sql,/request_type='late_start'/);
  assert.match(sql,/hadas_requests_cancellation_decided_by_idx/);
});

test('0.39 package version is synchronized',()=>{
  assert.equal(JSON.parse(read('package.json')).version,'0.39.0');
});
