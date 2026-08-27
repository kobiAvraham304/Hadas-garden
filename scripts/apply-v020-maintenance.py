from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
VERSION = "0.20.0"


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, content):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"guard failed for {path}: expected 1 exact match, found {count}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


def regex_once(path, pattern, replacement, flags=re.S):
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"regex guard failed for {path}: {pattern[:120]!r}")
    write(path, updated)


# Version metadata.
replace_once("package.json", '"version": "0.19.0"', '"version": "0.20.0"')
replace_once("app.js", "/* מערכת ניהול שיבוצים מעון הדס — גרסה 0.19.0 */", "/* מערכת ניהול שיבוצים מעון הדס — גרסה 0.20.0 */")
replace_once("app.js", "state.config.version || '0.19.0'", "state.config.version || '0.20.0'")
replace_once("handlers/health.js", "update-v0.19.0.sql", "update-v0.20.0.sql")
replace_once("handlers/health.js", "meta.data.schema_version === '0.19.0'", "meta.data.schema_version === '0.20.0'")
replace_once("handlers/health.js", "databaseVersion:'0.19.0'", "databaseVersion:'0.20.0'")
replace_once("health.js", "supabase/update-v0.19.0.sql", "supabase/update-v0.20.0.sql")

# One round-trip session lookup. A guarded legacy fallback remains so rollbacks are safe.
server_session = r'''async function loadSessionContext(tokenHash) {
  const result = await db().rpc('hadas_get_session_context', { p_token_hash: tokenHash });
  if (!result.error) {
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    return row ? { session: row.session_data, user: row.user_data, employee: row.employee_data } : null;
  }
  const message = String(result.error?.message || '');
  if (!/hadas_get_session_context|PGRST202|Could not find the function/i.test(message)) {
    throw httpError(500, 'בדיקת ההתחברות נכשלה', result.error);
  }
  return undefined;
}
async function getSession(req, { optional = false } = {}) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) { if (optional) return null; throw httpError(401, 'נדרשת התחברות'); }
  const tokenHash = sha256(token);
  let context = await loadSessionContext(tokenHash);
  let session, user, employee;
  if (context === undefined) {
    session = assertDb(await db().from('hadas_sessions').select('*').eq('token_hash', tokenHash).is('revoked_at', 'null').gt('expires_at', new Date().toISOString()).maybeSingle(), 'בדיקת ההתחברות נכשלה');
    if (session) user = assertDb(await db().from('hadas_users').select('*').eq('id', session.user_id).maybeSingle(), 'המשתמש לא נמצא');
    if (user) employee = assertDb(await db().from('hadas_employees').select('*').eq('id', user.employee_id).maybeSingle(), 'כרטיס העובד לא נמצא');
  } else if (context) {
    ({ session, user, employee } = context);
  }
  if (!session) { if (optional) return null; throw httpError(401, 'ההתחברות פגה. יש להתחבר מחדש'); }
  if (!user || !user.active) throw httpError(403, 'המשתמש אינו פעיל במערכת');
  if (!employee || !employee.active) throw httpError(403, 'העובד אינו פעיל במערכת');
  if (Date.now() - Date.parse(session.last_seen_at || 0) > 5 * 60_000) db().from('hadas_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', session.id).then(() => {}).catch(() => {});
  return { session, user, employee, profile: { ...employee, role: user.role, phone: user.phone, must_change_password: user.must_change_password } };
}'''
regex_once(
    "lib/server.js",
    r"async function getSession\(req, \{ optional = false \} = \{\}\) \{.*?\n\}\n(?=async function requireSession)",
    server_session + "\n",
)

