const {
  requireSession, parseBody, db, assertDb, isManager, canCreateContent,
  emitEvent, audit, notifyEmployees, send, handleError, httpError,
} = require('../lib/server');

function cleanEmployeeIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).filter(Boolean))].slice(0, 500);
}

async function targetEmployees(targetType, targetId, employeeIds = []) {
  let query = db().from('hadas_employees').select('id').eq('active', true);
  if (targetType === 'class') query = query.eq('primary_class_id', targetId);
  if (targetType === 'employee') query = query.eq('id', targetId);
  if (targetType === 'employees') {
    const ids = cleanEmployeeIds(employeeIds);
    if (!ids.length) throw httpError(400, 'יש לבחור לפחות עובד אחד');
    query = query.in('id', ids);
  }
  const employees = assertDb(await query, 'לא ניתן למצוא מקבלי המשימה') || [];
  if (targetType === 'employees' && employees.length !== cleanEmployeeIds(employeeIds).length) throw httpError(409, 'אחד העובדים שנבחרו אינו פעיל');
  return employees;
}

async function replaceAssignees(taskId, targetType, targetId, employeeIds = []) {
  const employees = await targetEmployees(targetType, targetId, employeeIds);
  if (!employees.length) throw httpError(409, 'לא נמצאו עובדים מתאימים למשימה');
  const existing = assertDb(await db().from('hadas_task_assignees').select('*').eq('task_id', taskId), 'לא ניתן לטעון שיוכים') || [];
  const existingMap = new Map(existing.map((row) => [row.employee_id, row]));
  assertDb(await db().from('hadas_task_assignees').delete().eq('task_id', taskId), 'לא ניתן לעדכן שיוכים');
  const rows = employees.map((employee) => ({
    task_id: taskId,
    employee_id: employee.id,
    status: existingMap.get(employee.id)?.status || 'pending',
    completed_at: existingMap.get(employee.id)?.completed_at || null,
  }));
  assertDb(await db().from('hadas_task_assignees').insert(rows), 'לא ניתן לשייך משימה');
  return employees.map((employee) => employee.id);
}

async function getTask(id) {
  return assertDb(await db().from('hadas_tasks').select('*').eq('id', id).maybeSingle(), 'המשימה לא נמצאה');
}

function canManage(caller, task) {
  return isManager(caller) || task?.created_by === caller.employee.id;
}

module.exports = async function handler(req, res) {
  try {
    if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return send(res, 405, { ok: false, error: 'Method not allowed' });
    const caller = await requireSession(req);
    const body = parseBody(req);

    if (req.method === 'POST' && ['complete', 'reopen'].includes(body.action)) {
      const status = body.action === 'complete' ? 'done' : 'pending';
      const assignment = assertDb(await db().from('hadas_task_assignees').select('*').eq('task_id', body.id).eq('employee_id', caller.employee.id).maybeSingle(), 'המשימה לא נמצאה');
      if (!assignment) throw httpError(404, 'המשימה אינה משויכת אליך');
      assertDb(await db().from('hadas_task_assignees').update({ status, completed_at: status === 'done' ? new Date().toISOString() : null }).eq('task_id', body.id).eq('employee_id', caller.employee.id), 'לא ניתן לעדכן משימה');
      await emitEvent('tasks');
      return send(res, 200, { ok: true });
    }

    if (!canCreateContent(caller)) throw httpError(403, 'אין הרשאה ליצור משימה');

    if (req.method === 'POST') {
      const title = String(body.title || '').trim();
      if (!title) throw httpError(400, 'יש להזין כותרת משימה');
      const targetType = ['all', 'class', 'employee', 'employees'].includes(body.target_type) ? body.target_type : 'all';
      if (['class', 'employee'].includes(targetType) && !body.target_id) throw httpError(400, 'יש לבחור יעד למשימה');
      const row = {
        title,
        description: String(body.description || '').trim() || null,
        due_at: body.due_at || null,
        valid_from: body.valid_from || null,
        valid_to: body.valid_to || null,
        priority: ['normal', 'important', 'urgent'].includes(body.priority) ? body.priority : 'normal',
        target_type: targetType,
        target_id: ['class', 'employee'].includes(targetType) ? body.target_id : null,
        active: true,
        created_by: caller.employee.id,
      };
      const task = assertDb(await db().from('hadas_tasks').insert(row).select('*').single(), 'לא ניתן ליצור משימה');
      let assigneeIds = [];
      try {
        assigneeIds = await replaceAssignees(task.id, targetType, row.target_id, body.employee_ids);
      } catch (error) {
        await db().from('hadas_tasks').delete().eq('id', task.id);
        throw error;
      }
      await notifyEmployees(assigneeIds.filter((id) => id !== caller.employee.id), { type:'task', title:`משימה חדשה: ${title}`, message:row.description || 'נוספה עבורך משימה חדשה.', entityType:'task', entityId:task.id, actionRequired:true });
      await audit(caller.employee.id, 'create', 'task', task.id, { targetType });
      await emitEvent('tasks');
      return send(res, 201, { ok: true, task });
    }

    const id = body.id || req.query?.id;
    if (!id) throw httpError(400, 'חסר מזהה משימה');
    const current = await getTask(id);
    if (!current) throw httpError(404, 'המשימה לא נמצאה');
    if (!canManage(caller, current)) throw httpError(403, 'ניתן לנהל רק משימה שיצרת');

    if (req.method === 'PATCH') {
      const row = {};
      for (const key of ['title', 'description', 'due_at', 'valid_from', 'valid_to', 'priority', 'active']) {
        if (body[key] !== undefined) row[key] = body[key] === '' ? null : body[key];
      }
      if (body.target_type !== undefined) {
        const targetType = ['all', 'class', 'employee', 'employees'].includes(body.target_type) ? body.target_type : 'all';
        if (['class', 'employee'].includes(targetType) && !body.target_id) throw httpError(400, 'יש לבחור יעד למשימה');
        row.target_type = targetType;
        row.target_id = ['class', 'employee'].includes(targetType) ? body.target_id : null;
        await replaceAssignees(id, targetType, row.target_id, body.employee_ids);
      }
      assertDb(await db().from('hadas_tasks').update(row).eq('id', id), 'לא ניתן לעדכן משימה');
      await audit(caller.employee.id, 'update', 'task', id);
      await emitEvent('tasks');
      return send(res, 200, { ok: true });
    }

    assertDb(await db().from('hadas_tasks').update({ active: false }).eq('id', id), 'לא ניתן להסיר משימה');
    await audit(caller.employee.id, 'deactivate', 'task', id);
    await emitEvent('tasks');
    return send(res, 200, { ok: true });
  } catch (error) { handleError(res, error); }
};
