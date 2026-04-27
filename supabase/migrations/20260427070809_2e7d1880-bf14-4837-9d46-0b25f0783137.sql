-- Fix Service Head visibility: should see all service jobs + approved deliveries, but never self_delivery

DROP POLICY IF EXISTS "Service head can view approved delivery jobs" ON public.service_jobs;
DROP POLICY IF EXISTS "Service head can update approved delivery jobs" ON public.service_jobs;
DROP POLICY IF EXISTS "service_head_blocked_from_self_delivery" ON public.service_jobs;

-- Service head SELECT: all service-type jobs, plus delivery jobs that are accounts-approved.
-- Self-delivery is excluded entirely.
CREATE POLICY "Service head can view service and approved delivery jobs"
ON public.service_jobs
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'service_head'::app_role)
  AND deleted_at IS NULL
  AND type <> 'self_delivery'::service_job_type
  AND (
    type = 'service'::service_job_type
    OR (type = 'delivery'::service_job_type AND accounts_approval_status = 'approved')
  )
);

-- Service head UPDATE: same scope as SELECT
CREATE POLICY "Service head can update service and approved delivery jobs"
ON public.service_jobs
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'service_head'::app_role)
  AND deleted_at IS NULL
  AND type <> 'self_delivery'::service_job_type
  AND (
    type = 'service'::service_job_type
    OR (type = 'delivery'::service_job_type AND accounts_approval_status = 'approved')
  )
)
WITH CHECK (
  has_role(auth.uid(), 'service_head'::app_role)
  AND deleted_at IS NULL
  AND type <> 'self_delivery'::service_job_type
  AND (
    type = 'service'::service_job_type
    OR (type = 'delivery'::service_job_type AND accounts_approval_status = 'approved')
  )
);