# Bootstrap endpoint: avoid manager-only queries for employees, and reuse data already loaded
# for today/current week instead of asking PostgREST for the same rows again.
replace_once(
    "handlers/data.js",
    "    const todayWeekStart = getSunday(today);\n\n    const results = await Promise.all([",
    "    const todayWeekStart = getSunday(today);\n    const todayInSelectedWeek = todayWeekStart === weekStart;\n    const dailyInSelectedWeek = getSunday(dailyDate) === weekStart;\n    const dailyUsesAttendance = dailyDate === attendanceDate;\n\n    const results = await Promise.all([",
)
replace_once("handlers/data.js", "      db().from('hadas_users').select('employee_id,phone,role,active,must_change_password,last_login_at'),", "      manager ? db().from('hadas_users').select('employee_id,phone,role,active,must_change_password,last_login_at') : Promise.resolve({ data: [], error: null }),")
replace_once("handlers/data.js", "      db().from('hadas_employee_private').select('*'),", "      manager ? db().from('hadas_employee_private').select('*') : Promise.resolve({ data: [], error: null }),")
replace_once("handlers/data.js", "      db().from('hadas_employee_class_constraints').select('*'),", "      manager ? db().from('hadas_employee_class_constraints').select('*') : Promise.resolve({ data: [], error: null }),")
replace_once("handlers/data.js", "      db().from('hadas_shifts').select('*').eq('shift_date', today).order('start_time'),", "      todayInSelectedWeek ? Promise.resolve({ data: [], error: null }) : db().from('hadas_shifts').select('*').eq('shift_date', today).order('start_time'),")
replace_once("handlers/data.js", "      todayWeekStart === weekStart ? Promise.resolve({ data: [], error: null }) : db().from('hadas_schedule_changes').select('*').eq('week_start', todayWeekStart).is('published_revision', 'null').order('created_at'),", "      todayInSelectedWeek ? Promise.resolve({ data: [], error: null }) : db().from('hadas_schedule_changes').select('*').eq('week_start', todayWeekStart).is('published_revision', 'null').order('created_at'),")
replace_once("handlers/data.js", "      manager ? db().from('hadas_shifts').select('*').eq('shift_date', dailyDate).order('start_time') : Promise.resolve({ data: [], error: null }),", "      manager && !dailyInSelectedWeek ? db().from('hadas_shifts').select('*').eq('shift_date', dailyDate).order('start_time') : Promise.resolve({ data: [], error: null }),")
replace_once("handlers/data.js", "      manager ? db().from('hadas_attendance').select('*').eq('attendance_date', dailyDate) : Promise.resolve({ data: [], error: null }),", "      manager && !dailyUsesAttendance ? db().from('hadas_attendance').select('*').eq('attendance_date', dailyDate) : Promise.resolve({ data: [], error: null }),")
replace_once("handlers/data.js", "    let todayShifts = assertDb(todayShiftsR, 'לא ניתן לטעון את שיבוץ היום') || [];", "    let todayShifts = todayInSelectedWeek ? shifts.filter((row) => row.shift_date === today) : (assertDb(todayShiftsR, 'לא ניתן לטעון את שיבוץ היום') || []);")
replace_once("handlers/data.js", "    const todayChanges = todayWeekStart === weekStart ? scheduleChanges : (assertDb(todayChangesR, 'לא ניתן לטעון שינויים') || []);", "    const todayChanges = todayInSelectedWeek ? scheduleChanges : (assertDb(todayChangesR, 'לא ניתן לטעון שינויים') || []);")
replace_once("handlers/data.js", "    const dailyShifts = assertDb(dailyShiftsR, 'לא ניתן לטעון את שיבוץ התפעול היומי') || [];", "    const dailyShifts = manager ? (dailyInSelectedWeek ? shifts.filter((row) => row.shift_date === dailyDate) : (assertDb(dailyShiftsR, 'לא ניתן לטעון את שיבוץ התפעול היומי') || [])) : [];")
replace_once("handlers/data.js", "    const dailyAttendance = assertDb(dailyAttendanceR, 'לא ניתן לטעון את נוכחות התפעול היומי') || [];", "    const dailyAttendance = manager ? (dailyUsesAttendance ? attendance : (assertDb(dailyAttendanceR, 'לא ניתן לטעון את נוכחות התפעול היומי') || [])) : [];")

