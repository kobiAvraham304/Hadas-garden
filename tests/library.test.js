const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const exists = fs.existsSync(require('node:path').join(__dirname, '../lib/library-rules.js'));
const rules = exists ? require('../lib/library-rules') : {};

test('library accepts gallery media, Office, PDF, text and archives with missing browser MIME', () => {
  assert.equal(typeof rules.validateFile, 'function');
  for (const name of ['תמונה.HEIC','פעילות.docx','שיר.mp3','וידאו.MOV','דף.pdf','מצגת.pptx','טבלה.xlsx','ערכה.zip','טקסט.txt','ציור.webp','קובץ.ods','תמונות.7z']) {
    const file = rules.validateFile({ name, size: 100, type: '' });
    assert.equal(file.name, name);
    assert.ok(file.mime);
  }
});
test('library rejects unsafe files, MIME spoofing and excessive sizes', () => {
  assert.equal(typeof rules.validateFile, 'function');
  for (const file of [{name:'a.html',size:2},{name:'a.svg',size:2},{name:'a.exe',size:2},{name:'a.pdf',size:51*1024*1024},{name:'a.png',size:0},{name:'a.png',size:3,type:'text/html'}]) assert.throws(() => rules.validateFile(file));
});
test('library normalizes searchable tags, optional activity fields and secure links', () => {
  assert.equal(typeof rules.cleanItem, 'function');
  const item = rules.cleanItem({title:'  חושים  ',category:'meeting',description:'פתיחה',tags:' חושים,ראייה,חושים ',link_url:'https://example.com/song',duration_minutes:'15'});
  assert.deepEqual(item.tags,['חושים','ראייה']);
  assert.equal(item.title,'חושים');
  assert.equal(item.duration_minutes,15);
  assert.throws(()=>rules.cleanItem({title:'x',link_url:'javascript:alert(1)'}));
  assert.throws(()=>rules.cleanItem({title:'x',category:'bogus'}));
});
test('library drafts are private even to managers; moderation applies only to published content', () => {
  assert.equal(typeof rules.canRead, 'function');
  const owner={employee:{id:'a'},user:{role:'employee'}};
  const other={employee:{id:'b'},user:{role:'employee'}};
  const manager={employee:{id:'m'},user:{role:'admin'}};
  assert.equal(rules.canRead(owner,{created_by:'a',status:'draft'}),true);
  assert.equal(rules.canRead(other,{created_by:'a',status:'draft'}),false);
  assert.equal(rules.canRead(manager,{created_by:'a',status:'draft'}),false);
  assert.equal(rules.canManage(other,{created_by:'a',status:'published'}),false);
  assert.equal(rules.canManage(manager,{created_by:'a',status:'published'}),true);
  assert.equal(rules.canRead(owner,{created_by:'a',status:'deleted'}),false);
});

