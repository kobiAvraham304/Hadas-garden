-- מערכת ניהול שיבוצים מעון הדס — גרסה 0.21.0
-- יישור כללי זמינות, חריגה ידנית מפורשת וניקוי מצב משימות ישן. ללא מחיקת שיבוצים או עובדים.

alter table public.hadas_shifts add column if not exists rule_override boolean not null default false;
alter table public.hadas_shifts add column if not exists rule_override_note text;

-- `avoid` הישן מתאחד עם "לפי צורך"; אין יותר מצב רביעי מבלבל.
update public.hadas_employee_weekly_patterns set day_type='as_needed',start_time=null,end_time=null where day_type='avoid';

-- יום שלא הוגדר בעבר נחשב מעתה יום חופשי בטוח. כך אין זמינות משתמעת.
insert into public.hadas_employee_weekly_patterns(employee_id,weekday,day_type,start_time,end_time)
select e.id,d.weekday,'day_off',null,null
from public.hadas_employees e cross join generate_series(0,5) as d(weekday)
where e.active and e.is_schedulable and e.assignment_mode<>'no_schedule'
on conflict (employee_id,weekday) do nothing;

alter table public.hadas_employee_weekly_patterns drop constraint if exists hadas_employee_weekly_patterns_day_type_check;
alter table public.hadas_employee_weekly_patterns add constraint hadas_employee_weekly_patterns_day_type_check check (day_type in ('work','day_off','as_needed'));
alter table public.hadas_employee_weekly_patterns drop constraint if exists hadas_employee_weekly_patterns_times_check;
alter table public.hadas_employee_weekly_patterns add constraint hadas_employee_weekly_patterns_times_check check (
  (day_type in ('day_off','as_needed') and start_time is null and end_time is null)
  or (day_type='work' and start_time is not null and end_time is not null and end_time>start_time)
);

-- שיוכים של משימות שכבר הוסרו אינם אמורים להדליק badge.
delete from public.hadas_task_assignees a using public.hadas_tasks t where a.task_id=t.id and t.active=false;
update public.hadas_notifications n set action_required=false,read_at=coalesce(read_at,now())
where n.entity_type='task' and exists(select 1 from public.hadas_tasks t where t.id::text=n.entity_id and t.active=false);

insert into public.hadas_app_meta(id,schema_version,app_version,updated_at)
values(1,'0.21.0','0.21.0',now())
on conflict(id) do update set schema_version=excluded.schema_version,app_version=excluded.app_version,updated_at=now();