# Realtime: coalesce event bursts and use lightweight active-screen refreshes.
replace_once(
    "app.js",
    "  realtimeChannel: null,\n  reloadTimer: null,\n  pollTimer: null,",
    "  realtimeChannel: null,\n  reloadTimer: null,\n  realtimeTopics: new Set(),\n  pollTimer: null,",
)
new_subscribe = r'''function subscribeRealtime() {
  if (!state.realtimeClient) return;
  if (state.realtimeChannel) state.realtimeClient.removeChannel(state.realtimeChannel);
  state.realtimeChannel = state.realtimeClient.channel('hadas-public-refresh').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hadas_realtime_events' }, (payload) => {
    const topic = String(payload?.new?.topic || 'refresh');
    state.realtimeTopics.add(topic);
    clearTimeout(state.reloadTimer);
    state.reloadTimer = setTimeout(async () => {
      const topics = new Set(state.realtimeTopics); state.realtimeTopics.clear();
      const onlyTopics = (allowed) => [...topics].every((item) => allowed.has(item));
      try {
        if (state.activeTab === 'daily' && onlyTopics(new Set(['hadas_daily_operations','hadas_attendance']))) {
          invalidateDailyCache(state.dailyDate); await loadDailyOperations(state.dailyDate, { force:true }); return;
        }
        if (state.activeTab === 'schedule' && onlyTopics(new Set(['hadas_shifts','hadas_schedule_acknowledgements','hadas_schedule_publications','hadas_schedule_changes','hadas_app_settings']))) {
          await refreshScheduleWeek({ force:true }); return;
        }
        if (state.activeTab === 'calendar' && onlyTopics(new Set(['hadas_calendar_events']))) {
          await setCalendarMonth(state.calendarMonth, { force:true }); return;
        }
        const elapsed = Date.now() - state.lastRefreshAt;
        if (elapsed < 1200) {
          clearTimeout(state.reloadTimer);
          state.reloadTimer = setTimeout(() => refreshAll().catch(() => {}), 1250 - elapsed);
          return;
        }
        await refreshAll();
      } catch {}
    }, 650);
  }).subscribe((status) => {
    if (status === 'SUBSCRIBED') setSyncState('online', 'מעודכן בזמן אמת');
    else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) setSyncState('error', 'עדכון חי נותק — קיים רענון אוטומטי');
  });
  clearInterval(state.pollTimer); state.pollTimer = setInterval(() => { if (!document.hidden && Date.now() - state.lastRefreshAt > 90000) refreshAll(); }, 120000);
}'''
regex_once("app.js", r"function subscribeRealtime\(\) \{.*?\n\}\n\n(?=function employeePickerHtml)", new_subscribe + "\n\n")

# UI/accessibility: preserve the existing design while improving keyboard focus and layout containment.
css_addition = r'''

/* ========================================================================== 
   גרסה 0.20.0 — נגישות, יציבות פריסה וביצועי ציור
   ========================================================================== */
:where(button,[role="button"],summary,a,.calendar-day.selectable):focus-visible{
  outline:3px solid rgba(80,109,93,.42);outline-offset:3px;
}
.panel.active .dashboard-section,.panel.active .cards-list,.panel.active .employee-card-grid{
  content-visibility:auto;contain-intrinsic-size:1px 520px;
}
.actions-wrap>*,.toolbar>*,.schedule-actions>*,.card-actions>*{min-width:0}
button,.nav-btn,.filter-chip,.request-type-card{touch-action:manipulation}
@media(max-width:760px){
  .page-container{padding-inline:max(9px,env(safe-area-inset-left)) max(9px,env(safe-area-inset-right))}
  .section-heading,.schedule-command-bar,.polished-filter,.employee-filter{min-width:0;max-width:100%}
  .section-heading p,.notice,.empty-state,.card-actions,.modal-card{overflow-wrap:anywhere}
  .schedule-actions button,.toolbar button,.card-actions button{white-space:normal;line-height:1.2}
}
@media(prefers-reduced-motion:reduce){
  html{scroll-behavior:auto!important}
  *,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
}
'''
css = read("styles.css")
if "גרסה 0.20.0 — נגישות" in css:
    raise SystemExit("styles.css already contains v0.20 block")
