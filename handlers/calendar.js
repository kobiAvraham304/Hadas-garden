const {
  requireSession, parseBody, db, assertDb, isManager, canCreateContent,
  emitEvent, audit, send, handleError, httpError,
} = require('../lib/server');

function monthRange(monthValue) {
  const safe = /^\d{4}-\d{2}$/.test(String(monthValue || '')) ? `${monthValue}-01` : new Date().toISOString().slice(0, 7) + '-01';
  const start = new Date(`${safe}T12:00:00Z`);
  const first = new Date(start); first.setUTCDate(first.getUTCDate() - first.getUTCDay());
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 12));
  const last = new Date(next); last.setUTCDate(last.getUTCDate() + (6 - last.getUTCDay()));
  return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
}

function addDays(dateString,days){const d=new Date(`${dateString}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function canSeeLeave(caller,employee){if(isManager(caller))return true;const title=String(caller.employee?.job_title||'');if(/(גננת|גנן)/.test(title)||['מנהלת מעון','אחות','מזכירה'].includes(title))return true;if(title==='סייעת מובילה')return employee?.primary_class_id===caller.employee.primary_class_id||employee?.id===caller.employee.id;return employee?.id===caller.employee.id;}
async function approvedLeaveEvents(caller,range){const [requestsR,employeesR]=await Promise.all([db().from('hadas_requests').select('id,requester_id,request_date,request_end_date,request_type,status').eq('request_type','leave').in('status',['approved','applied']).lte('request_date',range.end),db().from('hadas_employees').select('id,full_name,primary_class_id,job_title,active').eq('active',true)]);const requests=assertDb(requestsR,'לא ניתן לטעון חופשות')||[],employees=assertDb(employeesR,'לא ניתן לטעון עובדים')||[],map=new Map(employees.map((e)=>[e.id,e])),out=[];for(const request of requests){const employee=map.get(request.requester_id),end=request.request_end_date||request.request_date;if(!employee||!canSeeLeave(caller,employee)||end<range.start)continue;for(let date=request.request_date;date<=end;date=addDays(date,1)){if(date<range.start||date>range.end)continue;out.push({id:`leave:${request.id}:${date}`,title:employee.id===caller.employee.id?'חופשה מאושרת':`חופשה · ${employee.full_name}`,description:'חופשה מאושרת במערכת הבקשות',event_type:'approved_leave',event_date:date,start_time:null,end_time:null,visibility:'leave_request',class_id:employee.primary_class_id,created_by:null,source:'approved_leave',request_id:request.id,employee_id:employee.id,read_only:true});}}return out;}

function canSeeEvent(caller, event) {
  if (isManager(caller)) return true;
  if (event.created_by === caller.employee.id) return true;
  if (event.visibility === 'managers') return false;
  if (event.visibility === 'class') return event.class_id === caller.employee.primary_class_id;
  return true;
}

function canManageEvent(caller, event) {
  return isManager(caller) || event?.created_by === caller.employee.id;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const caller = await requireSession(req, { csrf: false });
      const range = monthRange(req.query?.month);
      let events = assertDb(await db().from('hadas_calendar_events').select('*').gte('event_date', range.start).lte('event_date', range.end).order('event_date').order('start_time'), 'לא ניתן לטעון לוח שנה') || [];
      events = events.filter((event) => canSeeEvent(caller, event));
      events.push(...await approvedLeaveEvents(caller,range)); events.sort((a,b)=>`${a.event_date}-${a.start_time||''}-${a.title||''}`.localeCompare(`${b.event_date}-${b.start_time||''}-${b.title||''}`,'he'));
      return send(res, 200, { ok: true, events, range });
    }

    const caller = await requireSession(req);
    if (!canCreateContent(caller)) throw httpError(403, 'אין הרשאה ליצור או לערוך אירועים');
    const body = parseBody(req);
    if (req.method === 'POST') {
      if (!String(body.title || '').trim() || !body.event_date) throw httpError(400, 'יש להזין כותרת ותאריך');
      const row = {
        title: String(body.title).trim(),
        description: String(body.description || '').trim() || null,
        event_type: ['holiday', 'meeting', 'training', 'birthday', 'activity', 'other'].includes(body.event_type) ? body.event_type : 'other',
        event_date: body.event_date,
        start_time: body.start_time || null,
        end_time: body.end_time || null,
        visibility: ['all', 'managers', 'class'].includes(body.visibility) ? body.visibility : 'all',
        class_id: body.visibility === 'class' ? body.class_id || null : null,
        created_by: caller.employee.id,
      };
      if (row.visibility === 'class' && !row.class_id) throw httpError(400, 'יש לבחור כיתה');
      const item = assertDb(await db().from('hadas_calendar_events').insert(row).select('*').single(), 'לא ניתן ליצור אירוע');
      await audit(caller.employee.id, 'create', 'calendar_event', item.id);
      await emitEvent('calendar');
      return send(res, 201, { ok: true, item });
    }
    if (req.method === 'PATCH') {
      if (!body.id) throw httpError(400, 'חסר מזהה אירוע');
      const current = assertDb(await db().from('hadas_calendar_events').select('*').eq('id', body.id).maybeSingle(), 'האירוע לא נמצא');
      if (!current) throw httpError(404, 'האירוע לא נמצא');
      if (!canManageEvent(caller, current)) throw httpError(403, 'ניתן לערוך רק אירוע שיצרת');
      const row = {};
      for (const key of ['title', 'description', 'event_type', 'event_date', 'start_time', 'end_time', 'visibility', 'class_id']) {
        if (body[key] !== undefined) row[key] = body[key] === '' ? null : body[key];
      }
      if (row.visibility && row.visibility !== 'class') row.class_id = null;
      assertDb(await db().from('hadas_calendar_events').update(row).eq('id', body.id), 'לא ניתן לעדכן אירוע');
      await audit(caller.employee.id, 'update', 'calendar_event', body.id);
      await emitEvent('calendar');
      return send(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      const id = body.id || req.query?.id;
      const current = assertDb(await db().from('hadas_calendar_events').select('*').eq('id', id).maybeSingle(), 'האירוע לא נמצא');
      if (!current) throw httpError(404, 'האירוע לא נמצא');
      if (!canManageEvent(caller, current)) throw httpError(403, 'ניתן למחוק רק אירוע שיצרת');
      assertDb(await db().from('hadas_calendar_events').delete().eq('id', id), 'לא ניתן למחוק אירוע');
      await audit(caller.employee.id, 'delete', 'calendar_event', id);
      await emitEvent('calendar');
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) { handleError(res, error); }
};
