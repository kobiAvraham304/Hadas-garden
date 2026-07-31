const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('every Vercel API module loads and exports a handler',()=>{
  const files=fs.readdirSync(path.join(root,'api')).filter(file=>file.endsWith('.js'));
  assert.ok(files.length>=15);
  for(const file of files){
    delete require.cache[require.resolve(path.join(root,'api',file))];
    const handler=require(path.join(root,'api',file));
    assert.equal(typeof handler,'function',file);
  }
});

test('all database tables referenced by API code exist in the SQL schema',()=>{
  const schema=read('supabase/schema.sql');
  const code=[...fs.readdirSync(path.join(root,'api')).filter(f=>f.endsWith('.js')).map(f=>read(`api/${f}`)),read('lib/server.js')].join('\n');
  const tables=[...new Set([...code.matchAll(/\.from\(['"]([a-z0-9_]+)['"]\)/g)].map(m=>m[1]))].sort();
  const missing=tables.filter(table=>!new RegExp(`create table if not exists public\\.${table}\\b`,'i').test(schema));
  assert.deepEqual(missing,[]);
});

test('all RPCs referenced by API code exist in the SQL schema',()=>{
  const schema=read('supabase/schema.sql');
  const code=fs.readdirSync(path.join(root,'api')).filter(f=>f.endsWith('.js')).map(f=>read(`api/${f}`)).join('\n');
  const rpcs=[...new Set([...code.matchAll(/\.rpc\(['"]([a-z0-9_]+)['"]/g)].map(m=>m[1]))];
  assert.ok(rpcs.length>=1);
  for(const rpc of rpcs)assert.match(schema,new RegExp(`function public\\.${rpc}\\s*\\(`,'i'),rpc);
});

test('SQL blocks and CSS braces are balanced',()=>{
  const sql=read('supabase/schema.sql'),css=read('styles.css');
  assert.equal((sql.match(/\$\$/g)||[]).length%2,0);
  assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
});

test('no stale 0.3.0 runtime version remains',()=>{
  for(const file of ['app.js','api/config.js','api/health.js','package.json','supabase/schema.sql']){
    assert.doesNotMatch(read(file),/0\.3\.0/,file);
  }
});


test('clean installer repairs the legacy classes trigger problem',()=>{
  const schema=read('supabase/schema.sql');
  assert.match(schema,/DROP TABLE IF EXISTS[\s\S]*public\.hadas_profiles[\s\S]*public\.hadas_classes[\s\S]*CASCADE;/i);
  const classes=schema.match(/create table if not exists public\.hadas_classes\s*\(([\s\S]*?)\n\);/i)?.[1]||'';
  assert.match(classes,/updated_at\s+timestamptz/i);
  const triggerTables=[...schema.matchAll(/FOREACH t IN ARRAY ARRAY\[([\s\S]*?)\]\s*LOOP/g)]
    .map(m=>m[1]).find(block=>block.includes('hadas_app_meta')&&block.includes('hadas_task_assignees'))||'';
  for(const table of [...triggerTables.matchAll(/'([a-z0-9_]+)'/g)].map(m=>m[1])){
    const body=schema.match(new RegExp(`create table if not exists public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`,'i'))?.[1]||'';
    assert.match(body,/updated_at\s+timestamptz/i,`${table} must contain updated_at before attaching the trigger`);
  }
});

test('service role grants are limited to Hadas objects',()=>{
  const schema=read('supabase/schema.sql');
  assert.doesNotMatch(schema,/grant all on all tables in schema public/i);
  assert.doesNotMatch(schema,/grant all on all sequences in schema public/i);
  assert.match(schema,/left\(tablename, 6\) = 'hadas_'/i);
  assert.match(schema,/left\(sequence_name, 6\) = 'hadas_'/i);
});
