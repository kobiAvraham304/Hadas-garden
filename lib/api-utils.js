const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'];

function getEnv() {
  for (const name of REQUIRED_ENV) {
    if (!process.env[name]) throw new Error(`Missing environment variable: ${name}`);
  }
  return {
    url: process.env.SUPABASE_URL.replace(/\/$/, ''),
    publicKey: process.env.SUPABASE_PUBLISHABLE_KEY,
    secretKey: process.env.SUPABASE_SECRET_KEY,
    bootstrapToken: process.env.BOOTSTRAP_TOKEN || '',
  };
}

function normalizePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.startsWith('972')) return `+${digits}`;
  if (digits.startsWith('0')) return `+972${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith('5')) return `+972${digits}`;
  if (String(input || '').startsWith('+')) return `+${digits}`;
  throw new Error('מספר הטלפון אינו תקין');
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

async function supabaseFetch(path, options = {}) {
  const env = getEnv();
  const key = options.useSecret ? env.secretKey : env.publicKey;
  const token = options.token || key;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...options.headers,
  };
  const response = await fetch(`${env.url}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    const message = data?.message || data?.msg || data?.error_description || data?.error || text || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return { data, response };
}

async function getCaller(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    const error = new Error('נדרשת התחברות');
    error.status = 401;
    throw error;
  }

  const { data: user } = await supabaseFetch('/auth/v1/user', { token });
  const query = `/rest/v1/hadas_profiles?id=eq.${encodeURIComponent(user.id)}&select=*&limit=1`;
  const { data: hadas_profiles } = await supabaseFetch(query, { useSecret: true });
  const profile = Array.isArray(hadas_profiles) ? hadas_profiles[0] : null;
  if (!profile || !profile.active) {
    const error = new Error('המשתמשת אינה פעילה במערכת');
    error.status = 403;
    throw error;
  }
  return { token, user, profile };
}

async function requireManager(req) {
  const caller = await getCaller(req);
  if (!['admin', 'scheduler'].includes(caller.profile.role)) {
    const error = new Error('אין הרשאה לביצוע הפעולה');
    error.status = 403;
    throw error;
  }
  return caller;
}

function send(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function handleError(res, error) {
  console.error(error);
  const status = Number(error.status) || 500;
  send(res, status, {
    ok: false,
    error: status >= 500 ? 'אירעה שגיאה בשרת' : error.message,
    details: process.env.NODE_ENV === 'development' ? error.details || null : undefined,
  });
}

module.exports = {
  getEnv,
  normalizePhone,
  parseBody,
  supabaseFetch,
  getCaller,
  requireManager,
  send,
  handleError,
};
