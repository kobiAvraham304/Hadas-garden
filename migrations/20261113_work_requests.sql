-- Hadas v0.40.13 – requests to work on a regular day off.
-- Transactional approval: insert shift and mark request as applied together.
ALTER TABLE public.hadas_requests DROP CONSTRAINT IF EXISTS hadas_requests_request_type_check;
ALTER TABLE public.hadas_requests ADD CONSTRAINT hadas_requests_request_type_check
CHECK (request_type = ANY (ARRAY['leave','day_off','late_start','early_finish','sick','swap','work']::text[]));

CREATE OR REPLACE FUNCTION public.hadas_approve_work_request(
  p_request_id uuid,p_actor_id uuid,p_class_id uuid,
  p_start_time time without time zone,p_end_time time without time zone,
  p_manager_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public,pg_temp
AS $$
DECLARE
  v_request public.hadas_requests%ROWTYPE;
  v_employee public.hadas_employees%ROWTYPE;
  v_class public.hadas_classes%ROWTYPE;
  v_settings public.hadas_app_settings%ROWTYPE;
  v_pattern public.hadas_employee_weekly_patterns%ROWTYPE;
  v_shift public.hadas_shifts%ROWTYPE;
  v_weekday integer;
  v_week_start date;
  v_closing time without time zone;
  v_role text;
  v_days integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.hadas_users
    WHERE employee_id=p_actor_id AND role IN ('admin','scheduler') AND active=true
  ) THEN RAISE EXCEPTION 'רק הנהלת המעון רשאית לאשר שיבוץ' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_request FROM public.hadas_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.request_type <> 'work' THEN
    RAISE EXCEPTION 'הבקשה לעבוד לא נמצאה' USING ERRCODE='P0002';
  END IF;
  IF v_request.status='applied' AND v_request.shift_id IS NOT NULL THEN
    RETURN v_request.shift_id;
  END IF;
  IF v_request.status<>'pending' THEN
    RAISE EXCEPTION 'הבקשה כבר טופלה ולא ניתן לשבץ מחדש';
  END IF;
  IF v_request.request_date < (now() AT TIME ZONE 'Asia/Jerusalem')::date THEN
    RAISE EXCEPTION 'לא ניתן לשבץ בקשה לתאריך שעבר';
  END IF;

  SELECT * INTO v_employee FROM public.hadas_employees WHERE id=v_request.requester_id FOR UPDATE;
  IF NOT FOUND OR NOT v_employee.active OR NOT v_employee.is_schedulable THEN
    RAISE EXCEPTION 'העובד אינו פעיל או אינו מיועד לשיבוץ';
  END IF;
  SELECT * INTO v_class FROM public.hadas_classes WHERE id=p_class_id;
  IF NOT FOUND OR NOT v_class.active THEN RAISE EXCEPTION 'יש לבחור כיתה פעילה'; END IF;

  v_weekday=EXTRACT(DOW FROM v_request.request_date)::integer;
  IF v_weekday=6 THEN RAISE EXCEPTION 'לא ניתן לשבץ בשבת'; END IF;
  SELECT * INTO v_pattern FROM public.hadas_employee_weekly_patterns
  WHERE employee_id=v_employee.id AND weekday=v_weekday;
  IF FOUND THEN
    IF v_pattern.day_type <> 'day_off' THEN
      RAISE EXCEPTION 'היום הפך ליום עבודה קבוע ולכן הבקשה אינה זמינה';
    END IF;
  ELSIF v_employee.fixed_day_off IS DISTINCT FROM v_weekday THEN
    RAISE EXCEPTION 'אפשר לשבץ דרך בקשה לעבוד רק ביום חופשי קבוע';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.hadas_shifts
    WHERE employee_id=v_employee.id AND shift_date=v_request.request_date
  ) THEN RAISE EXCEPTION 'העובד כבר משובץ ביום המבוקש'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.hadas_requests
    WHERE requester_id=v_employee.id AND status IN ('approved','applied')
    AND request_type IN ('leave','day_off','sick')
    AND request_date<=v_request.request_date
    AND coalesce(request_end_date,request_date)>=v_request.request_date
  ) THEN RAISE EXCEPTION 'בתאריך הזה קיימת היעדרות מאושרת'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.hadas_employee_class_constraints
    WHERE employee_id=v_employee.id AND class_id=p_class_id
    AND constraint_type='forbidden'
    AND (valid_from IS NULL OR valid_from<=v_request.request_date)
    AND (valid_to IS NULL OR valid_to>=v_request.request_date)
  ) THEN RAISE EXCEPTION 'קיים איסור לשבץ את העובד בכיתה שנבחרה'; END IF;

  IF (v_employee.job_title ~ '(גננת|גנן)')
      AND v_employee.primary_class_id IS NOT NULL
      AND v_employee.primary_class_id<>p_class_id THEN
    RAISE EXCEPTION 'גננת יכולה להשתבץ רק בכיתה הקבועה שלה';
  END IF;
  IF p_start_time IS NULL OR p_end_time IS NULL OR p_start_time>=p_end_time THEN
    RAISE EXCEPTION 'שעות השיבוץ אינן תקינות';
  END IF;
  SELECT * INTO v_settings FROM public.hadas_app_settings WHERE id=1;
  IF NOT FOUND THEN RAISE EXCEPTION 'הגדרות שעות המעון לא נמצאו'; END IF;
  v_closing=CASE WHEN v_weekday=5 THEN v_settings.friday_closing_time ELSE v_settings.closing_time END;
  IF p_start_time<v_settings.opening_time OR p_end_time>v_closing THEN
    RAISE EXCEPTION 'השעות המבוקשות חורגות משעות הפעילות של המעון';
  END IF;
  IF v_employee.max_work_days_per_week IS NOT NULL AND v_employee.max_work_days_per_week>0 THEN
    v_week_start=v_request.request_date-v_weekday;
    SELECT count(DISTINCT shift_date) INTO v_days FROM public.hadas_shifts
    WHERE employee_id=v_employee.id AND shift_date>=v_week_start
      AND shift_date<=v_week_start+5;
    IF v_days>=v_employee.max_work_days_per_week THEN
      RAISE EXCEPTION 'הבקשה חורגת ממספר ימי העבודה המרבי לעובד';
    END IF;
  END IF;

  v_role=CASE WHEN v_employee.job_title ~ '(גננת|גנן)' THEN 'teacher'
              WHEN v_employee.job_title='סייעת מובילה' OR v_employee.can_lead THEN 'lead'
              ELSE 'staff' END;
  INSERT INTO public.hadas_shifts
    (shift_date,class_id,employee_id,start_time,end_time,shift_role,status,public_note,created_by,rule_override)
  VALUES (v_request.request_date,p_class_id,v_employee.id,p_start_time,p_end_time,
    v_role,'draft','עבודה ביום חופשי – בקשה מאושרת',p_actor_id,false)
  RETURNING * INTO v_shift;

  UPDATE public.hadas_requests SET
    status='applied',shift_id=v_shift.id,decided_by=p_actor_id,decided_at=now(),
    manager_note=NULLIF(trim(p_manager_note),''),
    application_snapshot=jsonb_build_object(
      'type','approved_work','class_id',p_class_id,
      'start_time',p_start_time::text,'end_time',p_end_time::text,
      'created_shift_id',v_shift.id)
  WHERE id=v_request.id;

  INSERT INTO public.hadas_schedule_changes
    (week_start,shift_id,change_type,before_data,after_data,created_by)
  VALUES (v_request.request_date-v_weekday,v_shift.id,'create',NULL,to_jsonb(v_shift),p_actor_id);

  RETURN v_shift.id;
END;
$$;
REVOKE ALL ON FUNCTION public.hadas_approve_work_request(uuid,uuid,uuid,time,time,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hadas_approve_work_request(uuid,uuid,uuid,time,time,text) TO service_role;