write("styles.css", css.rstrip() + css_addition + "\n")

# Database clean schema: align fresh installs with upgraded production and add hardening.
schema = read("supabase/schema.sql").replace("גרסה 0.19.0 (סכמת נתונים 0.19.0)", "גרסה 0.20.0 (סכמת נתונים 0.20.0)")
schema = schema.replace("values (1, '0.19.0', '0.19.0')", "values (1, '0.20.0', '0.20.0')")
old_pattern_check = """    (day_type='day_off' and start_time is null and end_time is null)\n    or\n    (day_type in ('work','as_needed','avoid') and start_time is not null and end_time is not null and end_time > start_time)"""
new_pattern_check = """    (day_type in ('day_off','as_needed') and start_time is null and end_time is null)\n    or\n    (day_type in ('work','avoid') and start_time is not null and end_time is not null and end_time > start_time)"""
if schema.count(old_pattern_check) != 1:
    raise SystemExit("schema weekly-pattern guard failed")
schema = schema.replace(old_pattern_check, new_pattern_check, 1)
if "DROP FUNCTION IF EXISTS public.hadas_get_session_context(text) CASCADE;" not in schema:
    schema = schema.replace("DROP FUNCTION IF EXISTS public.hadas_apply_approved_request(uuid,uuid) CASCADE;", "DROP FUNCTION IF EXISTS public.hadas_get_session_context(text) CASCADE;\nDROP FUNCTION IF EXISTS public.hadas_apply_approved_request(uuid,uuid) CASCADE;", 1)

