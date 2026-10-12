const test=require('node:test'),assert=require('node:assert/strict');
test('health accepts current installed schema and verifies the library table',async()=>{
 const previous=global.fetch,env={...process.env};
 Object.assign(process.env,{SUPABASE_URL:'https://fixture.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',SUPABASE_SECRET_KEY:'fixture'});
 global.fetch=async(url)=>{const p=new URL(url).pathname;const data=p.endsWith('/hadas_app_meta')?[{id:1,schema_version:'0.40.0'}]:p.endsWith('/hadas_users')?[{id:'one'},{id:'two'}]:[];return new Response(JSON.stringify(data),{status:200});};
 const res={statusCode:200,status(n){this.statusCode=n;return this;},setHeader(){},end(s){this.body=JSON.parse(s);}};
 try{await require('../handlers/health')({method:'GET'},res);assert.equal(res.statusCode,200);assert.equal(res.body.checks.library.ok,true);assert.equal(res.body.checks.schema.ok,true);}finally{global.fetch=previous;process.env=env;}
});
