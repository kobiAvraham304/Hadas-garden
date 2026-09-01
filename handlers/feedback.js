const {
  requireSession, parseBody, db, assertDb, send, handleError, httpError,
  emitEvent, audit, notifyEmployees,
} = require('../lib/server');

const LINOR_PHONE = '+972542521780';
const TOPICS = new Set(['שיבוצים','בקשות','תפעול יומי','עובדים','הודעות','הודעות ומשימות','לוח שנה','תקלה/באג','שיפור/רעיון','אחר']);
function isFeedbackManager(caller) { return String(caller?.user?.phone || '') === LINOR_PHONE; }

async function loadFeedback(caller) {
  const manager = isFeedbackManager(caller);
  let query = db().from('hadas_feedback').select('*').order('created_at', { ascending:false }).limit(manager ? 300 : 100);
  query = manager ? query.neq('employee_id', caller.employee.id) : query.eq('employee_id', caller.employee.id);
  const rows = assertDb(await query, 'לא ניתן לטעון משובים') || [];
  const ids = [...new Set(rows.flatMap((row) => [row.employee_id,row.responded_by]).filter(Boolean))];
  let employees=[];
  if (ids.length) employees = assertDb(await db().from('hadas_employees').select('id,full_name').in('id',ids), 'לא ניתן לטעון שמות') || [];
  const names = new Map(employees.map((row)=>[row.id,row.full_name]));
  return rows.map((row)=>({
    ...row,
    employee_name:names.get(row.employee_id) || 'עובד',
    responder_name:row.responded_by ? (names.get(row.responded_by) || 'אחראית') : null,
  }));
}

module.exports = async function handler(req,res) {
  try {
    const caller = await requireSession(req,{ csrf:req.method !== 'GET' });
    const body = parseBody(req);
    const manager = isFeedbackManager(caller);

    if (req.method === 'GET') return send(res,200,{ ok:true, canManage:manager, feedback:await loadFeedback(caller) });

    if (req.method === 'POST' && body.action === 'create') {
      if (manager) throw httpError(403,'לינור יכולה לצפות ולנהל משובים של עובדים אחרים בלבד');
      const topic = String(body.topic || 'אחר').trim();
      const content = String(body.content || '').trim();
      if (!TOPICS.has(topic)) throw httpError(400,'יש לבחור נושא משוב');
      if (content.length < 3) throw httpError(400,'יש לכתוב תוכן למשוב');
      if (content.length > 4000) throw httpError(400,'המשוב ארוך מדי');
      const row = assertDb(await db().from('hadas_feedback').insert({ employee_id:caller.employee.id, topic, content }).select('*').single(), 'לא ניתן לשלוח משוב');
      await audit(caller.employee.id,'create','feedback',row.id,{ topic });
      await emitEvent('feedback');
      return send(res,201,{ ok:true,id:row.id });
    }

    if (!manager) throw httpError(403,'רק לינור יכולה לנהל משובים');
    const id = String(body.id || req.query?.id || '');
    if (!id) throw httpError(400,'חסר מזהה משוב');

    if (req.method === 'POST' && body.action === 'reply') {
      const response = String(body.response_text || '').trim();
      if (!response) throw httpError(400,'יש לכתוב תגובה');
      const current = assertDb(await db().from('hadas_feedback').select('*').eq('id',id).maybeSingle(), 'המשוב לא נמצא');
      if (!current) throw httpError(404,'המשוב לא נמצא');
      assertDb(await db().from('hadas_feedback').update({ response_text:response, responded_by:caller.employee.id, responded_at:new Date().toISOString(), status:'replied' }).eq('id',id), 'לא ניתן לשמור תגובה');
      await notifyEmployees([current.employee_id], { type:'info', title:'התקבלה תגובה למשוב שלך', message:response.slice(0,350), entityType:'feedback', entityId:id });
      await audit(caller.employee.id,'reply','feedback',id);
      await emitEvent('feedback');
      return send(res,200,{ ok:true });
    }

    if (req.method === 'POST' && body.action === 'close') {
      assertDb(await db().from('hadas_feedback').update({ status:body.closed === false ? 'open' : 'closed' }).eq('id',id), 'לא ניתן לעדכן משוב');
      await audit(caller.employee.id,'status','feedback',id,{ closed:body.closed !== false });
      await emitEvent('feedback');
      return send(res,200,{ ok:true });
    }

    if (req.method === 'DELETE') {
      assertDb(await db().from('hadas_feedback').delete().eq('id',id), 'לא ניתן למחוק משוב');
      await audit(caller.employee.id,'delete','feedback',id);
      await emitEvent('feedback');
      return send(res,200,{ ok:true });
    }

    return send(res,405,{ ok:false,error:'Method not allowed' });
  } catch(error) { handleError(res,error); }
};
