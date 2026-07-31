const { requireSession, parseBody, db, assertDb, isManager, emitEvent, audit, send, handleError, httpError } = require('../lib/server');

async function targetEmployees(targetType,targetId) {
  let query = db().from('hadas_employees').select('id').eq('active',true);
  if (targetType === 'class') query = query.eq('primary_class_id',targetId);
  if (targetType === 'employee') query = query.eq('id',targetId);
  return assertDb(await query,'לא ניתן למצוא מקבלות משימה') || [];
}
async function replaceAssignees(taskId,targetType,targetId) {
  const employees = await targetEmployees(targetType,targetId);
  if (!employees.length) throw httpError(409,'לא נמצאו עובדות מתאימות למשימה');
  const existing = assertDb(await db().from('hadas_task_assignees').select('*').eq('task_id',taskId),'לא ניתן לטעון שיוכים') || [];
  const existingMap = new Map(existing.map((row)=>[row.employee_id,row]));
  assertDb(await db().from('hadas_task_assignees').delete().eq('task_id',taskId),'לא ניתן לעדכן שיוכים');
  const rows = employees.map((employee) => ({
    task_id:taskId, employee_id:employee.id,
    status:existingMap.get(employee.id)?.status || 'pending',
    completed_at:existingMap.get(employee.id)?.completed_at || null,
  }));
  assertDb(await db().from('hadas_task_assignees').insert(rows),'לא ניתן לשייך משימה');
}

module.exports = async function handler(req,res) {
  try {
    if (req.method !== 'POST' && req.method !== 'PATCH' && req.method !== 'DELETE') return send(res,405,{ ok:false,error:'Method not allowed' });
    const caller = await requireSession(req);
    const body = parseBody(req);
    if (req.method === 'POST' && ['complete','reopen'].includes(body.action)) {
      const status = body.action === 'complete' ? 'done' : 'pending';
      const assignment = assertDb(await db().from('hadas_task_assignees').select('*').eq('task_id',body.id).eq('employee_id',caller.employee.id).maybeSingle(),'המשימה לא נמצאה');
      if (!assignment) throw httpError(404,'המשימה לא משויכת אלייך');
      assertDb(await db().from('hadas_task_assignees').update({ status,completed_at:status==='done'?new Date().toISOString():null }).eq('task_id',body.id).eq('employee_id',caller.employee.id),'לא ניתן לעדכן משימה');
      await emitEvent('tasks');
      return send(res,200,{ ok:true });
    }
    if (!isManager(caller)) throw httpError(403,'אין הרשאה לנהל משימות');
    if (req.method === 'POST') {
      if (!String(body.title || '').trim()) throw httpError(400,'יש להזין כותרת משימה');
      const targetType = ['all','class','employee'].includes(body.target_type) ? body.target_type : 'all';
      if (targetType !== 'all' && !body.target_id) throw httpError(400,'יש לבחור יעד למשימה');
      const row = {
        title:String(body.title).trim(), description:String(body.description || '').trim() || null,
        due_at:body.due_at || null, valid_from:body.valid_from || null, valid_to:body.valid_to || null,
        priority:['normal','important','urgent'].includes(body.priority) ? body.priority : 'normal',
        target_type:targetType,target_id:body.target_id || null,active:true,created_by:caller.employee.id,
      };
      const task = assertDb(await db().from('hadas_tasks').insert(row).select('*').single(),'לא ניתן ליצור משימה');
      await replaceAssignees(task.id,targetType,row.target_id);
      await audit(caller.employee.id,'create','task',task.id);
      await emitEvent('tasks');
      return send(res,201,{ ok:true,task });
    }
    if (req.method === 'PATCH') {
      if (!body.id) throw httpError(400,'חסר מזהה משימה');
      const current = assertDb(await db().from('hadas_tasks').select('*').eq('id',body.id).maybeSingle(),'המשימה לא נמצאה');
      if (!current) throw httpError(404,'המשימה לא נמצאה');
      const row = {};
      for (const key of ['title','description','due_at','valid_from','valid_to','priority','target_type','target_id','active']) if (body[key] !== undefined) row[key] = body[key] === '' ? null : body[key];
      assertDb(await db().from('hadas_tasks').update(row).eq('id',body.id),'לא ניתן לעדכן משימה');
      if (body.target_type !== undefined || body.target_id !== undefined) await replaceAssignees(body.id,row.target_type || current.target_type,row.target_id === undefined ? current.target_id : row.target_id);
      await audit(caller.employee.id,'update','task',body.id);
      await emitEvent('tasks');
      return send(res,200,{ ok:true });
    }
    const id = body.id || req.query?.id;
    assertDb(await db().from('hadas_tasks').update({ active:false }).eq('id',id),'לא ניתן להסיר משימה');
    await audit(caller.employee.id,'deactivate','task',id);
    await emitEvent('tasks');
    send(res,200,{ ok:true });
  } catch (error) { handleError(res,error); }
};