schema_hardening = r'''

-- גרסה 0.20.0 — אינדקסים למפתחות זרים, הקטנת round-trips בהתחברות ומדיניות server-only מפורשת.
create index if not exists hadas_employees_primary_class_fk_idx on public.hadas_employees(primary_class_id);
create index if not exists hadas_shifts_created_by_fk_idx on public.hadas_shifts(created_by);
create index if not exists hadas_attendance_employee_fk_idx on public.hadas_attendance(employee_id);
create index if not exists hadas_attendance_updated_by_fk_idx on public.hadas_attendance(updated_by);
create index if not exists hadas_requests_requester_fk_idx on public.hadas_requests(requester_id);
create index if not exists hadas_requests_shift_fk_idx on public.hadas_requests(shift_id);
create index if not exists hadas_requests_target_employee_fk_idx on public.hadas_requests(target_employee_id);
create index if not exists hadas_requests_target_shift_fk_idx on public.hadas_requests(target_shift_id);
create index if not exists hadas_requests_decided_by_fk_idx on public.hadas_requests(decided_by);
create index if not exists hadas_announcements_class_fk_idx on public.hadas_announcements(class_id);
create index if not exists hadas_announcements_created_by_fk_idx on public.hadas_announcements(created_by);
create index if not exists hadas_announcement_reads_employee_fk_idx on public.hadas_announcement_reads(employee_id);
create index if not exists hadas_tasks_created_by_fk_idx on public.hadas_tasks(created_by);
create index if not exists hadas_task_assignees_employee_fk_idx on public.hadas_task_assignees(employee_id);
create index if not exists hadas_calendar_events_class_fk_idx on public.hadas_calendar_events(class_id);
create index if not exists hadas_calendar_events_created_by_fk_idx on public.hadas_calendar_events(created_by);
create index if not exists hadas_constraints_class_fk_idx on public.hadas_employee_class_constraints(class_id);
create index if not exists hadas_constraints_created_by_fk_idx on public.hadas_employee_class_constraints(created_by);
create index if not exists hadas_daily_operations_class_fk_idx on public.hadas_daily_operations(class_id);
create index if not exists hadas_daily_operations_replacement_employee_fk_idx on public.hadas_daily_operations(replacement_employee_id);
create index if not exists hadas_daily_operations_replacement_class_fk_idx on public.hadas_daily_operations(replacement_from_class_id);
create index if not exists hadas_daily_operations_created_by_fk_idx on public.hadas_daily_operations(created_by);
create index if not exists hadas_daily_operations_resolved_by_fk_idx on public.hadas_daily_operations(resolved_by);
create index if not exists hadas_schedule_changes_created_by_fk_idx on public.hadas_schedule_changes(created_by);
create index if not exists hadas_schedule_publications_published_by_fk_idx on public.hadas_schedule_publications(published_by);
create index if not exists hadas_audit_log_actor_fk_idx on public.hadas_audit_log(actor_employee_id);

create or replace function public.hadas_get_session_context(p_token_hash text)
returns table(session_data jsonb, user_data jsonb, employee_data jsonb)
language sql
security definer
set search_path=pg_catalog,public
as $$
  select to_jsonb(s), to_jsonb(u), to_jsonb(e)
  from public.hadas_sessions s
  join public.hadas_users u on u.id=s.user_id and u.active
  join public.hadas_employees e on e.id=u.employee_id and e.active
  where s.token_hash=p_token_hash and s.revoked_at is null and s.expires_at>now()
  limit 1
$$;
revoke all on function public.hadas_get_session_context(text) from public, anon, authenticated;
grant execute on function public.hadas_get_session_context(text) to service_role;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'hadas_app_meta','hadas_classes','hadas_employees','hadas_users','hadas_sessions','hadas_login_security',
    'hadas_employee_weekly_patterns','hadas_employee_class_constraints','hadas_employee_private','hadas_shifts',
    'hadas_schedule_publications','hadas_schedule_changes','hadas_attendance','hadas_daily_operations','hadas_requests',
    'hadas_notifications','hadas_announcements','hadas_announcement_reads','hadas_announcement_recipients','hadas_tasks',
    'hadas_task_assignees','hadas_calendar_events','hadas_documents','hadas_audit_log','hadas_app_settings','hadas_feedback'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS hadas_server_only_deny ON public.%I',t);
    EXECUTE format('CREATE POLICY hadas_server_only_deny ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',t);
  END LOOP;
END $$;
'''
if "hadas_get_session_context(p_token_hash" in schema:
    raise SystemExit("schema already contains v0.20 hardening")
write("supabase/schema.sql", schema.rstrip() + schema_hardening + "\n")

