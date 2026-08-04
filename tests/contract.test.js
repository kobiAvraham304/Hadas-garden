const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
function jsFiles(folder){ return fs.readdirSync(path.join(root,folder)).filter(file=>file.endsWith('.js')).sort(); }

test('Vercel deploys one unified API function and every handler loads',()=>{
  assert.deepEqual(jsFiles('api'),['index.js']);
  const router=require(path.join(root,'api','index.js'));
  assert.equal(typeof router,'function');
  const handlers=jsFiles('handlers');
  assert.ok(handlers.length >= 15);
  assert.ok(!handlers.includes('documents.js'));
  for(const file of handlers){
    delete require.cache[require.resolve(path.join(root,'handlers',file))];
    assert.equal(typeof require(path.join(root,'handlers',file)),'function',file);
  }
  assert.deepEqual(Object.keys(router.routes).sort(),handlers.map(f=>f.replace(/\.js$/,'')).sort());
});

test('all public API paths are rewritten to the single function',()=>{
  const vercel=JSON.parse(read('vercel.json'));
  assert.deepEqual(Object.keys(vercel.functions),['api/index.js']);
  const rewrites=new Map(vercel.rewrites.map(item=>[item.source,item.destination]));
  for(const file of jsFiles('handlers')){
    const name=file.replace(/\.js$/,'');
    assert.equal(rewrites.get(`/api/${name}`),`/api/index?route=${name}`);
  }
  assert.equal(rewrites.has('/api/documents'),false);
});

