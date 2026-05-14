
CREATE OR REPLACE FUNCTION public.get_dashboard_summary()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_role    app_role;
  v_total_leads    BIGINT  := 0;
  v_pipeline_value NUMERIC := 0;
  v_pending_jobs   BIGINT  := 0;
  v_overdue_leads  BIGINT  := 0;
  v_my_total_leads     BIGINT  := 0;
  v_my_month_won_count BIGINT  := 0;
  v_my_month_won_value NUMERIC := 0;
  v_my_fy_won_count    BIGINT  := 0;
  v_my_fy_won_value    NUMERIC := 0;
  v_team_total_leads      BIGINT  := 0;
  v_team_month_won_count  BIGINT  := 0;
  v_team_month_won_value  NUMERIC := 0;
  v_team_fy_won_count     BIGINT  := 0;
  v_team_fy_won_value     NUMERIC := 0;
  v_month_start DATE := date_trunc('month', now())::date;
  v_fy_start    DATE;
BEGIN
  v_role := get_user_role(v_user_id);

  -- Indian financial year: Apr 1 – Mar 31
  IF EXTRACT(MONTH FROM now()) >= 4 THEN
    v_fy_start := make_date(EXTRACT(YEAR FROM now())::int, 4, 1);
  ELSE
    v_fy_start := make_date(EXTRACT(YEAR FROM now())::int - 1, 4, 1);
  END IF;

  IF v_role = 'admin' THEN
    SELECT COUNT(*), COALESCE(SUM(value_in_rupees), 0)
    INTO v_total_leads, v_pipeline_value
    FROM public.leads WHERE deleted_at IS NULL;

    SELECT COUNT(*) INTO v_pending_jobs
    FROM public.service_jobs WHERE status = 'pending' AND deleted_at IS NULL;

    SELECT COUNT(*) INTO v_overdue_leads
    FROM public.leads WHERE status = 'overdue' AND deleted_at IS NULL;

  ELSIF v_role IN ('sales', 'site_agent') THEN
    SELECT COUNT(*), COALESCE(SUM(value_in_rupees), 0)
    INTO v_total_leads, v_pipeline_value
    FROM public.leads
    WHERE deleted_at IS NULL
      AND (assigned_to = v_user_id OR created_by = v_user_id);

    SELECT COUNT(*) INTO v_overdue_leads
    FROM public.leads
    WHERE status = 'overdue' AND deleted_at IS NULL
      AND (assigned_to = v_user_id OR created_by = v_user_id);

  ELSIF v_role = 'service_head' THEN
    SELECT COUNT(*) INTO v_pending_jobs
    FROM public.service_jobs
    WHERE status = 'pending'
      AND type = 'delivery'::service_job_type
      AND accounts_approval_status = 'approved'
      AND deleted_at IS NULL;

  ELSIF v_role = 'field_agent' THEN
    SELECT COUNT(*) INTO v_pending_jobs
    FROM public.service_jobs
    WHERE assigned_agent = v_user_id
      AND status != 'completed'
      AND deleted_at IS NULL;
  END IF;

  SELECT COUNT(*) INTO v_my_total_leads
  FROM public.leads
  WHERE deleted_at IS NULL
    AND (created_by = v_user_id OR assigned_to = v_user_id);

  -- Team-wide grand total: all non-deleted leads owned/assigned to admin or sales users
  SELECT COUNT(*) INTO v_team_total_leads
  FROM public.leads l
  WHERE l.deleted_at IS NULL
    AND (
      EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = l.created_by  AND ur.role IN ('admin','sales'))
      OR
      EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = l.assigned_to AND ur.role IN ('admin','sales'))
    );

  -- My wins (assigned to me)
  SELECT COUNT(*), COALESCE(SUM(value_in_rupees), 0)
  INTO v_my_month_won_count, v_my_month_won_value
  FROM public.leads
  WHERE deleted_at IS NULL
    AND status = 'won'
    AND assigned_to = v_user_id
    AND COALESCE(stage_changed_at, updated_at) >= v_month_start;

  SELECT COUNT(*), COALESCE(SUM(value_in_rupees), 0)
  INTO v_my_fy_won_count, v_my_fy_won_value
  FROM public.leads
  WHERE deleted_at IS NULL
    AND status = 'won'
    AND assigned_to = v_user_id
    AND COALESCE(stage_changed_at, updated_at) >= v_fy_start;

  -- Team-wide wins (all leads, regardless of owner)
  SELECT COUNT(*), COALESCE(SUM(value_in_rupees), 0)
  INTO v_team_month_won_count, v_team_month_won_value
  FROM public.leads
  WHERE deleted_at IS NULL
    AND status = 'won'
    AND COALESCE(stage_changed_at, updated_at) >= v_month_start;

  SELECT COUNT(*), COALESCE(SUM(value_in_rupees), 0)
  INTO v_team_fy_won_count, v_team_fy_won_value
  FROM public.leads
  WHERE deleted_at IS NULL
    AND status = 'won'
    AND COALESCE(stage_changed_at, updated_at) >= v_fy_start;

  RETURN json_build_object(
    'total_leads',            v_total_leads,
    'total_pipeline_value',   v_pipeline_value,
    'pending_jobs',           v_pending_jobs,
    'overdue_leads',          v_overdue_leads,
    'my_total_leads',         v_my_total_leads,
    'team_total_leads',       v_team_total_leads,
    'my_month_won_count',     v_my_month_won_count,
    'my_month_won_value',     v_my_month_won_value,
    'my_fy_won_count',        v_my_fy_won_count,
    'my_fy_won_value',        v_my_fy_won_value,
    'team_month_won_count',   v_team_month_won_count,
    'team_month_won_value',   v_team_month_won_value,
    'team_fy_won_count',      v_team_fy_won_count,
    'team_fy_won_value',      v_team_fy_won_value,
    'month_start',            v_month_start,
    'fy_start',               v_fy_start
  );
END;
$function$;