migration = r'''-- מערכת ניהול שיבוצים מעון הדס — עדכון לגרסה 0.20.0
-- תחזוקה לא הרסנית: אינדקסים, session RPC, יישור אילוצים ומדיניות server-only מפורשת.

create index if not exists hadas_employees_primary_class_fk_idx on public.hadas_employees(primary_class_id);
create index if not exists hadas_shifts_created_by_fk_idx on public.hadas_shifts(created_by);
create index if not exists hadas_attendance_employee_fk_idx on public.hadas_attendance(employee_id);
create index if not exists hadas_attendance_updated_by_fk_idx on public.hadas_attendance(updated_by);
create index if not exists hadas_requests_requester_fk_idx on public.hadas_requests(requester_id);
create index if not exists hadas_requests_shift_fk_idx on public.hadas_requests(shift_id);
create index if not exists hadas_requests_target_employee_fk_idx on public.hadas_requests(target_employee_id);
create index if not exists hadas_requests_target_shift_fk_idx on public.hadas_requests(target_shift_id);
create index if not exists hadas_requests_decided_by_fk_idx on public.hadas_requests(decided_by);
create index if not exists hadas_announcements_class_fk_idx on public.hadas_announcements(class_id);
create index if not exists hadas_announcements_created_by_fk_idx on public.hadas_announcements(created_by);
create index if not exists hadas_announcement_reads_employee_fk_idx on public.hadas_announcement_reads(employee_id);
create index if not exists hadas_tasks_created_by_fk_idx on public.hadas_tasks(created_by);
create index if not exists hadas_task_assignees_employee_fk_idx on public.hadas_task_assignees(employee_id);
create index if not exists hadas_calendar_events_class_fk_idx on public.hadas_calendar_events(class_id);
create index if not exists hadas_calendar_events_created_by_fk_idx on public.hadas_calendar_events(created_by);
create index if not exists hadas_constraints_class_fk_idx on public.hadas_employee_class_constraints(class_id);
create index if not exists hadas_constraints_created_by_fk_idx on public.hadas_employee_class_constraints(created_by);
create index if not exists hadas_daily_operations_class_fk_idx on public.hadas_daily_operations(class_id);
create index if not exists hadas_daily_operations_replacement_employee_fk_idx on public.hadas_daily_operations(replacement_employee_id);
create index if not exists hadas_daily_operations_replacement_class_fk_idx on public.hadas_daily_operations(replacement_from_class_id);
create index if not exists hadas_daily_operations_created_by_fk_idx on public.hadas_daily_operations(created_by);
create index if not exists hadas_daily_operations_resolved_by_fk_idx on public.hadas_daily_operations(resolved_by);
create index if not exists hadas_schedule_changes_created_by_fk_idx on public.hadas_schedule_changes(created_by);
create index if not exists hadas_schedule_publications_published_by_fk_idx on public.hadas_schedule_publications(published_by);
create index if not exists hadas_audit_log_actor_fk_idx on public.hadas_audit_log(actor_employee_id);

alter table public.hadas_employee_weekly_patterns drop constraint if exists hadas_employee_weekly_patterns_times_check;
alter table public.hadas_employee_weekly_patterns add constraint hadas_employee_weekly_patterns_times_check check (
  (day_type in ('day_off','as_needed') and start_time is null and end_time is null)
  or
  (day_type in ('work','avoid') and start_time is not null and end_time is not null and end_time > start_time)
);

alter table public.hadas_requests drop constraint if exists hadas_requests_request_type_check;
alter table public.hadas_requests add constraint hadas_requests_request_type_check
  check (request_type in ('leave','day_off','late_start','early_finish','sick','swap')) not valid;
DO $$ BEGIN
  IF NOT EXISTS (select 1 from public.hadas_requests where request_type='other') THEN
    ALTER TABLE public.hadas_requests VALIDATE CONSTRAINT hadas_requests_request_type_check;
  END IF;
END $$;

create or replace function public.hadas_get_session_context(p_token_hash text)
returns table(session_data jsonb, user_data jsonb, employee_data jsonb)
language sql
security definer
set search_path=pg_catalog,public
as $$
  select to_jsonb(s), to_jsonb(u), to_jsonb(e)
  from public.hadas_sessions s
  join public.hadas_users u on u.id=s.user_id and u.active
  join public.hadas_employees e on e.id=u.employee_id and e.active
  where s.token_hash=p_token_hash and s.revoked_at is null and s.expires_at>now()
  limit 1
$$;
revoke all on function public.hadas_get_session_context(text) from public, anon, authenticated;
grant execute on function public.hadas_get_session_context(text) to service_role;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'hadas_app_meta','hadas_classes','hadas_employees','hadas_users','hadas_sessions','hadas_login_security',
    'hadas_employee_weekly_patterns','hadas_employee_class_constraints','hadas_employee_private','hadas_shifts',
    'hadas_schedule_publications','hadas_schedule_changes','hadas_attendance','hadas_daily_operations','hadas_requests',
    'hadas_notifications','hadas_announcements','hadas_announcement_reads','hadas_announcement_recipients','hadas_tasks',
    'hadas_task_assignees','hadas_calendar_events','hadas_documents','hadas_audit_log','hadas_app_settings','hadas_feedback'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS hadas_server_only_deny ON public.%I',t);
    EXECUTE format('CREATE POLICY hadas_server_only_deny ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',t);
  END LOOP;
END $$;

insert into public.hadas_app_meta(id,schema_version,app_version,updated_at)
values (1,'0.20.0','0.20.0',now())
on conflict (id) do update set schema_version=excluded.schema_version,app_version=excluded.app_version,updated_at=now();
'''
write("supabase/update-v0.20.0.sql", migration)

