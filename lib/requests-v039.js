const server=require('./server');
const {approvalMessage,rejectionMessage}=require('./request-format');
const originalNotifyEmployees=server.notifyEmployees;

function truthy(value){
  return value===true||String(value||'').toLowerCase()==='true'||String(value||'')==='1'||String(value||'').toLowerCase()==='on';
}
function inclusiveDays(start,end){
  const a=new Date(`${start}T12:00:00Z`),b=new Date(`${end||start}T12:00:00Z`);
  return Math.floor((b-a)/86400000)+1;
}
function humanizeDates(value){
  return String(value||'')
    .replace(/(\d{4})-(\d{2})-(\d{2})[–-](\d{4})-(\d{2})-(\d{2})/g,(_,y1,m1,d1,y2,m2,d2)=>`${d1}.${m1}.${y1} עד ${d2}.${m2}.${y2}`)
    .replace(/(\d{4})-(\d{2})-(\d{2})/g,(_,y,m,d)=>`${d}.${m}.${y}`);
}
function humanizeTechnical(value){
  return humanizeDates(value)
    .replaceAll('עודכנה בטיוטת השיבוץ','עודכנה בשיבוץ')
    .replaceAll('עודכן בטיוטת השיבוץ','עודכן בשיבוץ')
    .replaceAll('הועבר אליך בטיוטת השיבוץ','עודכן עבורך בשיבוץ')
    .replaceAll('הוזרמה לשיבוץ','עודכנה בשיבוץ')
    .replaceAll('הוזרמה','עודכנה')
    .replaceAll('בטיוטה','בהתאם');
}

server.notifyEmployees=async function notifyEmployeesV039(employeeIds,notification,actorId=null){
  let next={...(notification||{})};
  if(next.entityType==='request'&&next.entityId){
    try{
      const request=server.assertDb(
        await server.db().from('hadas_requests').select('*').eq('id',String(next.entityId)).maybeSingle(),
        'לא ניתן לטעון בקשה לניסוח ההתראה'
      );
      if(request){
        if(['הבקשה שלך אושרה','בקשת ההחלפה אושרה והוזרמה'].includes(String(next.title||''))){
          next={
            ...next,
            title:request.request_type==='swap'?'בקשת ההחלפה אושרה':'הבקשה שלך אושרה',
            message:approvalMessage(request,request.manager_note||''),
          };
        }else if(String(next.title||'')==='הבקשה שלך נדחתה'){
          next={...next,message:rejectionMessage(request,request.manager_note||'')};
        }
      }
    }catch(error){
      console.warn('v0.39 request notification formatting fallback',error?.message||error);
    }
    next.title=humanizeTechnical(next.title);
    next.message=humanizeTechnical(next.message);
  }
  return originalNotifyEmployees(employeeIds,next,actorId);
};

const previousHandler=require('./requests-v030');
const {requireSession,parseBody,db,assertDb,isManager,emitEvent,audit,send,handleError,httpError}=server;

function captureResponse(){
  return{
    statusCode:200,headers:{},body:'',
    status(code){this.statusCode=code;return this;},
    setHeader(name,value){this.headers[String(name).toLowerCase()]=value;return this;},
    getHeader(name){return this.headers[String(name).toLowerCase()];},
    end(value=''){this.body=value??'';return this;},
    json(value){this.setHeader('content-type','application/json; charset=utf-8');return this.end(JSON.stringify(value));},
  };
}
function parseCaptured(source){
  try{return JSON.parse(String(source.body||'{}'));}catch{return null;}
}
function replay(source,target,payload){
  target.status(source.statusCode||200);
  for(const [name,value] of Object.entries(source.headers||{}))target.setHeader(name,value);
  return target.end(payload===undefined?source.body:JSON.stringify(payload));
}

module.exports=async function requestsV039(req,res){
  try{
    const body=parseBody(req);
    const action=String(body.action||'create');

    if(req.method==='POST'&&action==='set_manual_leave_form'){
      const caller=await requireSession(req);
      const request=assertDb(
        await db().from('hadas_requests').select('*').eq('id',String(body.id||'')).maybeSingle(),
        'הבקשה לא נמצאה'
      );
      if(!request)throw httpError(404,'הבקשה לא נמצאה');
      if(!isManager(caller)&&request.requester_id!==caller.employee.id)throw httpError(403,'אין הרשאה לעדכן את סימון טופס החופשה');
      if(request.request_type!=='leave'||inclusiveDays(request.request_date,request.request_end_date)<=2){
        throw httpError(409,'סימון הטופס הידני רלוונטי רק לחופשה של יותר מיומיים');
      }
      const completed=truthy(body.completed);
      const updated=assertDb(await db().from('hadas_requests').update({
        manual_leave_form_completed:completed,
        manual_leave_form_completed_at:completed?new Date().toISOString():null,
        manual_leave_form_completed_by:completed?caller.employee.id:null,
      }).eq('id',request.id).select('*').single(),'לא ניתן לעדכן את סימון טופס החופשה');
      await audit(caller.employee.id,completed?'manual_leave_form_completed':'manual_leave_form_reopened','request',request.id);
      await emitEvent('requests');
      return send(res,200,{ok:true,request:updated});
    }

    if(req.method==='POST'&&action==='create'){
      const normalized={...body};
      const type=String(body.request_type||'');
      normalized.requested_start=type==='late_start'?(String(body.requested_start||'').trim()||null):null;
      normalized.requested_end=type==='early_finish'?(String(body.requested_end||'').trim()||null):null;
      req.body=normalized;

      const captured=captureResponse();
      await previousHandler(req,captured);
      if(captured.statusCode>=400)return replay(captured,res);
      const payload=parseCaptured(captured);
      const created=payload?.request;

      if(created?.id&&created.request_type==='leave'&&inclusiveDays(created.request_date,created.request_end_date)>2){
        const completed=truthy(body.manual_leave_form_completed);
        const caller=await requireSession(req);
        const updated=assertDb(await db().from('hadas_requests').update({
          manual_leave_form_completed:completed,
          manual_leave_form_completed_at:completed?new Date().toISOString():null,
          manual_leave_form_completed_by:completed?caller.employee.id:null,
        }).eq('id',created.id).select('*').single(),'הבקשה נשמרה אך לא ניתן לעדכן את סימון הטופס הידני');
        if(payload)payload.request=updated;
      }
      return replay(captured,res,payload||undefined);
    }

    return previousHandler(req,res);
  }catch(error){
    return handleError(res,error);
  }
};

module.exports.humanizeDates=humanizeDates;
module.exports.humanizeTechnical=humanizeTechnical;
