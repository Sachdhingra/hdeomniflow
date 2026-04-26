DROP POLICY IF EXISTS "service_head_view_jobs" ON public.service_jobs;
DROP POLICY IF EXISTS "service_head_view_approved_jobs" ON public.service_jobs;
DROP POLICY IF EXISTS "service_head_update_approved_jobs" ON public.service_jobs;
DROP POLICY IF EXISTS "service_head_blocked_from_self_delivery" ON public.service_jobs;
DROP POLICY IF EXISTS "Service jobs viewable by relevant roles" ON public.service_jobs;
DROP POLICY IF EXISTS "Service head and admin can update jobs" ON public.service_jobs;

CREATE POLICY "Admins can view all service jobs"
ON public.service_jobs
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service head can view approved delivery jobs"
ON public.service_jobs
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'service_head'::app_role)
  AND type = 'delivery'::service_job_type
  AND accounts_approval_status = 'approved'
  AND deleted_at IS NULL
);

CREATE POLICY "Assigned agents can view own service jobs"
ON public.service_jobs
FOR SELECT TO authenticated
USING (
  assigned_agent = auth.uid()
  AND deleted_at IS NULL
);

CREATE POLICY "Admins can update all service jobs"
ON public.service_jobs
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service head can update approved delivery jobs"
ON public.service_jobs
FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'service_head'::app_role)
  AND type = 'delivery'::service_job_type
  AND accounts_approval_status = 'approved'
  AND deleted_at IS NULL
)
WITH CHECK (
  public.has_role(auth.uid(), 'service_head'::app_role)
  AND type = 'delivery'::service_job_type
  AND accounts_approval_status = 'approved'
  AND deleted_at IS NULL
);

CREATE POLICY "Assigned agents can update own service jobs"
ON public.service_jobs
FOR UPDATE TO authenticated
USING (assigned_agent = auth.uid())
WITH CHECK (assigned_agent = auth.uid());

CREATE OR REPLACE FUNCTION public.notify_service_head_of_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE u uuid;
BEGIN
  IF NEW.type = 'delivery'::service_job_type
     AND NEW.accounts_approval_status = 'approved'
     AND (OLD.accounts_approval_status IS NULL OR OLD.accounts_approval_status <> 'approved') THEN
    FOR u IN SELECT user_id FROM public.user_roles WHERE role = 'service_head'::app_role LOOP
      INSERT INTO public.notifications (user_id, type, message, link)
      VALUES (
        u,
        'dispatch_approved',
        '✅ Dispatch approved: ' || NEW.customer_name || ' - Ready for field assignment',
        '/service-jobs'
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_self_delivery_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type = 'self_delivery'::service_job_type
     AND NEW.accounts_approval_status = 'approved'
     AND (OLD.accounts_approval_status IS NULL OR OLD.accounts_approval_status <> 'approved') THEN
    NEW.status := 'completed'::service_job_status;
    NEW.completed_at := COALESCE(NEW.completed_at, NEW.accounts_approved_at, now());

    IF NEW.source_lead_id IS NOT NULL THEN
      UPDATE public.leads
      SET status = 'converted'::lead_status,
          updated_by = COALESCE(NEW.accounts_approved_by, updated_by),
          updated_at = now()
      WHERE id = NEW.source_lead_id
        AND status IS DISTINCT FROM 'converted'::lead_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_finalize_self_delivery_approval ON public.service_jobs;
CREATE TRIGGER trigger_finalize_self_delivery_approval
BEFORE UPDATE ON public.service_jobs
FOR EACH ROW
EXECUTE FUNCTION public.finalize_self_delivery_approval();

UPDATE public.service_jobs
SET status = 'completed'::service_job_status,
    completed_at = COALESCE(completed_at, accounts_approved_at, now())
WHERE type = 'self_delivery'::service_job_type
  AND accounts_approval_status = 'approved'
  AND deleted_at IS NULL
  AND status IS DISTINCT FROM 'completed'::service_job_status;

UPDATE public.leads l
SET status = 'converted'::lead_status,
    updated_by = COALESCE(sj.accounts_approved_by, l.updated_by),
    updated_at = now()
FROM public.service_jobs sj
WHERE sj.source_lead_id = l.id
  AND sj.type = 'self_delivery'::service_job_type
  AND sj.accounts_approval_status = 'approved'
  AND sj.deleted_at IS NULL
  AND l.status IS DISTINCT FROM 'converted'::lead_status;

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

  SELECT COUNT(*) INTO v_my_total_leads
  FROM public.leads
  WHERE deleted_at IS NULL
    AND (created_by = v_user_id OR assigned_to = v_user_id);

  SELECT COUNT(*), COALESCE(SUM(value_in_rupees), 0)
  INTO v_my_month_won_count, v_my_month_won_value
  FROM public.leads
  WHERE deleted_at IS NULL
    AND status = 'won'
    AND (created_by = v_user_id OR assigned_to = v_user_id)
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