# Current-version tests/doc references.
replace_once("tests/static.test.js", "assert.equal(pkg.version,'0.19.0')", "assert.equal(pkg.version,'0.20.0')")
replace_once("tests/static.test.js", "assert.match(schema,/'0\\.19\\.0'/);", "assert.match(schema,/'0\\.20\\.0'/);")
replace_once("tests/static.test.js", "update-v0\\.19\\.0\\.sql", "update-v0\\.20\\.0\\.sql")
replace_once("tests/v019.test.js", "  assert.match(schema,/'0\\.19\\.0'/); assert.match(schema,/hadas_feedback/);", "  assert.match(schema,/hadas_feedback/);")

v020_test = r'''const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('0.20 version metadata and health checks are aligned',()=>{
  assert.equal(JSON.parse(read('package.json')).version,'0.20.0');
  assert.match(read('handlers/health.js'),/schema_version === '0\.20\.0'/);
  assert.match(read('health.js'),/update-v0\.20\.0\.sql/);
  assert.match(read('supabase/schema.sql'),/'0\.20\.0'/);
});

test('0.20 session validation uses one service-only RPC with guarded fallback',()=>{
  const server=read('lib/server.js'); const schema=read('supabase/schema.sql'); const migration=read('supabase/update-v0.20.0.sql');
  assert.match(server,/db\(\)\.rpc\('hadas_get_session_context'/);
  assert.match(server,/PGRST202/); assert.match(server,/tokenHash = sha256\(token\)/);
  for(const sql of [schema,migration]){
    assert.match(sql,/create or replace function public\.hadas_get_session_context/);
    assert.match(sql,/security definer/); assert.match(sql,/set search_path=pg_catalog,public/);
    assert.match(sql,/revoke all on function public\.hadas_get_session_context\(text\) from public, anon, authenticated/);
  }
});

test('0.20 bootstrap avoids redundant manager-only and duplicate date queries',()=>{
  const data=read('handlers/data.js');
  assert.match(data,/manager \? db\(\)\.from\('hadas_users'\)/);
  assert.match(data,/manager \? db\(\)\.from\('hadas_employee_private'\)/);
  assert.match(data,/manager \? db\(\)\.from\('hadas_employee_class_constraints'\)/);
  assert.match(data,/todayInSelectedWeek \? Promise\.resolve/);
  assert.match(data,/dailyInSelectedWeek \? shifts\.filter/);
  assert.match(data,/dailyUsesAttendance \? attendance/);
});

test('0.20 realtime refreshes are coalesced instead of full reload per event',()=>{
  const app=read('app.js');
  assert.match(app,/realtimeTopics: new Set\(\)/);
  assert.match(app,/state\.realtimeTopics\.add\(topic\)/);
  assert.match(app,/\}, 650\);/);
  assert.match(app,/elapsed < 1200/);
  assert.match(app,/onlyTopics/);
});

test('0.20 fresh schema accepts as-needed days without fake times',()=>{
  const schema=read('supabase/schema.sql');
  assert.match(schema,/day_type in \('day_off','as_needed'\) and start_time is null and end_time is null/);
  assert.match(schema,/day_type in \('work','avoid'\) and start_time is not null/);
  assert.doesNotMatch(schema,/day_type in \('work','as_needed','avoid'\) and start_time is not null/);
});

test('0.20 database hardening covers foreign keys, request types and explicit server-only policies',()=>{
  const migration=read('supabase/update-v0.20.0.sql');
  for(const token of ['hadas_requests_requester_fk_idx','hadas_attendance_employee_fk_idx','hadas_announcements_class_fk_idx','hadas_daily_operations_class_fk_idx','hadas_task_assignees_employee_fk_idx']) assert.match(migration,new RegExp(token));
  assert.match(migration,/request_type in \('leave','day_off','late_start','early_finish','sick','swap'\)/);
  assert.match(migration,/CREATE POLICY hadas_server_only_deny/);
  assert.doesNotMatch(migration,/drop table/i);
});

test('0.20 UI adds keyboard focus, touch containment and reduced-motion safeguards',()=>{
  const css=read('styles.css');
  assert.match(css,/:focus-visible/); assert.match(css,/touch-action:manipulation/);
  assert.match(css,/content-visibility:auto/); assert.match(css,/env\(safe-area-inset-left\)/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});

test('repository ignores platform junk and has permanent QA workflow',()=>{
  assert.match(read('.gitignore'),/\.DS_Store/);
  const workflow=read('.github/workflows/qa.yml');
  assert.match(workflow,/npm test/); assert.match(workflow,/npm run check/); assert.match(workflow,/node --check/);
});
'''
write("tests/v020.test.js", v020_test)

