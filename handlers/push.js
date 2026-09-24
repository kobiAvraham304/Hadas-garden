const {
  requireSession, parseBody, db, assertDb, sendPushNotifications, audit,
  send, handleError, httpError,
} = require('../lib/server');

function cleanSubscription(body = {}) {
  const endpoint = String(body.endpoint || '').trim();
  const p256dh = String(body.p256dh || '').trim();
  const auth = String(body.auth || '').trim();
  let url;
  try { url = new URL(endpoint); } catch { throw httpError(400, 'כתובת ההתראה אינה תקינה'); }
  if (url.protocol !== 'https:' || endpoint.length > 4096) throw httpError(400, 'כתובת ההתראה אינה תקינה');
  if (!p256dh || !auth || p256dh.length > 512 || auth.length > 256) throw httpError(400, 'מפתחות ההתראה אינם תקינים');
  return { endpoint, p256dh, auth };
}

async function getPreference(employeeId) {
  const result = await db().from('hadas_push_preferences')
    .select('smart_shift_reminders')
    .eq('employee_id',employeeId)
    .maybeSingle();
  const row = assertDb(result,'לא ניתן לטעון את העדפות ההתראות');
  return row || null;
}

async function ensureDefaultPreference(employeeId) {
  const existing = await getPreference(employeeId);
  if (existing) return existing;
  const row = assertDb(await db().from('hadas_push_preferences').insert({
    employee_id:employeeId,
    smart_shift_reminders:true,
    updated_at:new Date().toISOString(),
  }).select('smart_shift_reminders').single(), 'לא ניתן לשמור העדפות התראות');
  return row;
}

module.exports = async function pushHandler(req, res) {
  try {
    const caller = await requireSession(req, { csrf: false });

    if (req.method === 'GET') {
      const [configR,subscriptionsR,preferenceR] = await Promise.all([
        db().from('hadas_push_config').select('public_key').eq('id',1).maybeSingle(),
        db().from('hadas_push_subscriptions').select('id,endpoint,active').eq('employee_id',caller.employee.id).eq('active',true),
        db().from('hadas_push_preferences').select('smart_shift_reminders').eq('employee_id',caller.employee.id).maybeSingle(),
      ]);
      const config = assertDb(configR,'שירות ההתראות אינו זמין כרגע');
      const subscriptions = assertDb(subscriptionsR,'לא ניתן לבדוק את מצב ההתראות') || [];
      const preference = assertDb(preferenceR,'לא ניתן לטעון העדפות התראות');
      return send(res,200,{
        ok:true,
        available:Boolean(config?.public_key),
        publicKey:config?.public_key || null,
        subscriptionCount:subscriptions.length,
        smartShiftReminders:preference?.smart_shift_reminders !== false,
      });
    }

    if (req.method !== 'POST') return send(res,405,{ok:false,error:'Method not allowed'});

    const body = parseBody(req);
    const action = String(body.action || 'subscribe');

    if (action === 'subscribe') {
      const sub = cleanSubscription(body);
      const now = new Date().toISOString();
      const row = assertDb(await db().from('hadas_push_subscriptions').upsert({
        employee_id:caller.employee.id,
        endpoint:sub.endpoint,
        p256dh:sub.p256dh,
        auth:sub.auth,
        user_agent:String(req.headers['user-agent'] || '').slice(0,500) || null,
        device_label:String(body.device_label || '').slice(0,120) || null,
        active:true,
        failure_count:0,
        updated_at:now,
      }, { onConflict:'endpoint' }).select('id').single(), 'לא ניתן להפעיל התראות');
      const preference = await ensureDefaultPreference(caller.employee.id);
      await audit(caller.employee.id,'push_subscribe','push_subscription',row.id,{smart_shift_reminders:preference.smart_shift_reminders});
      return send(res,200,{ok:true,subscribed:true,smartShiftReminders:preference.smart_shift_reminders !== false});
    }

    if (action === 'unsubscribe') {
      const endpoint = String(body.endpoint || '').trim();
      const query = db().from('hadas_push_subscriptions').delete().eq('employee_id',caller.employee.id);
      assertDb(await (endpoint ? query.eq('endpoint',endpoint) : query),'לא ניתן לכבות התראות');
      await audit(caller.employee.id,'push_unsubscribe','push_subscription',caller.employee.id);
      return send(res,200,{ok:true,subscribed:false});
    }

    if (action === 'set_smart_shift_reminders') {
      const enabled = body.enabled === true || body.enabled === 'true' || body.enabled === 1 || body.enabled === '1';
      const row = assertDb(await db().from('hadas_push_preferences').upsert({
        employee_id:caller.employee.id,
        smart_shift_reminders:enabled,
        updated_at:new Date().toISOString(),
      }, { onConflict:'employee_id' }).select('smart_shift_reminders').single(), 'לא ניתן לעדכן תזכורות משמרת');
      await audit(caller.employee.id,'push_smart_shift_reminders','push_preference',caller.employee.id,{enabled:row.smart_shift_reminders});
      return send(res,200,{ok:true,smartShiftReminders:row.smart_shift_reminders});
    }

    if (action === 'test') {
      const results = await sendPushNotifications([caller.employee.id], {
        title:'התראות מעון הדס פעילות ✓',
        message:'מעכשיו עדכונים חשובים יכולים להגיע ישירות לטלפון.',
        url:'/?push=notifications',
        tag:'hadas-push-test',
      });
      const settled = (results || []).map((item) => item?.value).filter(Boolean);
      const sent = settled.filter((item) => item.ok).length;
      const failed = settled.filter((item) => !item.ok).length;
      console.log(JSON.stringify({level:'info',msg:'push_test',employeeId:caller.employee.id,subscriptions:settled.length,sent,failed}));
      if (!settled.length) throw httpError(409,'לא נמצא מכשיר פעיל להתראות');
      if (!sent) throw httpError(502,'ההתראה לא נמסרה לשירות ההתראות');
      return send(res,200,{ok:true,sent,failed});
    }

    throw httpError(400,'פעולת התראה לא מוכרת');
  } catch(error) {
    return handleError(res,error);
  }
};

module.exports.cleanSubscription = cleanSubscription;
