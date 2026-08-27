const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('0.20 version metadata and health checks are aligned',()=>{
  assert.match(read('supabase/update-v0.20.0.sql'),/'0\.20\.0'/);
});

test('0.20 session validation uses one service-only RPC with guarded fallback',()=>{
  const server=read('lib/server.js'); const schema=read('supabase/schema.sql'); const migration=read('supabase/update-v0.20.0.sql');
  assert.match(server,/db\(\)\.rpc\('hadas_get_session_context'/);
  assert.match(server,/PGRST202/); assert.match(server,/tokenHash = sha256\(token\)/);
  for(const sql of [schema,migration]){
    assert.match(sql,/create or replace function public\.hadas_get_session_context/);
    assert.match(sql,/security definer/); assert.match(sql,/set search_path=pg_catalog,public/);
    assert.match(sql,/revoke all on function public\.hadas_get_session_context\(text\) from public, anon, authenticated/);
  }
});

test('0.20 bootstrap avoids redundant manager-only and duplicate date queries',()=>{
  const data=read('handlers/data.js');
  assert.match(data,/manager \? db\(\)\.from\('hadas_users'\)/);
  assert.match(data,/manager \? db\(\)\.from\('hadas_employee_private'\)/);
  assert.match(data,/manager \? db\(\)\.from\('hadas_employee_class_constraints'\)/);
  assert.match(data,/todayInSelectedWeek \? Promise\.resolve/);
  assert.match(data,/dailyInSelectedWeek \? shifts\.filter/);
  assert.match(data,/dailyUsesAttendance \? attendance/);
});

test('0.20 realtime refreshes are coalesced instead of full reload per event',()=>{
  const app=read('app.js');
  assert.match(app,/realtimeTopics: new Set\(\)/);
  assert.match(app,/state\.realtimeTopics\.add\(topic\)/);
  assert.match(app,/\}, 650\);/);
  assert.match(app,/elapsed < 1200/);
  assert.match(app,/onlyTopics/);
});

test('0.20 fresh schema accepts as-needed days without fake times',()=>{
  const schema=read('supabase/update-v0.20.0.sql');
  assert.match(schema,/day_type in \('day_off','as_needed'\) and start_time is null and end_time is null/);
});

test('0.20 database hardening covers foreign keys, request types and explicit server-only policies',()=>{
  const migration=read('supabase/update-v0.20.0.sql');
  for(const token of ['hadas_requests_requester_fk_idx','hadas_attendance_employee_fk_idx','hadas_announcements_class_fk_idx','hadas_daily_operations_class_fk_idx','hadas_task_assignees_employee_fk_idx','hadas_documents_class_fk_idx','hadas_documents_created_by_fk_idx']) assert.match(migration,new RegExp(token));
  assert.match(migration,/request_type in \('leave','day_off','late_start','early_finish','sick','swap'\)/);
  assert.match(migration,/hadas_schedule_acknowledgements/); assert.match(migration,/CREATE POLICY hadas_server_only_deny/);
  assert.doesNotMatch(migration,/drop table/i);
});

test('0.20 UI adds keyboard focus, touch containment and reduced-motion safeguards',()=>{
  const css=read('styles.css');
  assert.match(css,/:focus-visible/); assert.match(css,/touch-action:manipulation/);
  assert.match(css,/content-visibility:auto/); assert.match(css,/env\(safe-area-inset-left\)/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});

test('repository ignores platform junk and has permanent QA workflow',()=>{
  assert.match(read('.gitignore'),/\.DS_Store/);
  const workflow=read('.github/workflows/qa.yml');
  assert.match(workflow,/npm test/); assert.match(workflow,/npm run check/); assert.match(workflow,/node --check/);
});
