-- Fix get_dashboard_summary: monthly won count/value now uses assigned_to only.
--
-- Previous version used (created_by = user OR assigned_to = user) which caused:
--   1. Achievement inflated when a rep created a lead later reassigned to someone else.
--   2. "Won This Month" stat card and the SalesTargetCard progress bar showed
--      different numbers for the same user (frontend used assigned_to only).
--
-- The correct definition for "my achievement" is leads assigned to me.
-- my_total_leads keeps the OR filter — that tracks overall pipeline ownership.

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
  v_month_start DATE := date_trunc('month', now())::date;
BEGIN
  v_role := get_user_role(v_user_id);

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

  -- Total leads in personal pipeline (created or assigned — for visibility)
  SELECT COUNT(*) INTO v_my_total_leads
  FROM public.leads
  WHERE deleted_at IS NULL
    AND (created_by = v_user_id OR assigned_to = v_user_id);

  -- Monthly achievement: assigned_to only (not created_by).
  -- A lead reassigned away from this user must NOT count toward their target.
  SELECT COUNT(*), COALESCE(SUM(value_in_rupees), 0)
  INTO v_my_month_won_count, v_my_month_won_value
  FROM public.leads
  WHERE deleted_at IS NULL
    AND status = 'won'
    AND assigned_to = v_user_id
    AND COALESCE(stage_changed_at, updated_at) >= v_month_start;

  RETURN json_build_object(
    'total_leads',          v_total_leads,
    'total_pipeline_value', v_pipeline_value,
    'pending_jobs',         v_pending_jobs,
    'overdue_leads',        v_overdue_leads,
    'my_total_leads',       v_my_total_leads,
    'my_month_won_count',   v_my_month_won_count,
    'my_month_won_value',   v_my_month_won_value,
    'month_start',          v_month_start
  );
END;
$function$;
