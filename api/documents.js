const { requireSession, parseBody, db, assertDb, isManager, emitEvent, audit, randomToken, send, handleError, httpError } = require('../lib/server');
const ALLOWED_TYPES = new Set([
  'application/pdf','image/jpeg','image/png','image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
function safeName(name){ return String(name || 'file').replace(/[^a-zA-Z0-9._-]+/g,'_').slice(-120); }
function canView(caller,doc){
  if (isManager(caller)) return true;
  return doc.visibility==='all' || (doc.visibility==='class' && doc.class_id===caller.employee.primary_class_id);
}
module.exports = async function handler(req,res) {
  try {
    const caller = await requireSession(req,{ csrf:req.method!=='GET' });
    const body = parseBody(req);
    if (req.method === 'GET') {
      const doc = assertDb(await db().from('hadas_documents').select('*').eq('id',req.query?.id).eq('active',true).maybeSingle(),'המסמך לא נמצא');
      if (!doc || !canView(caller,doc)) throw httpError(404,'המסמך לא נמצא');
      const signed = await db().storage.from('hadas-documents').createSignedUrl(doc.storage_path,300,{ download:doc.file_name });
      if (signed.error) throw httpError(500,'לא ניתן ליצור קישור הורדה',signed.error);
      return send(res,200,{ ok:true,url:signed.data.signedUrl });
    }
    if (!isManager(caller)) throw httpError(403,'אין הרשאה לנהל מסמכים');
    if (req.method === 'POST' && body.action === 'prepare') {
      const size=Number(body.size_bytes || 0);
      const mime=String(body.mime_type || '');
      if (!body.file_name || !ALLOWED_TYPES.has(mime)) throw httpError(400,'סוג הקובץ אינו נתמך');
      if (size<=0 || size>10*1024*1024) throw httpError(400,'גודל הקובץ חייב להיות עד 10MB');
      const path=`${new Date().toISOString().slice(0,10)}/${randomToken(12)}-${safeName(body.file_name)}`;
      const signed=await db().storage.from('hadas-documents').createSignedUploadUrl(path);
      if (signed.error) throw httpError(500,'לא ניתן להכין העלאת קובץ',signed.error);
      return send(res,200,{ ok:true,path,token:signed.data.token });
    }
    if (req.method === 'POST' && body.action === 'confirm') {
      if (!body.storage_path || !body.file_name || !String(body.title || '').trim()) throw httpError(400,'חסרים פרטי מסמך');
      const row={
        title:String(body.title).trim(),description:String(body.description || '').trim() || null,
        file_name:String(body.file_name),storage_path:String(body.storage_path),mime_type:body.mime_type || null,
        size_bytes:Number(body.size_bytes || 0),visibility:['all','managers','class'].includes(body.visibility)?body.visibility:'all',
        class_id:body.class_id || null,active:true,created_by:caller.employee.id,
      };
      const item=assertDb(await db().from('hadas_documents').insert(row).select('*').single(),'לא ניתן לשמור מסמך');
      await audit(caller.employee.id,'create','document',item.id);
      await emitEvent('documents');
      return send(res,201,{ ok:true,item });
    }
    if (req.method === 'DELETE') {
      const id=body.id || req.query?.id;
      const doc=assertDb(await db().from('hadas_documents').select('*').eq('id',id).maybeSingle(),'המסמך לא נמצא');
      if (!doc) throw httpError(404,'המסמך לא נמצא');
      const removal=await db().storage.from('hadas-documents').remove([doc.storage_path]);
      if (removal.error) console.error(removal.error);
      assertDb(await db().from('hadas_documents').update({ active:false }).eq('id',id),'לא ניתן להסיר מסמך');
      await audit(caller.employee.id,'delete','document',id);
      await emitEvent('documents');
      return send(res,200,{ ok:true });
    }
    return send(res,400,{ ok:false,error:'פעולה לא מוכרת' });
  } catch(error){ handleError(res,error); }
};
