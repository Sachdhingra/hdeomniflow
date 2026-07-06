CREATE POLICY "Service head can view pending delivery approvals"
ON public.service_jobs
FOR SELECT
USING (
  has_role(auth.uid(), 'service_head'::app_role)
  AND deleted_at IS NULL
  AND type = 'delivery'::service_job_type
  AND accounts_approval_status IN ('pending','rejected')
);