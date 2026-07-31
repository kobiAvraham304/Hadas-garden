-- מערכת ניהול שיבוצים מעון הדס — עדכון מגרסה 0.4.1/0.4.3 לגרסה 0.5.0
-- עדכון שאינו מוחק עובדות, שיבוצים, בקשות, הודעות או משימות קיימות.

begin;

-- שיבוץ: טיוטה או פורסם בלבד.
alter table public.hadas_shifts drop constraint if exists hadas_shifts_status_check;
update public.hadas_shifts set status='published' where status in ('temporary','final');
update public.hadas_shifts set status='draft' where status not in ('draft','published');
alter table public.hadas_shifts add constraint hadas_shifts_status_check check (status in ('draft','published'));

-- מעקב פרסומים ושינויים לצורך הצגת מה עומד להתפרסם.
create table if not exists public.hadas_schedule_publications (
  week_start date primary key,
  revision integer not null default 0,
  published_at timestamptz,
  published_by uuid references public.hadas_employees(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.hadas_schedule_changes (
  id bigserial primary key,
  week_start date not null,
  shift_id uuid,
  change_type text not null check (change_type in ('create','update','delete','copy')),
  before_data jsonb,
  after_data jsonb,
  created_by uuid references public.hadas_employees(id) on delete set null,
  published_revision integer,
  created_at timestamptz not null default now()
);
create index if not exists hadas_schedule_changes_week_idx on public.hadas_schedule_changes(week_start, published_revision, created_at);

-- הזרמת בקשות לשיבוץ בתוך עסקה אחת, כולל תיעוד שינויים לפרסום.
create or replace function public.hadas_apply_approved_request(p_request_id uuid, p_actor_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  r public.hadas_requests%rowtype;
  first_shift public.hadas_shifts%rowtype;
  second_shift public.hadas_shifts%rowtype;
  first_after public.hadas_shifts%rowtype;
  second_after public.hadas_shifts%rowtype;
  affected_shift public.hadas_shifts%rowtype;
  first_week_start date;
  second_week_start date;
begin
  select * into r from public.hadas_requests where id=p_request_id for update;
  if not found then raise exception 'הבקשה לא נמצאה'; end if;
  if r.status <> 'approved' then raise exception 'יש לאשר את הבקשה לפני הזרמתה'; end if;

  if r.request_type in ('leave','day_off','sick') then
    for affected_shift in
      select * from public.hadas_shifts
      where employee_id=r.requester_id and shift_date=r.request_date
      for update
    loop
      insert into public.hadas_schedule_changes(
        week_start, shift_id, change_type, before_data, after_data, created_by
      ) values (
        affected_shift.shift_date - extract(dow from affected_shift.shift_date)::integer,
        affected_shift.id,
        'delete',
        to_jsonb(affected_shift),
        null,
        p_actor_id
      );
      delete from public.hadas_shifts where id=affected_shift.id;
    end loop;

  elsif r.request_type in ('late_start','early_finish') then
    if r.shift_id is null then raise exception 'לא נבחר שיבוץ לעדכון'; end if;
    select * into first_shift from public.hadas_shifts where id=r.shift_id for update;
    if not found or first_shift.employee_id <> r.requester_id then
      raise exception 'השיבוץ השתנה או נמחק מאז הגשת הבקשה';
    end if;

    if r.request_type='late_start' then
      if r.requested_start is null or r.requested_start <= first_shift.start_time or r.requested_start >= first_shift.end_time then
        raise exception 'שעת ההתחלה המבוקשת אינה מתאימה עוד לשיבוץ';
      end if;
      update public.hadas_shifts
      set start_time=r.requested_start, status='draft'
      where id=first_shift.id
      returning * into first_after;
    else
      if r.requested_end is null or r.requested_end >= first_shift.end_time or r.requested_end <= first_shift.start_time then
        raise exception 'שעת הסיום המבוקשת אינה מתאימה עוד לשיבוץ';
      end if;
      update public.hadas_shifts
      set end_time=r.requested_end, status='draft'
      where id=first_shift.id
      returning * into first_after;
    end if;

    insert into public.hadas_schedule_changes(
      week_start, shift_id, change_type, before_data, after_data, created_by
    ) values (
      first_shift.shift_date - extract(dow from first_shift.shift_date)::integer,
      first_shift.id,
      'update',
      to_jsonb(first_shift),
      to_jsonb(first_after),
      p_actor_id
    );

  elsif r.request_type='swap' then
    if r.target_approved is not true then raise exception 'העובדת השנייה עדיין לא אישרה את ההחלפה'; end if;
    if r.shift_id is null or r.target_shift_id is null or r.shift_id=r.target_shift_id then
      raise exception 'פרטי ההחלפה אינם תקינים';
    end if;

    select * into first_shift from public.hadas_shifts where id=r.shift_id for update;
    select * into second_shift from public.hadas_shifts where id=r.target_shift_id for update;
    if first_shift.id is null or second_shift.id is null then raise exception 'אחד השיבוצים אינו קיים'; end if;
    if first_shift.employee_id <> r.requester_id or second_shift.employee_id <> r.target_employee_id then
      raise exception 'השיבוצים השתנו מאז שליחת הבקשה';
    end if;
    if not exists(select 1 from public.hadas_employees where id=first_shift.employee_id and active=true)
       or not exists(select 1 from public.hadas_employees where id=second_shift.employee_id and active=true) then
      raise exception 'אחת העובדות אינה פעילה';
    end if;
    if exists (
      select 1 from public.hadas_employee_class_constraints c
      where c.employee_id=second_shift.employee_id and c.class_id=first_shift.class_id
        and c.constraint_type='forbidden'
        and (c.valid_from is null or c.valid_from <= first_shift.shift_date)
        and (c.valid_to is null or c.valid_to >= first_shift.shift_date)
    ) or exists (
      select 1 from public.hadas_employee_class_constraints c
      where c.employee_id=first_shift.employee_id and c.class_id=second_shift.class_id
        and c.constraint_type='forbidden'
        and (c.valid_from is null or c.valid_from <= second_shift.shift_date)
        and (c.valid_to is null or c.valid_to >= second_shift.shift_date)
    ) then
      raise exception 'ההחלפה מפרה אילוץ כיתה של אחת העובדות';
    end if;
    if exists (
      select 1 from public.hadas_shifts s
      where s.employee_id=second_shift.employee_id and s.shift_date=first_shift.shift_date
        and s.id not in(first_shift.id,second_shift.id)
        and first_shift.start_time < s.end_time and first_shift.end_time > s.start_time
    ) or exists (
      select 1 from public.hadas_shifts s
      where s.employee_id=first_shift.employee_id and s.shift_date=second_shift.shift_date
        and s.id not in(first_shift.id,second_shift.id)
        and second_shift.start_time < s.end_time and second_shift.end_time > s.start_time
    ) then
      raise exception 'ההחלפה יוצרת חפיפה בשיבוץ';
    end if;

    perform set_config('app.swap_mode','on',true);
    update public.hadas_shifts
    set employee_id = case
          when id=first_shift.id then second_shift.employee_id
          when id=second_shift.id then first_shift.employee_id
          else employee_id
        end,
        status='draft'
    where id in(first_shift.id,second_shift.id);

    select * into first_after from public.hadas_shifts where id=first_shift.id;
    select * into second_after from public.hadas_shifts where id=second_shift.id;
    first_week_start := first_shift.shift_date - extract(dow from first_shift.shift_date)::integer;
    second_week_start := second_shift.shift_date - extract(dow from second_shift.shift_date)::integer;

    insert into public.hadas_schedule_changes(
      week_start, shift_id, change_type, before_data, after_data, created_by
    ) values
      (first_week_start, first_shift.id, 'update', to_jsonb(first_shift), to_jsonb(first_after), p_actor_id),
      (second_week_start, second_shift.id, 'update', to_jsonb(second_shift), to_jsonb(second_after), p_actor_id);

  elsif r.request_type <> 'other' then
    raise exception 'סוג הבקשה אינו נתמך להזרמה';
  end if;

  update public.hadas_requests
  set status='applied', decided_by=p_actor_id, decided_at=now(), updated_at=now()
  where id=p_request_id;
end;
$$;
revoke all on function public.hadas_apply_approved_request(uuid,uuid) from public, anon, authenticated;
grant execute on function public.hadas_apply_approved_request(uuid,uuid) to service_role;

-- תאימות לאחור לגרסאות קוד ישנות שעדיין קוראות לפונקציית ההחלפה הייעודית.
create or replace function public.hadas_apply_shift_swap(p_request_id uuid, p_actor_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.hadas_apply_approved_request(p_request_id,p_actor_id);
end;
$$;
revoke all on function public.hadas_apply_shift_swap(uuid,uuid) from public, anon, authenticated;
grant execute on function public.hadas_apply_shift_swap(uuid,uuid) to service_role;


-- הודעות לקהל מדויק: כל המעון, כיתה או עובדות נבחרות.
alter table public.hadas_announcements add column if not exists audience_type text not null default 'all';
update public.hadas_announcements set audience_type=case when class_id is null then 'all' else 'class' end where audience_type is null or audience_type='all';
alter table public.hadas_announcements drop constraint if exists hadas_announcements_audience_type_check;
alter table public.hadas_announcements add constraint hadas_announcements_audience_type_check check (audience_type in ('all','class','employees'));

create table if not exists public.hadas_announcement_recipients (
  announcement_id uuid not null references public.hadas_announcements(id) on delete cascade,
  employee_id uuid not null references public.hadas_employees(id) on delete cascade,
  primary key (announcement_id, employee_id)
);
create index if not exists hadas_announcement_recipients_employee_idx on public.hadas_announcement_recipients(employee_id);

-- משימות לעובדות נבחרות.
alter table public.hadas_tasks drop constraint if exists hadas_tasks_target_type_check;
alter table public.hadas_tasks add constraint hadas_tasks_target_type_check check (target_type in ('all','class','employee','employees'));

-- עדכון גרסת הסכמה.
update public.hadas_app_meta set schema_version='0.5.0', app_version='0.5.0', updated_at=now() where id=1;

-- updated_at לטבלת הפרסומים.
drop trigger if exists hadas_schedule_publications_updated_at on public.hadas_schedule_publications;
create trigger hadas_schedule_publications_updated_at before update on public.hadas_schedule_publications
for each row execute function public.hadas_set_updated_at();

-- אותות Realtime לטבלאות החדשות.
drop trigger if exists hadas_schedule_publications_realtime on public.hadas_schedule_publications;
create trigger hadas_schedule_publications_realtime after insert or update or delete on public.hadas_schedule_publications
for each row execute function public.hadas_emit_realtime_event();
drop trigger if exists hadas_schedule_changes_realtime on public.hadas_schedule_changes;
create trigger hadas_schedule_changes_realtime after insert or update or delete on public.hadas_schedule_changes
for each row execute function public.hadas_emit_realtime_event();
drop trigger if exists hadas_announcement_recipients_realtime on public.hadas_announcement_recipients;
create trigger hadas_announcement_recipients_realtime after insert or update or delete on public.hadas_announcement_recipients
for each row execute function public.hadas_emit_realtime_event();

-- הטבלאות העסקיות נגישות רק לשרת Vercel.
alter table public.hadas_schedule_publications enable row level security;
alter table public.hadas_schedule_changes enable row level security;
alter table public.hadas_announcement_recipients enable row level security;
revoke all on table public.hadas_schedule_publications, public.hadas_schedule_changes, public.hadas_announcement_recipients from anon, authenticated;
grant all on table public.hadas_schedule_publications, public.hadas_schedule_changes, public.hadas_announcement_recipients to service_role;
grant all on sequence public.hadas_schedule_changes_id_seq to service_role;

commit;
