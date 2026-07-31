const {
  requireSession, parseBody, db, assertDb, isManager, emitEvent, audit,
  send, handleError, httpError,
} = require('../lib/server');
const { timeToMinutes } = require('../lib/schedule');

async function getRequest(id) {
  return assertDb(await db().from('hadas_requests').select('*').eq('id',id).maybeSingle(),'הבקשה לא נמצאה');
}

module.exports = async function handler(req,res) {
  try {
    if (req.method !== 'POST') return send(res,405,{ ok:false,error:'Method not allowed' });
    const caller = await requireSession(req);
    const body = parseBody(req);
    const action = body.action || 'create';

    if (action === 'create') {
      const type = String(body.request_type || '');
      if (!['leave','day_off','late_start','early_finish','sick','swap','other'].includes(type)) throw httpError(400,'סוג הבקשה אינו תקין');
      if (!body.request_date) throw httpError(400,'יש לבחור תאריך');
      const payload = {
        requester_id:caller.employee.id,
        request_type:type,
        request_date:body.request_date,
        requested_start:body.requested_start || null,
        requested_end:body.requested_end || null,
        shift_id:body.shift_id || null,
        target_employee_id:body.target_employee_id || null,
        target_shift_id:body.target_shift_id || null,
        reason:String(body.reason || '').trim() || null,
        status:'pending',
      };
      let own = null;
      if (['late_start','early_finish','swap'].includes(type)) {
        if (!payload.shift_id) throw httpError(400,'יש לבחור את השיבוץ הרלוונטי');
        own = assertDb(await db().from('hadas_shifts').select('*').eq('id',payload.shift_id).maybeSingle(),'השיבוץ שלך לא נמצא');
        if (!own || own.employee_id !== caller.employee.id) throw httpError(409,'השיבוץ שנבחר אינו שייך לך');
        payload.request_date = own.shift_date;
      }
      if (type === 'late_start') {
        if (!payload.requested_start || timeToMinutes(payload.requested_start) <= timeToMinutes(own.start_time) || timeToMinutes(payload.requested_start) >= timeToMinutes(own.end_time)) throw httpError(400,'שעת ההתחלה המבוקשת חייבת להיות בתוך שעות השיבוץ');
      }
      if (type === 'early_finish') {
        if (!payload.requested_end || timeToMinutes(payload.requested_end) <= timeToMinutes(own.start_time) || timeToMinutes(payload.requested_end) >= timeToMinutes(own.end_time)) throw httpError(400,'שעת הסיום המבוקשת חייבת להיות בתוך שעות השיבוץ');
      }
      if (type === 'swap') {
        if (!payload.target_employee_id || !payload.target_shift_id) throw httpError(400,'יש לבחור את השיבוץ של העובדת השנייה');
        if (payload.target_employee_id === caller.employee.id) throw httpError(400,'לא ניתן להחליף שיבוץ עם עצמך');
        const target = assertDb(await db().from('hadas_shifts').select('*').eq('id',payload.target_shift_id).maybeSingle(),'השיבוץ המבוקש לא נמצא');
        if (!target || target.employee_id !== payload.target_employee_id) throw httpError(409,'פרטי ההחלפה אינם תואמים לשיבוץ של העובדת השנייה');
      }
      const request = assertDb(await db().from('hadas_requests').insert(payload).select('*').single(),'לא ניתן לשלוח את הבקשה');
      await audit(caller.employee.id,'create','request',request.id,{ type });
      await emitEvent('requests');
      return send(res,201,{ ok:true,request });
    }

    const request = await getRequest(body.id);
    if (!request) throw httpError(404,'הבקשה לא נמצאה');

    if (action === 'cancel') {
      if (request.requester_id !== caller.employee.id || request.status !== 'pending') throw httpError(403,'לא ניתן לבטל את הבקשה');
      assertDb(await db().from('hadas_requests').update({ status:'cancelled' }).eq('id',request.id),'לא ניתן לבטל את הבקשה');
    } else if (action === 'target_accept') {
      if (request.target_employee_id !== caller.employee.id) throw httpError(403,'רק העובדת שקיבלה את ההצעה יכולה לאשר');
      if (request.status !== 'pending') throw httpError(409,'הבקשה כבר טופלה');
      assertDb(await db().from('hadas_requests').update({ target_approved:true }).eq('id',request.id),'לא ניתן לאשר את ההחלפה');
    } else if (action === 'decide') {
      if (!isManager(caller)) throw httpError(403,'אין הרשאה לטפל בבקשה');
      if (!['approved','rejected'].includes(body.status)) throw httpError(400,'החלטה לא תקינה');
      if (request.request_type === 'swap' && body.status === 'approved' && !request.target_approved) throw httpError(409,'העובדת השנייה עדיין לא אישרה את ההחלפה');
      assertDb(await db().from('hadas_requests').update({
        status:body.status,
        manager_note:String(body.manager_note || '').trim() || null,
        decided_by:caller.employee.id,
        decided_at:new Date().toISOString(),
      }).eq('id',request.id),'לא ניתן לעדכן את הבקשה');
    } else if (action === 'apply') {
      if (!isManager(caller)) throw httpError(403,'אין הרשאה להזרים בקשה');
      if (request.status !== 'approved') throw httpError(409,'יש לאשר את הבקשה לפני הזרמתה');
      if (request.request_type === 'swap') {
        const result = await db().rpc('hadas_apply_shift_swap',{ p_request_id:request.id,p_actor_id:caller.employee.id });
        assertDb(result,'לא ניתן לבצע את ההחלפה');
      } else if (['leave','day_off','sick'].includes(request.request_type)) {
        assertDb(await db().from('hadas_shifts').delete().eq('employee_id',request.requester_id).eq('shift_date',request.request_date),'לא ניתן לעדכן את השיבוץ');
      } else if (request.request_type === 'late_start' && request.requested_start && request.shift_id) {
        const currentShift = assertDb(await db().from('hadas_shifts').select('*').eq('id',request.shift_id).eq('employee_id',request.requester_id).maybeSingle(),'השיבוץ לא נמצא');
        if (!currentShift) throw httpError(409,'השיבוץ השתנה או נמחק מאז הגשת הבקשה');
        if (timeToMinutes(request.requested_start) >= timeToMinutes(currentShift.end_time)) throw httpError(409,'שעת ההתחלה המבוקשת אינה מתאימה עוד לשיבוץ');
        assertDb(await db().from('hadas_shifts').update({ start_time:request.requested_start }).eq('id',request.shift_id),'לא ניתן לעדכן את השיבוץ');
      } else if (request.request_type === 'early_finish' && request.requested_end && request.shift_id) {
        const currentShift = assertDb(await db().from('hadas_shifts').select('*').eq('id',request.shift_id).eq('employee_id',request.requester_id).maybeSingle(),'השיבוץ לא נמצא');
        if (!currentShift) throw httpError(409,'השיבוץ השתנה או נמחק מאז הגשת הבקשה');
        if (timeToMinutes(request.requested_end) <= timeToMinutes(currentShift.start_time)) throw httpError(409,'שעת הסיום המבוקשת אינה מתאימה עוד לשיבוץ');
        assertDb(await db().from('hadas_shifts').update({ end_time:request.requested_end }).eq('id',request.shift_id),'לא ניתן לעדכן את השיבוץ');
      }
      if (request.request_type !== 'swap') {
        assertDb(await db().from('hadas_requests').update({ status:'applied',decided_by:caller.employee.id,decided_at:new Date().toISOString() }).eq('id',request.id),'לא ניתן לסיים את הבקשה');
      }
    } else {
      throw httpError(400,'פעולה לא מוכרת');
    }
    await audit(caller.employee.id,action,'request',request.id);
    await emitEvent('requests');
    send(res,200,{ ok:true });
  } catch (error) { handleError(res,error); }
};
