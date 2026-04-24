-- Approval/payment columns on service_jobs
ALTER TABLE public.service_jobs
ADD COLUMN IF NOT EXISTS accounts_approval_status text DEFAULT 'pending'
  CHECK (accounts_approval_status IN ('pending', 'approved', 'rejected')),
ADD COLUMN IF NOT EXISTS accounts_approved_by uuid,
ADD COLUMN IF NOT EXISTS accounts_approved_at timestamptz,
ADD COLUMN IF NOT EXISTS accounts_rejection_reason text,
ADD COLUMN IF NOT EXISTS accounts_notes text,
ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pending'
  CHECK (payment_status IN ('pending', 'partial', 'paid', 'overdue', 'cleared')),
ADD COLUMN IF NOT EXISTS amount_paid numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS amount_pending numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS payment_notes text;

CREATE TABLE IF NOT EXISTS public.customer_dues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_phone text NOT NULL,
  customer_name text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  due_type text CHECK (due_type IN ('invoice', 'advance', 'service', 'other')),
  reference_id text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz,
  cleared_by uuid,
  is_cleared boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_customer_dues_phone ON public.customer_dues(customer_phone);
CREATE INDEX IF NOT EXISTS idx_customer_dues_cleared ON public.customer_dues(is_cleared);

CREATE TABLE IF NOT EXISTS public.accounts_approvals_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('approved', 'rejected', 'hold', 'reviewed')),
  performed_by uuid NOT NULL,
  performed_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  amount_verified numeric,
  dues_checked boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_approvals_log_job ON public.accounts_approvals_log(service_job_id);
CREATE INDEX IF NOT EXISTS idx_approvals_log_user ON public.accounts_approvals_log(performed_by);

ALTER TABLE public.customer_dues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts_approvals_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "accounts_manage_dues" ON public.customer_dues;
CREATE POLICY "accounts_manage_dues" ON public.customer_dues
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'accounts'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'accounts'::app_role));

DROP POLICY IF EXISTS "sales_view_dues" ON public.customer_dues;
CREATE POLICY "sales_view_dues" ON public.customer_dues
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'sales'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'service_head'::app_role)
    OR public.has_role(auth.uid(), 'accounts'::app_role)
  );

DROP POLICY IF EXISTS "accounts_manage_approvals" ON public.accounts_approvals_log;
CREATE POLICY "accounts_manage_approvals" ON public.accounts_approvals_log
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'accounts'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'accounts'::app_role));

DROP POLICY IF EXISTS "view_approvals_log" ON public.accounts_approvals_log;
CREATE POLICY "view_approvals_log" ON public.accounts_approvals_log
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'accounts'::app_role)
    OR public.has_role(auth.uid(), 'service_head'::app_role)
  );

DROP POLICY IF EXISTS "accounts_manage_service_jobs" ON public.service_jobs;
CREATE POLICY "accounts_manage_service_jobs" ON public.service_jobs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'accounts'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'accounts'::app_role));

CREATE OR REPLACE FUNCTION public.check_customer_dues(p_customer_phone text)
RETURNS TABLE (has_dues boolean, total_pending numeric, due_count int, dues_list jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    EXISTS (SELECT 1 FROM public.customer_dues WHERE customer_phone = p_customer_phone AND is_cleared = false),
    COALESCE(SUM(amount) FILTER (WHERE is_cleared = false), 0),
    COUNT(*) FILTER (WHERE is_cleared = false)::int,
    COALESCE(
      jsonb_agg(jsonb_build_object(
        'id', id, 'amount', amount, 'type', due_type,
        'description', description, 'created_at', created_at
      )) FILTER (WHERE is_cleared = false),
      '[]'::jsonb
    )
  FROM public.customer_dues
  WHERE customer_phone = p_customer_phone;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_approvals_count()
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(*)::int FROM public.service_jobs
  WHERE accounts_approval_status = 'pending' AND deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.set_initial_approval_status()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.accounts_approval_status IS NULL OR NEW.accounts_approval_status = '' THEN
    NEW.accounts_approval_status := 'pending';
  END IF;
  IF NEW.status = 'pending'::service_job_status THEN
    NEW.status := 'pending_accounts_approval'::service_job_status;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_set_initial_approval ON public.service_jobs;
CREATE TRIGGER trigger_set_initial_approval
BEFORE INSERT ON public.service_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_initial_approval_status();

CREATE OR REPLACE FUNCTION public.notify_accounts_of_new_dispatch()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE u uuid;
BEGIN
  IF NEW.accounts_approval_status = 'pending' THEN
    FOR u IN SELECT user_id FROM public.user_roles WHERE role = 'accounts'::app_role LOOP
      INSERT INTO public.notifications (user_id, type, message, link)
      VALUES (u, 'approval_required',
        'New dispatch requires approval: ' || NEW.customer_name || ' - ₹' || NEW.value,
        '/accounts/approvals');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_notify_accounts ON public.service_jobs;
CREATE TRIGGER trigger_notify_accounts
AFTER INSERT ON public.service_jobs
FOR EACH ROW EXECUTE FUNCTION public.notify_accounts_of_new_dispatch();

CREATE OR REPLACE FUNCTION public.notify_service_head_of_approval()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE u uuid;
BEGIN
  IF NEW.accounts_approval_status = 'approved'
     AND (OLD.accounts_approval_status IS NULL OR OLD.accounts_approval_status <> 'approved') THEN
    FOR u IN SELECT user_id FROM public.user_roles WHERE role = 'service_head'::app_role LOOP
      INSERT INTO public.notifications (user_id, type, message, link)
      VALUES (u, 'dispatch_approved',
        '✅ Dispatch approved: ' || NEW.customer_name || ' - Ready for field assignment',
        '/service-jobs');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_notify_service_head ON public.service_jobs;
CREATE TRIGGER trigger_notify_service_head
AFTER UPDATE ON public.service_jobs
FOR EACH ROW EXECUTE FUNCTION public.notify_service_head_of_approval();

CREATE OR REPLACE FUNCTION public.notify_sales_of_rejection()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE sales_user_id uuid;
BEGIN
  IF NEW.accounts_approval_status = 'rejected'
     AND (OLD.accounts_approval_status IS NULL OR OLD.accounts_approval_status <> 'rejected') THEN
    SELECT created_by INTO sales_user_id FROM public.leads WHERE id = NEW.source_lead_id;
    IF sales_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, message, link)
      VALUES (sales_user_id, 'dispatch_rejected',
        '❌ Dispatch rejected by accounts: ' || NEW.customer_name
          || COALESCE(' - Reason: ' || NEW.accounts_rejection_reason, ''),
        '/leads');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_notify_sales_rejection ON public.service_jobs;
CREATE TRIGGER trigger_notify_sales_rejection
AFTER UPDATE ON public.service_jobs
FOR EACH ROW EXECUTE FUNCTION public.notify_sales_of_rejection();