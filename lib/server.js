const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scryptAsync = promisify(crypto.scrypt);

const SESSION_COOKIE = 'hadas_session';
const SESSION_DAYS = 7;
let client;

function getEnv() {
  const required = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'];
  for (const key of required) if (!process.env[key]) throw new Error(`Missing environment variable: ${key}`);
  return {
    url: process.env.SUPABASE_URL.replace(/\/$/, ''),
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
    secretKey: process.env.SUPABASE_SECRET_KEY,
    // נגזר אוטומטית מהמפתח הסודי; אין צורך במשתנה נוסף ב-Vercel.
    sessionPepper: crypto.createHash('sha256').update(`${process.env.SUPABASE_SECRET_KEY}:${process.env.SUPABASE_URL}:hadas-session-v0.4.3`).digest('hex'),
  };
}

function apiHeaders(extra = {}) {
  const key = getEnv().secretKey;
  const headers = { apikey: key, ...extra };
  // Legacy service_role keys are JWTs and require Authorization. New sb_secret keys use apikey.
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function fetchJson(url, options = {}) {
  try {
    const timeoutMs = Math.min(14000, Math.max(1000, Number(process.env.SUPABASE_REQUEST_TIMEOUT_MS || 10000)));
    const requestOptions = options.signal ? options : { ...options, signal:AbortSignal.timeout(timeoutMs) };
    const response = await fetch(url, requestOptions);
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!response.ok) {
      return { data: null, error: { message: data?.message || data?.error || data?.hint || text || `HTTP ${response.status}`, status: response.status, details: data } };
    }
    return { data, error: null };
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return { data:null, error:{ message:timedOut ? 'החיבור ל־Supabase לא הגיב בזמן' : (error.message || 'Network error'), details:error } };
  }
}

class QueryBuilder {
  constructor(table) {
    this.table = table;
    this.method = 'GET';
    this.body = undefined;
    this.params = new URLSearchParams();
    this.orders = [];
    this.returnRepresentation = false;
    this.singleMode = null;
    this.prefer = [];
  }
  select(columns = '*') {
    this.params.set('select', columns);
    if (this.method !== 'GET') this.returnRepresentation = true;
    return this;
  }
  insert(body) { this.method = 'POST'; this.body = body; return this; }
  update(body) { this.method = 'PATCH'; this.body = body; return this; }
  upsert(body, options = {}) {
    this.method = 'POST'; this.body = body; this.prefer.push('resolution=merge-duplicates');
    if (options.onConflict) this.params.set('on_conflict', options.onConflict);
    return this;
  }
  delete() { this.method = 'DELETE'; return this; }
  eq(column, value) { this.params.append(column, `eq.${value}`); return this; }
  neq(column, value) { this.params.append(column, `neq.${value}`); return this; }
  gt(column, value) { this.params.append(column, `gt.${value}`); return this; }
  gte(column, value) { this.params.append(column, `gte.${value}`); return this; }
  lt(column, value) { this.params.append(column, `lt.${value}`); return this; }
  lte(column, value) { this.params.append(column, `lte.${value}`); return this; }
  is(column, value) { this.params.append(column, `is.${value}`); return this; }
  in(column, values) {
    const encoded = (values || []).map((value) => `"${String(value).replaceAll('"', '\\"')}"`).join(',');
    this.params.append(column, `in.(${encoded})`); return this;
  }
  or(expression) { this.params.append('or', `(${expression})`); return this; }
  order(column, options = {}) { this.orders.push(`${column}.${options.ascending === false ? 'desc' : 'asc'}`); return this; }
  limit(value) { this.params.set('limit', String(value)); return this; }
  single() { this.singleMode = 'single'; this.returnRepresentation = true; return this; }
  maybeSingle() { this.singleMode = 'maybe'; this.returnRepresentation = true; return this; }
  async execute() {
    if (this.orders.length) this.params.set('order', this.orders.join(','));
    const query = this.params.toString();
    const url = `${getEnv().url}/rest/v1/${encodeURIComponent(this.table)}${query ? `?${query}` : ''}`;
    const prefer = [...this.prefer];
    if (this.method !== 'GET') prefer.push(this.returnRepresentation ? 'return=representation' : 'return=minimal');
    const headers = apiHeaders({ 'Content-Type': 'application/json' });
    if (prefer.length) headers.Prefer = prefer.join(',');
    const result = await fetchJson(url, { method: this.method, headers, body: this.body === undefined ? undefined : JSON.stringify(this.body) });
    if (result.error) return result;
    let data = result.data;
    if (this.singleMode) {
      if (Array.isArray(data)) {
        if (!data.length && this.singleMode === 'maybe') data = null;
        else if (data.length === 1) data = data[0];
        else if (!data.length) return { data: null, error: { message: 'No rows returned', status: 406 } };
        else return { data: null, error: { message: 'Multiple rows returned', status: 406 } };
      }
    }
    return { data, error: null };
  }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
}