# Documentation and repository hygiene.
for path in ["README.md","QA-REPORT.md","DEPLOY-VERCEL.md"]:
    if (ROOT / path).exists():
        text=read(path).replace("0.19.0","0.20.0")
        write(path,text)
write("VERSION.md", """# מערכת ניהול שיבוצים מעון הדס — גרסה 0.20.0\n\n## איכות, יציבות ומהירות\n- אימות session מאוחד ל־RPC אחד במקום שלוש פניות סדרתיות ל־Supabase, עם fallback בטוח.\n- טעינת bootstrap חוסכת שאילתות כפולות לשיבוץ/נוכחות ומדלגת על מידע ניהולי שאינו נחוץ לעובדים.\n- אירועי Realtime מתאחדים לגל רענון אחד ומשתמשים ברענון ממוקד למסך הפעיל.\n- נוספו אינדקסים חסרים למפתחות זרים מרכזיים.\n\n## בסיס נתונים ואבטחה\n- מדיניות server-only מפורשת לכל טבלאות המידע העסקי.\n- יישור אילוץ סוגי הבקשות כך ש־`other` הישן אינו מתקבל יותר בבקשות חדשות.\n- תיקון סכמת התקנה נקייה ליום `as_needed` ללא שעות מלאכותיות.\n- מטא־דאטה וסכמת הייצור עודכנו ל־0.20.0.\n\n## ממשק ונגישות\n- טבעת focus ברורה לניווט מקלדת.\n- שיפור containment וציור של אזורים ארוכים.\n- שיפור מניעת גלישות במסכים צרים ו־safe-area במכשירי iPhone.\n- כיבוד מלא יותר של `prefers-reduced-motion`.\n\n## תחזוקת קוד\n- נוספה בדיקת QA קבועה ב־GitHub Actions לכל PR ו־push ל־main.\n- קבצי `.DS_Store` נחסמים ומוסרים מה־repository.\n""")
write(".gitignore", ".DS_Store\nnode_modules/\n.env\n.env.*\n!.env.example\n")
(ROOT / ".DS_Store").unlink(missing_ok=True)

qa_workflow = r'''name: QA

on:
  pull_request:
  push:
    branches: [main, 'agent/**']

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Test
        run: npm test
      - name: Security and consistency check
        run: npm run check
      - name: Syntax check
        run: |
          node --check app.js
          node --check api/index.js
          node --check lib/server.js
          node --check lib/schedule.js
          node --check lib/matching.js
          node --check lib/auto-schedule.js
          for file in handlers/*.js; do node --check "$file"; done
'''
write(".github/workflows/qa.yml", qa_workflow)

print("v0.20.0 guarded maintenance patch applied")
