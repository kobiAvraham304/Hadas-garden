const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

function jsFiles(folder){
  return fs.readdirSync(path.join(root,folder)).filter(file=>file.endsWith('.js'));
}

test('Vercel deploys one unified API function and every handler loads',()=>{
  const apiFiles=jsFiles('api');
  assert.deepEqual(apiFiles,['index.js']);
  const router=require(path.join(root,'api','index.js'));
  assert.equal(typeof router,'function');
  const handlers=jsFiles('handlers');
  assert.equal(handlers.length,17);
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
});

test('all database tables referenced by handlers exist in the SQL schema',()=>{
  const schema=read('supabase/schema.sql');
  const code=[...jsFiles('handlers').map(f=>read(`handlers/${f}`)),read('lib/server.js')].join('\n');
  const tables=[...new Set([...code.matchAll(/\.from\(['"]([a-z0-9_]+)['"]\)/g)].map(m=>m[1]))].sort();
  const missing=tables.filter(table=>!new RegExp(`create table if not exists public\\.${table}\\b`,'i').test(schema));
  assert.deepEqual(missing,[]);
});

test('all RPCs referenced by handlers exist in the SQL schema',()=>{
  const schema=read('supabase/schema.sql');
  const code=jsFiles('handlers').map(f=>read(`handlers/${f}`)).join('\n');
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
  for(const file of ['app.js','handlers/config.js','handlers/health.js','package.json','supabase/schema.sql']){
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
