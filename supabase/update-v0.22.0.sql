-- מערכת ניהול שיבוצים מעון הדס — גרסה 0.22.0
-- עדיפות כיתות מדורגת, מגבלת ימי עבודה למשלימי מקום ושדרוגי שיבוץ. ללא מחיקת שיבוצים או עובדים.

alter table public.hadas_employees
  add column if not exists max_work_days_per_week smallint;

alter table public.hadas_employees
  drop constraint if exists hadas_employees_max_work_days_per_week_check;
alter table public.hadas_employees
  add constraint hadas_employees_max_work_days_per_week_check
  check (max_work_days_per_week is null or max_work_days_per_week between 1 and 6);

alter table public.hadas_employee_class_constraints
  add column if not exists priority_rank smallint;

alter table public.hadas_employee_class_constraints
  drop constraint if exists hadas_employee_class_constraints_priority_rank_check;
alter table public.hadas_employee_class_constraints
  add constraint hadas_employee_class_constraints_priority_rank_check
  check (priority_rank is null or priority_rank between 1 and 20);

-- העדפות ישנות מקבלות דרגה רק אם לא הוגדרה להן דרגה. אין שינוי באיסורים קיימים.
with ranked as (
  select id,
         row_number() over (partition by employee_id order by created_at, id) + 1 as rn
  from public.hadas_employee_class_constraints
  where constraint_type='preferred' and priority_rank is null
)
update public.hadas_employee_class_constraints c
set priority_rank = least(20, ranked.rn::smallint)
from ranked
where c.id=ranked.id;

update public.hadas_employee_class_constraints
set priority_rank=null
where constraint_type in ('avoid','forbidden');

insert into public.hadas_app_meta(id,schema_version,app_version,updated_at)
values(1,'0.22.0','0.22.0',now())
on conflict(id) do update
set schema_version=excluded.schema_version,app_version=excluded.app_version,updated_at=now();
