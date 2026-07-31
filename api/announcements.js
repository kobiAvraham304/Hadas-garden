const { requireSession, parseBody, db, assertDb, emitEvent, audit, send, handleError, httpError } = require('../lib/server');
module.exports = async function handler(req,res) {
  try {
    const body = parseBody(req);
    if (req.method === 'POST' && body.action === 'read') {
      const caller = await requireSession(req);
      if (!body.id) throw httpError(400,'חסרה הודעה');
      assertDb(await db().from('hadas_announcement_reads').upsert({ announcement_id:body.id,employee_id:caller.employee.id,read_at:new Date().toISOString() },{ onConflict:'announcement_id,employee_id' }),'לא ניתן לסמן קריאה');
      await emitEvent('announcement_reads');
      return send(res,200,{ ok:true });
    }
    const caller = await requireSession(req,{ manager:true });
    if (req.method === 'POST') {
      if (!String(body.title || '').trim() || !String(body.body || '').trim()) throw httpError(400,'יש להזין כותרת ותוכן');
      const row = {
        title:String(body.title).trim(), body:String(body.body).trim(),
        announcement_type:['info','important','urgent'].includes(body.announcement_type) ? body.announcement_type : 'info',
        class_id:body.class_id || null,
        published_at:body.published_at || new Date().toISOString(),
        expires_at:body.expires_at || null,
        active:true, created_by:caller.employee.id,
      };
      const item = assertDb(await db().from('hadas_announcements').insert(row).select('*').single(),'לא ניתן לפרסם הודעה');
      await audit(caller.employee.id,'create','announcement',item.id);
      await emitEvent('announcements');
      return send(res,201,{ ok:true,item });
    }
    if (req.method === 'PATCH') {
      if (!body.id) throw httpError(400,'חסר מזהה הודעה');
      const row = {};
      for (const key of ['title','body','announcement_type','class_id','published_at','expires_at','active']) if (body[key] !== undefined) row[key] = body[key] === '' ? null : body[key];
      assertDb(await db().from('hadas_announcements').update(row).eq('id',body.id),'לא ניתן לעדכן הודעה');
      await audit(caller.employee.id,'update','announcement',body.id);
      await emitEvent('announcements');
      return send(res,200,{ ok:true });
    }
    if (req.method === 'DELETE') {
      const id = body.id || req.query?.id;
      assertDb(await db().from('hadas_announcements').update({ active:false }).eq('id',id),'לא ניתן להסיר הודעה');
      await audit(caller.employee.id,'deactivate','announcement',id);
      await emitEvent('announcements');
      return send(res,200,{ ok:true });
    }
    return send(res,405,{ ok:false,error:'Method not allowed' });
  } catch (error) { handleError(res,error); }
};
