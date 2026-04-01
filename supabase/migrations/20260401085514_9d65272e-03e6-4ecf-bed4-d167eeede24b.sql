CREATE OR REPLACE FUNCTION public.get_dashboard_summary()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role    app_role;
  v_total_leads    BIGINT  := 0;
  v_pipeline_value NUMERIC := 0;
  v_pending_jobs   BIGINT  := 0;
  v_overdue_leads  BIGINT  := 0;
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
    FROM public.service_jobs WHERE status = 'pending' AND deleted_at IS NULL;

  ELSIF v_role = 'field_agent' THEN
    SELECT COUNT(*) INTO v_pending_jobs
    FROM public.service_jobs
    WHERE assigned_agent = v_user_id
      AND status != 'completed'
      AND deleted_at IS NULL;
  END IF;

  RETURN json_build_object(
    'total_leads',         v_total_leads,
    'total_pipeline_value', v_pipeline_value,
    'pending_jobs',        v_pending_jobs,
    'overdue_leads',       v_overdue_leads
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_summary() TO authenticated;