const crypto=require('node:crypto');
const {requireSession,parseBody,db,assertDb,isManager,send,handleError,httpError,createPrivateFileUrl,deletePrivateFile,emitEvent,notifyEmployees,audit}=require('../lib/server');
const {cleanItem,validateFile,canRead,canManage,uuid,MAX_FILE_SIZE,MAX_FILES}=require('../lib/library-rules');
const {BUCKET,signUpload,verifyUpload}=require('../lib/library-storage');
async function getItem(id){return assertDb(await db().from('hadas_library_items').select('*').eq('id',uuid(id)).maybeSingle(),'לא ניתן לטעון את התוכן');}
async function getFiles(id){return assertDb(await db().from('hadas_library_files').select('*').eq('item_id',id).order('created_at'), 'לא ניתן לטעון קבצים')||[];}
async function cleanExpiredDrafts(caller){
  // Opportunistic bounded cleanup, scoped to this employee, never published content.
  const rows=assertDb(await db().from('hadas_library_items').select('id').eq('created_by',caller.employee.id).in('status',['draft','deleted']).lt('updated_at',new Date(Date.now()-7*86400000).toISOString()).limit(3),'לא ניתן לבדוק טיוטות');
  for(const item of rows){const files=await getFiles(item.id);await Promise.all(files.map(f=>deletePrivateFile(BUCKET,f.storage_path)));assertDb(await db().from('hadas_library_items').delete().eq('id',item.id).eq('created_by',caller.employee.id).in('status',['draft','deleted']),'לא ניתן לנקות טיוטה ישנה');}
}
function readable(caller,item){if(!canRead(caller,item))throw httpError(404,'התוכן אינו זמין');}
function manageable(caller,item){readable(caller,item);if(!canManage(caller,item))throw httpError(403,'ניתן לערוך רק תוכן שהעלית');}
function ownerDraft(caller,item){readable(caller,item);if(item.created_by!==caller.employee.id||item.status!=='draft')throw httpError(403,'ההעלאה אפשרית רק לטיוטה שלך');}
async function list(caller,query={}){
  const result=await db().rpc('hadas_library_list',{
    p_employee:caller.employee.id,p_query:String(query.q||'').trim().slice(0,140),p_category:String(query.category||''),
    p_view:['all','mine','saved'].includes(query.view)?query.view:'all',p_collection:String(query.collection||'').slice(0,60),
    p_sort:['new','popular','tried'].includes(query.sort)?query.sort:'new',p_offset:Math.min(10000,Math.max(0,Number(query.offset)||0)),p_id:query.id?uuid(query.id):null,
  });
  return assertDb(result,'לא ניתן לטעון את הספרייה');
}
module.exports=async function library(req,res){
  try{
    if(!['GET','POST','PATCH','DELETE'].includes(req.method))return send(res,405,{ok:false,error:'Method not allowed'});
    const caller=await requireSession(req),body=parseBody(req),query=req.query||{};
    if(req.method==='GET'){
      if(!query.id)return send(res,200,{ok:true,...await list(caller,query),maxFileSize:MAX_FILE_SIZE,maxFiles:MAX_FILES});
      const current=await getItem(query.id);readable(caller,current);
      const [data,comments]=await Promise.all([
        current.status==='published'?list(caller,{id:current.id}):Promise.resolve({items:[{...current,files:(await getFiles(current.id)).map(f=>{const {storage_path,...rest}=f;return rest;})}]}),
        db().from('hadas_library_comments').select('id,item_id,employee_id,content,created_at,author:hadas_employees(full_name)').eq('item_id',current.id).order('created_at',{ascending:false}).limit(100),
      ]);
      return send(res,200,{ok:true,item:data.items[0],comments:(assertDb(comments,'לא ניתן לטעון תגובות')||[]).reverse(),canManage:canManage(caller,current)});
    }
    if(req.method==='POST'&&body.action==='create'){
      await cleanExpiredDrafts(caller);
      const item=assertDb(await db().from('hadas_library_items').insert({...cleanItem(body),created_by:caller.employee.id}).select('*').single(),'לא ניתן לשמור טיוטה');
      return send(res,201,{ok:true,item});
    }
    if(req.method==='POST'&&body.action==='covers'){
      const ids=[...new Set(Array.isArray(body.ids)?body.ids:[])].slice(0,24).map(uuid);
      if(!ids.length)return send(res,200,{ok:true,files:[]});
      const items=assertDb(await db().from('hadas_library_items').select('id').in('id',ids).eq('status','published'),'לא ניתן לטעון תמונות מקדימות');
      if(!items.length)return send(res,200,{ok:true,files:[]});
      const files=assertDb(await db().from('hadas_library_files').select('*').in('item_id',items.map(i=>i.id)).eq('is_thumbnail',true).eq('uploaded',true),'לא ניתן לטעון תמונות מקדימות');
      const rows=await Promise.all(files.map(async f=>({item_id:f.item_id,url:await createPrivateFileUrl(BUCKET,f.storage_path,3600)})));
      return send(res,200,{ok:true,files:rows});
    }
    const current=await getItem(body.id||query.id);readable(caller,current);
    if(req.method==='PATCH'){
      manageable(caller,current);
      const row=cleanItem({...current,...body});
      assertDb(await db().from('hadas_library_items').update(row).eq('id',current.id),'לא ניתן לעדכן תוכן');
      if(current.status==='published')await emitEvent('library');
      return send(res,200,{ok:true});
    }
    if(req.method==='DELETE'){
      manageable(caller,current);
      const files=await getFiles(current.id);
      assertDb(await db().from('hadas_library_items').update({status:'deleted'}).eq('id',current.id),'לא ניתן להסיר תוכן');
      await Promise.all(files.map(f=>deletePrivateFile(BUCKET,f.storage_path)));
      await audit(caller.employee.id,'delete','library',current.id);
      if(current.status==='published')await emitEvent('library');
      return send(res,200,{ok:true});
    }
    if(body.action==='upload'){
      ownerDraft(caller,current);const file=validateFile(body.file||{}),id=body.file_id?uuid(body.file_id):crypto.randomUUID();
      const path=`${caller.employee.id}/${current.id}/${id}.${file.ext}`;
      const result=await db().rpc('hadas_library_reserve_file',{p_employee:caller.employee.id,p_item:current.id,p_file:id,p_name:file.name,p_mime:file.mime,p_size:file.size,p_path:path,p_thumbnail:body.thumbnail===true});
      if(result.error)throw httpError(409,'אפשר לצרף עד 10 קבצים ותמונה מקדימה אחת');
      const row=result.data;
      if(row.name!==file.name||Number(row.size_bytes)!==file.size)throw httpError(409,'הקובץ השתנה. יש לבחור אותו מחדש');
      return send(res,200,{ok:true,file_id:row.id,mime_type:row.mime_type,uploaded:row.uploaded,url:row.uploaded?null:await signUpload(row.storage_path)});
    }
    if(body.action==='file_uploaded'){
      ownerDraft(caller,current);
      const file=assertDb(await db().from('hadas_library_files').select('*').eq('id',uuid(body.file_id)).eq('item_id',current.id).maybeSingle(),'הקובץ אינו זמין');
      if(!file)throw httpError(404,'הקובץ אינו זמין');
      await verifyUpload(file);
      assertDb(await db().from('hadas_library_files').update({uploaded:true}).eq('id',file.id),'לא ניתן לאשר את הקובץ');
      return send(res,200,{ok:true});
    }
    if(body.action==='discard_thumbnail'){
      ownerDraft(caller,current);
      const files=(await getFiles(current.id)).filter(f=>f.is_thumbnail&&!f.uploaded);
      await Promise.all(files.map(f=>deletePrivateFile(BUCKET,f.storage_path)));
      assertDb(await db().from('hadas_library_files').delete().eq('item_id',current.id).eq('is_thumbnail',true).eq('uploaded',false),'לא ניתן להסיר תמונה מקדימה');
      return send(res,200,{ok:true});
    }
    if(body.action==='publish'){
      if(current.created_by!==caller.employee.id)throw httpError(403,'אין הרשאה לפרסם תוכן של עובד אחר');
      const result=await db().rpc('hadas_library_publish',{p_employee:caller.employee.id,p_item:current.id});
      if(result.error)throw httpError(409,'יש להשלים את העלאת הקבצים ולהוסיף תוכן או קישור לפני הפרסום');
      await emitEvent('library');return send(res,200,{ok:true,item:result.data});
    }
    if(body.action==='file_urls'){
      const files=(await getFiles(current.id)).filter(f=>f.uploaded && (!body.file_ids||body.file_ids.includes(f.id)));
      const rows=await Promise.all(files.map(async f=>({id:f.id,name:f.name,mime_type:f.mime_type,size_bytes:f.size_bytes,is_thumbnail:f.is_thumbnail,url:await createPrivateFileUrl(BUCKET,f.storage_path,3600)})));
      return send(res,200,{ok:true,files:rows});
    }
    if(current.status!=='published')throw httpError(409,'הפעולה זמינה רק בתוכן שפורסם');
    if(body.action==='reaction'){
      if(!['like','tried'].includes(body.kind)||typeof body.value!=='boolean')throw httpError(400,'התגובה אינה תקינה');
      const q=db().from('hadas_library_reactions');
      const result=body.value?await q.upsert({item_id:current.id,employee_id:caller.employee.id,kind:body.kind},{onConflict:'item_id,employee_id,kind'}):await q.delete().eq('item_id',current.id).eq('employee_id',caller.employee.id).eq('kind',body.kind);
      assertDb(result,'לא ניתן לעדכן תגובה');await emitEvent('library');return send(res,200,{ok:true});
    }
    if(body.action==='bookmark'){
      if(typeof body.value!=='boolean')throw httpError(400,'הפעולה אינה תקינה');
      const collection=String(body.collection||'השמורים שלי').trim();if(!collection||collection.length>60)throw httpError(400,'שם האוסף צריך להיות עד 60 תווים');
      const q=db().from('hadas_library_bookmarks');
      assertDb(body.value?await q.upsert({item_id:current.id,employee_id:caller.employee.id,collection},{onConflict:'item_id,employee_id'}):await q.delete().eq('item_id',current.id).eq('employee_id',caller.employee.id),'לא ניתן לשמור תוכן');
      return send(res,200,{ok:true});
    }
    if(body.action==='comment'){
      const content=String(body.content||'').trim();if(!content||content.length>2000)throw httpError(400,'יש לכתוב תגובה עד 2000 תווים');
      const recent=assertDb(await db().from('hadas_library_comments').select('id').eq('employee_id',caller.employee.id).gte('created_at',new Date(Date.now()-3600000).toISOString()).limit(30),'לא ניתן לבדוק תגובות');
      if(recent.length>=30)throw httpError(429,'נשלחו תגובות רבות. אפשר לנסות שוב מאוחר יותר');
      const comment=assertDb(await db().from('hadas_library_comments').insert({item_id:current.id,employee_id:caller.employee.id,content}).select('*').single(),'לא ניתן לשלוח תגובה');
      if(current.created_by!==caller.employee.id)await notifyEmployees([current.created_by],{title:`תגובה חדשה: ${current.title}`,message:`${caller.employee.full_name}: ${content}`,entityType:'library',entityId:current.id});
      await emitEvent('library');return send(res,201,{ok:true,comment});
    }
    if(body.action==='delete_comment'){
      const comment=assertDb(await db().from('hadas_library_comments').select('*').eq('id',uuid(body.comment_id)).eq('item_id',current.id).maybeSingle(),'התגובה אינה זמינה');
      if(!comment)throw httpError(404,'התגובה אינה זמינה');
      if(comment.employee_id!==caller.employee.id&&!isManager(caller))throw httpError(403,'ניתן להסיר רק תגובה שלך');
      assertDb(await db().from('hadas_library_comments').delete().eq('id',comment.id),'לא ניתן להסיר תגובה');await emitEvent('library');return send(res,200,{ok:true});
    }
    if(body.action==='pin'){
      if(!isManager(caller)||typeof body.value!=='boolean')throw httpError(403,'רק מנהלת יכולה לבחור תוכן נבחר');
      assertDb(await db().from('hadas_library_items').update({is_pinned:body.value}).eq('id',current.id),'לא ניתן לעדכן תוכן נבחר');await emitEvent('library');return send(res,200,{ok:true});
    }
    throw httpError(400,'הפעולה אינה מוכרת');
  }catch(error){handleError(res,error);}
};