class RestClient {
  from(table) { return new QueryBuilder(table); }
  async rpc(name, body) {
    return fetchJson(`${getEnv().url}/rest/v1/rpc/${encodeURIComponent(name)}`, {
      method: 'POST', headers: apiHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }), body: JSON.stringify(body || {}),
    });
  }
}

function db() { if (!client) client = new RestClient(); return client; }

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body;
}

function normalizePhone(input) {
  const raw = String(input || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('972') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+972${digits.slice(1)}`;
  if (digits.startsWith('5') && digits.length === 9) return `+972${digits}`;
  throw httpError(400, 'מספר הטלפון אינו תקין');
}


function israelDateISO(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Jerusalem', year:'numeric', month:'2-digit', day:'2-digit',
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function displayPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('972') && digits.length === 12) {
    const local = `0${digits.slice(3)}`;
    return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return phone || '';
}

function httpError(status, message, details) { const error = new Error(message); error.status = status; error.details = details; return error; }
function assertDb(result, fallback = 'פעולת מסד הנתונים נכשלה') {
  if (result?.error) {
    const message = result.error.message || fallback;
    const status = /duplicate key|unique constraint/i.test(message) ? 409 : (Number(result.error.status) >= 400 && Number(result.error.status) < 500 ? Number(result.error.status) : 500);
    throw httpError(status, status === 409 ? 'כבר קיים במערכת ערך זהה' : fallback, result.error);
  }
  return result?.data;
}
function send(res, status, payload) { res.status(status); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store, max-age=0'); res.setHeader('Pragma', 'no-cache'); res.end(JSON.stringify(payload)); }
function handleError(res, error) { console.error(error); const status = Number(error.status) || 500; send(res, status, { ok: false, error: status >= 500 ? 'אירעה שגיאה בשרת' : error.message, details: process.env.NODE_ENV === 'development' ? error.details || null : undefined }); }
function parseCookies(req) {
  if (req.cookies && typeof req.cookies === 'object') return req.cookies;
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map((p) => p.trim()).filter(Boolean).map((part) => { const i = part.indexOf('='); return [decodeURIComponent(part.slice(0, i)), decodeURIComponent(part.slice(i + 1))]; }));
}
function appendSetCookie(res, value) { const current = res.getHeader('Set-Cookie'); if (!current) res.setHeader('Set-Cookie', value); else res.setHeader('Set-Cookie', Array.isArray(current) ? [...current, value] : [current, value]); }
function setSessionCookie(res, token, maxAgeSeconds = SESSION_DAYS * 86400) { appendSetCookie(res, `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`); }
function clearSessionCookie(res) { appendSetCookie(res, `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`); }
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function sha256(value) { return crypto.createHash('sha256').update(`${value}:${getEnv().sessionPepper}`).digest('hex'); }
function safeEqual(left, right) { const a = Buffer.from(String(left || '')); const b = Buffer.from(String(right || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function clientIp(req) { return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 100); }
function verifyOrigin(req) {
  const origin = req.headers.origin; if (!origin) return;
  try { const originHost = new URL(origin).host; const requestHost = String(req.headers['x-forwarded-host'] || req.headers.host || ''); if (originHost !== requestHost) throw httpError(403, 'הבקשה נחסמה מטעמי אבטחה'); }
  catch (error) { if (error.status) throw error; throw httpError(403, 'מקור הבקשה אינו תקין'); }
}

async function createSession(req, res, userId) {
  const token = randomToken(36), csrfToken = randomToken(24), expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  assertDb(await db().from('hadas_sessions').insert({ user_id: userId, token_hash: sha256(token), csrf_token: csrfToken, expires_at: expiresAt, user_agent: String(req.headers['user-agent'] || '').slice(0, 500), ip_hash: sha256(clientIp(req) || 'unknown') }), 'לא ניתן היה ליצור התחברות');
  setSessionCookie(res, token); return csrfToken;
}
async function getSession(req, { optional = false } = {}) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) { if (optional) return null; throw httpError(401, 'נדרשת התחברות'); }
  const session = assertDb(await db().from('hadas_sessions').select('*').eq('token_hash', sha256(token)).is('revoked_at', 'null').gt('expires_at', new Date().toISOString()).maybeSingle(), 'בדיקת ההתחברות נכשלה');
  if (!session) { if (optional) return null; throw httpError(401, 'ההתחברות פגה. יש להתחבר מחדש'); }
  const user = assertDb(await db().from('hadas_users').select('*').eq('id', session.user_id).maybeSingle(), 'המשתמש לא נמצא');
  if (!user || !user.active) throw httpError(403, 'המשתמש אינו פעיל במערכת');
  const employee = assertDb(await db().from('hadas_employees').select('*').eq('id', user.employee_id).maybeSingle(), 'כרטיס העובד לא נמצא');
  if (!employee || !employee.active) throw httpError(403, 'העובד אינו פעיל במערכת');
  if (Date.now() - Date.parse(session.last_seen_at || 0) > 5 * 60_000) db().from('hadas_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', session.id).then(() => {}).catch(() => {});
  return { session, user, employee, profile: { ...employee, role: user.role, phone: user.phone, must_change_password: user.must_change_password } };
}
async function requireSession(req, { manager = false, csrf = true } = {}) {
  if (req.method !== 'GET') verifyOrigin(req);
  const caller = await getSession(req);
  if (manager && !['admin', 'scheduler'].includes(caller.user.role)) throw httpError(403, 'אין הרשאה לביצוע הפעולה');
  if (csrf && req.method !== 'GET' && !safeEqual(req.headers['x-csrf-token'], caller.session.csrf_token)) throw httpError(403, 'אימות הבקשה נכשל. יש לרענן את הדף');
  return caller;
}
function isManager(caller) { return ['admin', 'scheduler'].includes(caller?.user?.role); }
function isTeacher(caller) { return /גנ(?:נ|ן)/.test(String(caller?.employee?.job_title || '')); }
function canViewFullSchedule(caller) {
  const title = String(caller?.employee?.job_title || '');
  return isManager(caller) || isTeacher(caller) || ['אחות','מנהלת מעון','מזכירה'].includes(title);
}
function canCreateContent(caller) {
  const title = String(caller?.employee?.job_title || '');
  return isManager(caller) || isTeacher(caller) || ['אחות','מזכירה'].includes(title);
}

async function activeManagerEmployeeIds() {
  const users = assertDb(await db().from('hadas_users').select('employee_id').in('role', ['admin','scheduler']).eq('active', true), 'לא ניתן למצוא מנהלים') || [];
  return [...new Set(users.map((row) => row.employee_id).filter(Boolean))];
}
async function notifyEmployees(employeeIds, { type='info', title, message='', entityType=null, entityId=null, actionRequired=false } = {}) {
  const ids = [...new Set((employeeIds || []).map(String).filter(Boolean))];
  if (!ids.length || !title) return [];
  const rows = ids.map((employeeId) => ({
    employee_id: employeeId,
    notification_type: String(type || 'info').slice(0, 40),
    title: String(title).slice(0, 180),
    message: String(message || '').slice(0, 1000) || null,
    entity_type: entityType ? String(entityType).slice(0, 60) : null,
    entity_id: entityId ? String(entityId).slice(0, 120) : null,
    action_required: Boolean(actionRequired),
  }));
  const result = await db().from('hadas_notifications').insert(rows).select('*');
  if (result.error) { console.error('Notification insert failed', result.error); return []; }
  return result.data || [];
}
async function notifyManagers(payload, excludeEmployeeId = null) {
  const ids = (await activeManagerEmployeeIds()).filter((id) => id !== excludeEmployeeId);
  return notifyEmployees(ids, payload);
}
function safeStoragePathPart(value) {
  return String(value || 'file').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || 'file';
}
async function uploadPrivateFile(bucket, path, buffer, contentType='application/octet-stream') {
  const encodedPath = String(path).split('/').map(encodeURIComponent).join('/');
  const result = await fetchJson(`${getEnv().url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`, {
    method:'POST',
    headers:apiHeaders({ 'Content-Type':contentType, 'x-upsert':'false' }),
    body:buffer,
  });
  if (result.error) throw httpError(500, 'לא ניתן להעלות את הקובץ', result.error);
  return result.data;
}
async function createPrivateFileUrl(bucket, path, expiresIn=300) {
  const encodedPath = String(path).split('/').map(encodeURIComponent).join('/');
  const result = await fetchJson(`${getEnv().url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodedPath}`, {
    method:'POST',
    headers:apiHeaders({ 'Content-Type':'application/json' }),
    body:JSON.stringify({ expiresIn }),
  });
  if (result.error) throw httpError(500, 'לא ניתן לפתוח את הקובץ', result.error);
  const signed = result.data?.signedURL || result.data?.signedUrl || result.data?.signed_url;
  if (!signed) throw httpError(500, 'לא התקבל קישור לקובץ');
  return signed.startsWith('http') ? signed : `${getEnv().url}${signed.startsWith('/') ? '' : '/'}${signed}`;
}
async function deletePrivateFile(bucket, path) {
  if (!path) return;
  const encodedPath = String(path).split('/').map(encodeURIComponent).join('/');
  const result = await fetchJson(`${getEnv().url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`, {
    method:'DELETE',
    headers:apiHeaders(),
  });
  if (result.error && Number(result.error.status) !== 404) console.error('Private file cleanup failed', result.error);
}

async function revokeUserSessions(userId) { assertDb(await db().from('hadas_sessions').update({ revoked_at: new Date().toISOString() }).eq('user_id', userId).is('revoked_at', 'null'), 'לא ניתן היה לנתק את המשתמש'); }
async function emitEvent(topic) { const result = await db().from('hadas_realtime_events').insert({ topic: String(topic || 'refresh').slice(0, 80) }); if (result.error) console.error('Realtime event failed', result.error); }
async function audit(actorEmployeeId, action, entityType, entityId, details = null) { const result = await db().from('hadas_audit_log').insert({ actor_employee_id: actorEmployeeId || null, action, entity_type: entityType, entity_id: entityId ? String(entityId) : null, details }); if (result.error) console.error('Audit insert failed', result.error); }

async function hashPassword(password) {
  const N = 16384, r = 8, p = 1, salt = crypto.randomBytes(16);
  const derived = await scryptAsync(String(password), salt, 32, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}
async function verifyPassword(password, encoded) {
  try {
    const [kind, n, r, p, salt64, hash64] = String(encoded || '').split('$');
    if (kind !== 'scrypt') return false;
    const expected = Buffer.from(hash64, 'base64url');
    const actual = await scryptAsync(String(password), Buffer.from(salt64, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}
function publicProfile(caller) { return { id: caller.employee.id, full_name: caller.employee.full_name, job_title: caller.employee.job_title, primary_class_id: caller.employee.primary_class_id, can_lead: caller.employee.can_lead, role: caller.user.role, phone: displayPhone(caller.user.phone), must_change_password: caller.user.must_change_password, can_view_full_schedule: canViewFullSchedule(caller), can_create_content: canCreateContent(caller) }; }

module.exports = { SESSION_COOKIE, getEnv, db, parseBody, normalizePhone, israelDateISO, displayPhone, httpError, assertDb, send, handleError, parseCookies, setSessionCookie, clearSessionCookie, randomToken, sha256, safeEqual, clientIp, verifyOrigin, createSession, getSession, requireSession, isManager, isTeacher, canViewFullSchedule, canCreateContent, activeManagerEmployeeIds, notifyEmployees, notifyManagers, safeStoragePathPart, uploadPrivateFile, createPrivateFileUrl, deletePrivateFile, revokeUserSessions, emitEvent, audit, hashPassword, verifyPassword, publicProfile };
