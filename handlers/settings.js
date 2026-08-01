const { requireSession, parseBody, db, assertDb, emitEvent, audit, send, handleError, httpError } = require('../lib/server');
const { timeToMinutes } = require('../lib/schedule');

module.exports = async function handler(req,res){
  try{
    if(req.method!=='PATCH') return send(res,405,{ok:false,error:'Method not allowed'});
    const caller=await requireSession(req,{manager:true});
    const body=parseBody(req);
    const current=assertDb(await db().from('hadas_app_settings').select('*').eq('id',1).maybeSingle(),'לא ניתן לטעון הגדרות') || {};
    const row={};
    for(const key of ['opening_time','closing_time','required_staff','closing_required_staff','closing_window_minutes','validation_slot_minutes']) {
      if(body[key]!==undefined) row[key]=body[key];
    }
    if(!Object.keys(row).length) throw httpError(400,'לא נשלחו הגדרות לעדכון');
    const next={...current,...row};
    const required=Number(next.required_staff);
    const closingRequired=Number(next.closing_required_staff);
    const closingWindow=Number(next.closing_window_minutes);
    const slot=Number(next.validation_slot_minutes);
    if(timeToMinutes(next.closing_time)<=timeToMinutes(next.opening_time)) throw httpError(400,'שעת הסגירה חייבת להיות לאחר שעת הפתיחה');
    if(!Number.isInteger(required)||required<1||required>10) throw httpError(400,'מספר אנשי הצוות אינו תקין');
    if(!Number.isInteger(closingRequired)||closingRequired<1||closingRequired>required) throw httpError(400,'מספר העובדות בסגירה חייב להיות בין 1 למספר הצוות הרגיל');
    if(!Number.isInteger(closingWindow)||closingWindow<15||closingWindow>180) throw httpError(400,'חלון הסגירה חייב להיות בין 15 ל-180 דקות');
    if(![15,30,60].includes(slot)) throw httpError(400,'מרווח הבדיקה אינו תקין');
    assertDb(await db().from('hadas_app_settings').update(row).eq('id',1),'לא ניתן לעדכן הגדרות');
    await audit(caller.employee.id,'update','settings','1',row);
    await emitEvent('settings');
    send(res,200,{ok:true});
  }catch(error){handleError(res,error);}
};