test('all database tables referenced by handlers exist in the clean SQL schema',()=>{
  const schema=read('supabase/schema.sql');
  const code=[...jsFiles('handlers').map(f=>read(`handlers/${f}`)),read('lib/server.js')].join('\n');
  const tables=[...new Set([...code.matchAll(/\.from\(['"]([a-z0-9_]+)['"]\)/g)].map(m=>m[1]))].sort();
  const missing=tables.filter(table=>!new RegExp(`create table if not exists public\\.${table}\\b`,'i').test(schema));
  assert.deepEqual(missing,[]);
});

test('all RPCs referenced by handlers exist in the clean SQL schema',()=>{
  const schema=read('supabase/schema.sql');
  const code=jsFiles('handlers').map(f=>read(`handlers/${f}`)).join('\n');
  const rpcs=[...new Set([...code.matchAll(/\.rpc\(['"]([a-z0-9_]+)['"]/g)].map(m=>m[1]))];
  assert.ok(rpcs.length>=1);
  for(const rpc of rpcs)assert.match(schema,new RegExp(`function public\\.${rpc}\\s*\\(`,'i'),rpc);
});

test('SQL blocks and CSS braces are balanced',()=>{
  for(const file of ['supabase/schema.sql','supabase/update-v0.5.0.sql','supabase/update-v0.11.0.sql','supabase/update-v0.12.0.sql']){
    const sql=read(file); assert.equal((sql.match(/\$\$/g)||[]).length%2,0,file);
  }
  const css=read('styles.css');
  assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
});

test('clean installer repairs the legacy classes trigger problem',()=>{
  const schema=read('supabase/schema.sql');
  const classes=schema.match(/create table if not exists public\.hadas_classes\s*\(([\s\S]*?)\n\);/i)?.[1]||'';
  assert.match(classes,/updated_at\s+timestamptz/i);
  const triggerTables=[...schema.matchAll(/FOREACH t IN ARRAY ARRAY\[([\s\S]*?)\]\s*LOOP/g)]
    .map(m=>m[1]).find(block=>block.includes('hadas_app_meta')&&block.includes('hadas_task_assignees'))||'';
  for(const table of [...triggerTables.matchAll(/'([a-z0-9_]+)'/g)].map(m=>m[1])){
    const body=schema.match(new RegExp(`create table if not exists public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`,'i'))?.[1]||'';
    assert.match(body,/updated_at\s+timestamptz/i,`${table} must contain updated_at before attaching the trigger`);
  }
});

test('0.5 migration is non-destructive and adds publication and audience infrastructure',()=>{
  const migration=read('supabase/update-v0.5.0.sql');
  assert.match(migration,/begin;/i);
  assert.match(migration,/commit;/i);
  assert.doesNotMatch(migration,/drop table/i);
  assert.match(migration,/hadas_schedule_publications/);
  assert.match(migration,/hadas_schedule_changes/);
  assert.match(migration,/hadas_announcement_recipients/);
  assert.match(migration,/schema_version='0\.5\.0'/);
});



test('0.9 migration is non-destructive and adds weekly employment patterns safely',()=>{
  const migration=read('supabase/update-v0.9.0.sql');
  assert.match(migration,/begin;/i);
  assert.match(migration,/commit;/i);
  assert.doesNotMatch(migration,/drop table/i);
  assert.match(migration,/add column if not exists max_weekly_hours/i);
  assert.match(migration,/add column if not exists assignment_mode/i);
  assert.match(migration,/add column if not exists is_schedulable/i);
  assert.match(migration,/create table if not exists public\.hadas_employee_weekly_patterns/i);
  assert.match(migration,/day_type in \('work','day_off'\)/i);
  assert.match(migration,/job_title in \('אחות','מזכירה'\)/);
  assert.match(migration,/schema_version='0\.9\.0'/);
  assert.match(migration,/enable row level security/i);
  assert.match(migration,/grant all on table public\.hadas_employee_weekly_patterns to service_role/i);
});



test('0.10 migration is non-destructive and adds notifications, date ranges and private sick certificates',()=>{
  const migration=read('supabase/update-v0.10.0.sql');
  assert.match(migration,/begin;/i);
  assert.match(migration,/commit;/i);
  assert.doesNotMatch(migration,/drop table/i);
  assert.match(migration,/add column if not exists request_end_date/i);
  assert.match(migration,/attachment_path/i);
  assert.match(migration,/create table if not exists public\.hadas_notifications/i);
  assert.match(migration,/hadas-sick-certificates/);
  assert.match(migration,/schema_version='0\.10\.0'/);
  assert.match(migration,/enable row level security/i);
});

test('service role grants remain limited to Hadas objects',()=>{
  const schema=read('supabase/schema.sql');
  assert.doesNotMatch(schema,/grant all on all tables in schema public/i);
  assert.doesNotMatch(schema,/grant all on all sequences in schema public/i);
  assert.match(schema,/left\(tablename, 6\) = 'hadas_'/i);
  assert.match(schema,/left\(sequence_name, 6\) = 'hadas_'/i);
});

test('approved requests enter the schedule publication workflow atomically',()=>{
  const requests=read('handlers/requests.js');
  const schema=read('supabase/schema.sql');
  const migration=read('supabase/update-v0.10.0.sql');
  assert.match(requests,/\.rpc\(['"]hadas_apply_approved_request['"]/);
  assert.doesNotMatch(requests,/from\(['"]hadas_shifts['"]\)\.delete\(\)/);
  assert.match(requests,/action === 'apply'[\s\S]*emitEvent\('shifts'\)/);
  for(const sql of [schema,migration]){
    assert.match(sql,/function public\.hadas_apply_approved_request\s*\(/i);
    assert.match(sql,/insert into public\.hadas_schedule_changes/i);
    assert.match(sql,/set start_time=r\.requested_start, status='draft'/i);
    assert.match(sql,/set end_time=r\.requested_end, status='draft'/i);
    assert.match(sql,/r\.target_approved is not true/i);
    assert.match(sql,/ניתן לבחור להחלפה רק עובד שנמצא ביום חופשי/);
    assert.match(sql,/set employee_id=r\.target_employee_id, status='draft'/i);
    assert.match(sql,/set status='applied'/i);
    assert.match(sql,/grant execute on function public\.hadas_apply_approved_request\(uuid,uuid\) to service_role/i);
  }
});
