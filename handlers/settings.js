const { requireSession, parseBody, db, assertDb, emitEvent, audit, send, handleError, httpError } = require('../lib/server');
const { timeToMinutes } = require('../lib/schedule');

module.exports = async function handler(req,res){
  try{
    if(req.method!=='PATCH') return send(res,405,{ok:false,error:'Method not allowed'});
    const caller=await requireSession(req,{manager:true});
    const body=parseBody(req);
    const current=assertDb(await db().from('hadas_app_settings').select('*').eq('id',1).maybeSingle(),'לא ניתן לטעון הגדרות') || {};
    const row={};
    for(const key of ['opening_time','morning_end_time','closing_time','friday_closing_time','morning_required_staff','required_staff','closing_required_staff','closing_window_minutes','validation_slot_minutes','require_leader']) {
      if(body[key]!==undefined) row[key]=body[key];
    }
    if(body.max_daily_staff!==undefined) row.max_daily_staff = body.max_daily_staff === '' || body.max_daily_staff === null ? null : Number(body.max_daily_staff);
    if(!Object.keys(row).length) throw httpError(400,'לא נשלחו הגדרות לעדכון');
    const next={...current,...row};
    const morningRequired=Number(next.morning_required_staff);
    const required=Number(next.required_staff);
    const closingRequired=Number(next.closing_required_staff);
    const closingWindow=Number(next.closing_window_minutes);
    const slot=Number(next.validation_slot_minutes);
    const maxDaily=next.max_daily_staff===null||next.max_daily_staff===''||next.max_daily_staff===undefined?null:Number(next.max_daily_staff);
    if(timeToMinutes(next.morning_end_time||'08:15')<=timeToMinutes(next.opening_time)||timeToMinutes(next.morning_end_time||'08:15')>=timeToMinutes(next.closing_time)) throw httpError(400,'סיום תקן הבוקר חייב להיות לאחר הפתיחה ולפני הסגירה');
    if(timeToMinutes(next.closing_time)<=timeToMinutes(next.opening_time)) throw httpError(400,'שעת הסגירה חייבת להיות לאחר שעת הפתיחה');
    if(timeToMinutes(next.friday_closing_time||'12:00')<=timeToMinutes(next.opening_time)) throw httpError(400,'שעת הסגירה ביום שישי חייבת להיות לאחר שעת הפתיחה');
    if(timeToMinutes(next.friday_closing_time||'12:00')>timeToMinutes('12:00')) throw httpError(400,'ביום שישי המעון פועל עד 12:00');
    row.require_leader = next.require_leader !== false && next.require_leader !== 'false';
    if(!Number.isInteger(morningRequired)||morningRequired<1||morningRequired>10) throw httpError(400,'מספר אנשי הצוות בבוקר אינו תקין');
    if(!Number.isInteger(required)||required<1||required>10) throw httpError(400,'מספר אנשי הצוות אינו תקין');
    if(!Number.isInteger(closingRequired)||closingRequired<1||closingRequired>required) throw httpError(400,'מספר העובדים בסגירה חייב להיות בין 1 למספר הצוות הרגיל');
    if(!Number.isInteger(closingWindow)||closingWindow<0||closingWindow>180||(closingWindow>0&&closingWindow<15)) throw httpError(400,'חלון הסגירה חייב להיות בין 15 ל-180 דקות');
    if(![15,30,60].includes(slot)) throw httpError(400,'מרווח הבדיקה אינו תקין');
    if(maxDaily!==null){
      if(!Number.isInteger(maxDaily)||maxDaily<1||maxDaily>20) throw httpError(400,'מקסימום התקינה היומית חייב להיות מספר בין 1 ל-20');
      if(maxDaily<Math.max(morningRequired,required,closingRequired)) throw httpError(400,'מקסימום התקינה היומית לא יכול להיות נמוך מדרישת התקינה המינימלית');
      row.max_daily_staff=maxDaily;
    } else if(body.max_daily_staff!==undefined) row.max_daily_staff=null;
    assertDb(await db().from('hadas_app_settings').update(row).eq('id',1),'לא ניתן לעדכן הגדרות');
    await audit(caller.employee.id,'update','settings','1',row);
    await emitEvent('settings');
    send(res,200,{ok:true,settings:{...next,...row}});
  }catch(error){handleError(res,error);}
};
