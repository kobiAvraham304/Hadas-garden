const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=(path)=>fs.readFileSync(path,'utf8');

test('0.39.1 personal schedule shows general daycare closures',()=>{
  const patch=read('patch-v0391.js');
  assert.match(patch,/generalDaysOffRows/);
  assert.match(patch,/v0391-personal-general-off/);
  assert.match(patch,/חופש כללי/);
  assert.match(patch,/#scheduleExport/);
  assert.match(patch,/#v033DashboardWeek/);
});

test('0.39.1 removes redundant selected-week summary from automatic scheduling',()=>{
  const patch=read('patch-v0391.js');
  const css=read('patch-v0391.css');
  assert.match(patch,/v032-auto-week-selected/);
  assert.match(css,/#autoScheduleDialog \.v032-auto-week-selected\{display:none!important\}/);
});

test('0.39.1 adds development credit to feedback modal',()=>{
  const patch=read('patch-v0391.js');
  assert.match(patch,/פיתוח: קובי אברהם/);
  assert.match(patch,/v0391-feedback-credit/);
});

test('0.39.1 uses narrow render hooks without a broad DOM observer',()=>{
  const patch=read('patch-v0391.js');
  assert.match(patch,/requestAnimationFrame\(enhancePersonalSchedules\)/);
  assert.doesNotMatch(patch,/new MutationObserver/);
});

test('0.39.1 version markers are synchronized',()=>{
  assert.equal(JSON.parse(read('package.json')).version,'0.39.2');
  assert.match(read('patch-v025.js'),/const VERSION = '0\.39\.2'/);
  assert.match(read('patch-v025.js'),/patch-v0391\.js\?v=0391/);
  assert.match(read('VERSION.md'),/^# 0\.39\.2/);
});

test('0.39.1 adds an index for manual leave completion foreign-key lookups',()=>{
  const sql=read('supabase/update-v0.39.1.sql');
  assert.match(sql,/hadas_requests_manual_leave_form_completed_by_idx/);
  assert.match(sql,/manual_leave_form_completed_by/);
  assert.doesNotMatch(sql,/drop table|truncate table|delete from/i);
});
