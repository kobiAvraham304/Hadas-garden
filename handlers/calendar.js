const { requireSession, parseBody, db, assertDb, emitEvent, audit, send, handleError, httpError } = require('../lib/server');
module.exports = async function handler(req,res) {
  try {
    const caller = await requireSession(req,{ manager:true });
    const body = parseBody(req);
    if (req.method === 'POST') {
      if (!String(body.title || '').trim() || !body.event_date) throw httpError(400,'יש להזין כותרת ותאריך');
      const row = {
        title:String(body.title).trim(),description:String(body.description || '').trim() || null,
        event_type:['holiday','meeting','training','birthday','activity','other'].includes(body.event_type)?body.event_type:'other',
        event_date:body.event_date,start_time:body.start_time || null,end_time:body.end_time || null,
        visibility:['all','managers','class'].includes(body.visibility)?body.visibility:'all',
        class_id:body.class_id || null,created_by:caller.employee.id,
      };
      const item = assertDb(await db().from('hadas_calendar_events').insert(row).select('*').single(),'לא ניתן ליצור אירוע');
      await audit(caller.employee.id,'create','calendar_event',item.id);
      await emitEvent('calendar');
      return send(res,201,{ ok:true,item });
    }
    if (req.method === 'PATCH') {
      if (!body.id) throw httpError(400,'חסר מזהה אירוע');
      const row={};
      for (const key of ['title','description','event_type','event_date','start_time','end_time','visibility','class_id']) if (body[key]!==undefined) row[key]=body[key]===''?null:body[key];
      assertDb(await db().from('hadas_calendar_events').update(row).eq('id',body.id),'לא ניתן לעדכן אירוע');
      await audit(caller.employee.id,'update','calendar_event',body.id);
      await emitEvent('calendar');
      return send(res,200,{ ok:true });
    }
    if (req.method === 'DELETE') {
      const id=body.id || req.query?.id;
      assertDb(await db().from('hadas_calendar_events').delete().eq('id',id),'לא ניתן למחוק אירוע');
      await audit(caller.employee.id,'delete','calendar_event',id);
      await emitEvent('calendar');
      return send(res,200,{ ok:true });
    }
    return send(res,405,{ ok:false,error:'Method not allowed' });
  } catch(error){ handleError(res,error); }
};