const ITEM='11111111-1111-4111-8111-111111111111',FILE='22222222-2222-4222-8222-222222222222';
async function request(method,body={},options={}){
  const handlerPath='../handlers/library';
  assert.ok(fs.existsSync(require('node:path').join(__dirname, handlerPath+'.js')), 'library API is implemented');
  const server=require('../lib/server');
  const old=global.fetch,env={...process.env};
  Object.assign(process.env,{SUPABASE_URL:'https://fixture.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',SUPABASE_SECRET_KEY:'fixture'});
  const mutations=[];
  global.fetch=async(url,opts={})=>{
    const u=new URL(url),payload=opts.body?JSON.parse(opts.body):null;
    if(opts.method && opts.method!=='GET')mutations.push({path:u.pathname,payload});
    let data=[];
    if(u.pathname.endsWith('/hadas_library_items'))data=[{id:ITEM,created_by:options.owner||'employee',status:options.status||'published',title:'פעילות',description:'תיאור',category:'idea'}];
    if(u.pathname.endsWith('/hadas_library_items')&&u.searchParams.get('status')?.startsWith('in.'))data=[];
    if(u.pathname.endsWith('/hadas_library_files'))data=[{id:FILE,item_id:ITEM,name:'a.pdf',size_bytes:100,mime_type:'application/pdf',storage_path:'employee/item/a.pdf',uploaded:false}];
    if(u.pathname.includes('/object/info/'))data={metadata:{size:options.actualSize??100}};
    if(u.pathname.endsWith('/rpc/hadas_library_list'))data={items:[{id:ITEM,title:'פעילות',files:[],created_by:'employee'}],total:1,collections:[]};
    if(u.pathname.endsWith('/rpc/hadas_library_publish'))data={id:ITEM,status:'published'};
    return new Response(JSON.stringify(data),{status:200});
  };
  const res={statusCode:200,headers:{},status(n){this.statusCode=n;return this;},setHeader(k,v){this.headers[k]=v;},end(s){this.body=JSON.parse(s);}};
  try{
    await require(handlerPath)({method,query:options.query||{},headers:{'x-csrf-token':options.csrf||'csrf'},body,hadasSessionContext:Promise.resolve({employee:{id:'employee',active:true,full_name:'עובד'},user:{role:options.role||'employee',active:true},session:{csrf_token:'csrf'}})},res);
    return {res,mutations};
  }finally{global.fetch=old;process.env=env;}
}
test('library permits ordinary employees to create drafts',async()=>{
  const {res,mutations}=await request('POST',{action:'create',title:'רעיון',category:'idea',description:'משחק'});
  assert.equal(res.statusCode,201);assert.equal(mutations.find(x=>x.path.endsWith('/hadas_library_items')).payload.created_by,'employee');
});
test('library requires CSRF for reactions and never permits another employee to edit',async()=>{
  assert.equal((await request('POST',{action:'reaction',id:ITEM,kind:'like',value:true},{csrf:'wrong'})).res.statusCode,403);
  const {res,mutations}=await request('PATCH',{id:ITEM,title:'שינוי'},{owner:'other'});
  assert.equal(res.statusCode,403);assert.equal(mutations.length,0);
});
test('library rejects another employee draft and only signs files belonging to a readable item',async()=>{
  const {res,mutations}=await request('POST',{action:'file_urls',id:ITEM},{owner:'other',status:'draft'});
  assert.equal(res.statusCode,404);assert.equal(mutations.length,0);
});
test('library uses desired reaction state so repeated likes cannot create duplicates',async()=>{
  const {res,mutations}=await request('POST',{action:'reaction',id:ITEM,kind:'like',value:true});
  assert.equal(res.statusCode,200);const write=mutations.find(x=>x.path.endsWith('/hadas_library_reactions'));
  assert.equal(write.payload.employee_id,'employee');assert.equal(write.payload.kind,'like');
});
test('library refuses to mark incomplete uploads as ready',async()=>{
  const {res,mutations}=await request('POST',{action:'file_uploaded',id:ITEM,file_id:FILE},{status:'draft',actualSize:20});
  assert.equal(res.statusCode,409);assert.equal(mutations.filter(x=>x.path.endsWith('/hadas_library_files')).length,0);
});

test('library storage verifies canonical MIME as well as byte size',async()=>{
 const old=global.fetch,env={...process.env};Object.assign(process.env,{SUPABASE_URL:'https://fixture.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',SUPABASE_SECRET_KEY:'fixture'});
 global.fetch=async()=>new Response(JSON.stringify({metadata:{size:100,mimetype:'text/html'}}),{status:200});
 try{await assert.rejects(()=>require('../lib/library-storage').verifyUpload({name:'image.png',mime_type:'image/png',size_bytes:100,storage_path:'a.png'}));}finally{global.fetch=old;process.env=env;}
});
test('private file URLs include the Supabase Storage API prefix',async()=>{
 const old=global.fetch,env={...process.env};Object.assign(process.env,{SUPABASE_URL:'https://fixture.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',SUPABASE_SECRET_KEY:'fixture'});
 global.fetch=async()=>new Response(JSON.stringify({signedURL:'/object/sign/hadas-library/employee/file.txt?token=fixture'}),{status:200});
 try{assert.equal(await require('../lib/server').createPrivateFileUrl('hadas-library','employee/file.txt'), 'https://fixture.invalid/storage/v1/object/sign/hadas-library/employee/file.txt?token=fixture');}finally{global.fetch=old;process.env=env;}
});
