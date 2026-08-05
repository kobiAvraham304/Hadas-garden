const { version } = require('../package.json');
const { db, send } = require('../lib/server');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { ok:false, error:'Method not allowed' });
  const required = ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY'];
  const missing = required.filter((name) => !process.env[name]);
  const checks = {
    environment:{ ok:missing.length === 0, missing },
    database:{ ok:false },
    schema:{ ok:false, version:null },
    initialAccounts:{ ok:false, count:0 },
  };
  if (!missing.length) {
    try {
      const classes = await db().from('hadas_classes').select('id').limit(1);
      checks.database = classes.error ? { ok:false, error:'לא ניתן להתחבר לטבלאות המערכת' } : { ok:true };
      const meta = await db().from('hadas_app_meta').select('*').eq('id',1).maybeSingle();
      checks.schema = meta.error
        ? { ok:false, version:null, error:'יש להריץ פעם אחת את קובץ העדכון update-v0.18.0.sql' }
        : { ok:Boolean(meta.data && meta.data.schema_version === '0.18.0'), version:meta.data?.schema_version || null };
      const accounts = await db().from('hadas_users').select('id').in('phone',['+972542521780','+972544594513']);
      checks.initialAccounts = accounts.error
        ? { ok:false, count:0, error:'לא ניתן לבדוק את החשבונות הראשוניים' }
        : { ok:Array.isArray(accounts.data) && accounts.data.length === 2, count:Array.isArray(accounts.data) ? accounts.data.length : 0 };
    } catch {
      checks.database = { ok:false, error:'בדיקת בסיס הנתונים נכשלה' };
    }
  }
  const ready = checks.environment.ok && checks.database.ok && checks.schema.ok && checks.initialAccounts.ok;
  return send(res, ready ? 200 : 503, { ok:ready, version, databaseVersion:'0.18.0', checks });
};
