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

module.exports = async function pushHandler(req, res) {
  try {
    const caller = await requireSession(req, { csrf: false });
    if (req.method === 'GET') {
      const [configR, subscriptionsR] = await Promise.all([
        db().from('hadas_push_config').select('public_key').eq('id', 1).maybeSingle(),
        db().from('hadas_push_subscriptions').select('id,endpoint,active').eq('employee_id', caller.employee.id).eq('active', true),
      ]);
      const config = assertDb(configR, 'שירות ההתראות אינו זמין כרגע');
      const subscriptions = assertDb(subscriptionsR, 'לא ניתן לבדוק את מצב ההתראות') || [];
      return send(res, 200, { ok:true, available:Boolean(config?.public_key), publicKey:config?.public_key || null, subscriptionCount:subscriptions.length });
    }
    if (req.method !== 'POST') return send(res, 405, { ok:false, error:'Method not allowed' });
    const body = parseBody(req);
    const action = String(body.action || 'subscribe');
    if (action === 'subscribe') {
      const sub = cleanSubscription(body);
      const now = new Date().toISOString();
      const row = assertDb(await db().from('hadas_push_subscriptions').upsert({
        employee_id:caller.employee.id, endpoint:sub.endpoint, p256dh:sub.p256dh, auth:sub.auth,
        user_agent:String(req.headers['user-agent'] || '').slice(0,500) || null,
        device_label:String(body.device_label || '').slice(0,120) || null,
        active:true, failure_count:0, updated_at:now,
      }, { onConflict:'endpoint' }).select('id').single(), 'לא ניתן להפעיל התראות');
      await audit(caller.employee.id, 'push_subscribe', 'push_subscription', row.id);
      return send(res, 200, { ok:true, subscribed:true });
    }
    if (action === 'unsubscribe') {
      const endpoint = String(body.endpoint || '').trim();
      const query = db().from('hadas_push_subscriptions').delete().eq('employee_id', caller.employee.id);
      assertDb(await (endpoint ? query.eq('endpoint', endpoint) : query), 'לא ניתן לכבות התראות');
      await audit(caller.employee.id, 'push_unsubscribe', 'push_subscription', caller.employee.id);
      return send(res, 200, { ok:true, subscribed:false });
    }
    if (action === 'test') {
      await sendPushNotifications([caller.employee.id], { title:'התראות מעון הדס פעילות ✓', message:'מעכשיו עדכונים חשובים יכולים להגיע ישירות לטלפון.', url:'/?push=notifications', tag:'hadas-push-test' });
      return send(res, 200, { ok:true });
    }
    throw httpError(400, 'פעולת התראה לא מוכרת');
  } catch (error) { return handleError(res, error); }
};
module.exports.cleanSubscription = cleanSubscription;
