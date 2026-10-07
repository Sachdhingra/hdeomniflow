-- Close the loop between customer-app service requests and the service jobs they become.
-- Converting a request created a job but never linked it, so completing the job left the
-- request stuck at "In Progress" for both staff and the customer.

ALTER TABLE public.app_service_requests
  ADD COLUMN IF NOT EXISTS service_job_id uuid REFERENCES public.service_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

CREATE INDEX IF NOT EXISTS app_service_requests_service_job_id_idx
  ON public.app_service_requests (service_job_id);

-- Keep the request status in step with its job. SECURITY DEFINER because field agents
-- complete jobs but have no update rights on app_service_requests.
CREATE OR REPLACE FUNCTION public.sync_app_service_request_from_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed'::service_job_status THEN
    UPDATE public.app_service_requests
       SET status = 'resolved', resolved_at = COALESCE(resolved_at, now())
     WHERE service_job_id = NEW.id AND status <> 'resolved';
  ELSIF OLD.status = 'completed'::service_job_status THEN
    -- Job reopened: the request is being worked on again.
    UPDATE public.app_service_requests
       SET status = 'in_progress', resolved_at = NULL
     WHERE service_job_id = NEW.id AND status = 'resolved';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_app_service_request_from_job() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_app_service_request_from_job ON public.service_jobs;
CREATE TRIGGER trg_sync_app_service_request_from_job
  AFTER UPDATE OF status ON public.service_jobs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.sync_app_service_request_from_job();

-- Backfill: link already-converted requests to the job created from them. The convert
-- action copied the phone verbatim and built the description as "<product> — <issue>",
-- and the job was created after the request; take the earliest such job.
UPDATE public.app_service_requests r
   SET service_job_id = j.id
  FROM LATERAL (
    SELECT sj.id
      FROM public.service_jobs sj
     WHERE sj.customer_phone = r.contact_phone
       AND sj.type = 'service'
       AND sj.description = r.product_description || ' — ' || r.issue_description
       AND sj.created_at >= r.created_at
       AND NOT EXISTS (
         SELECT 1 FROM public.app_service_requests o WHERE o.service_job_id = sj.id
       )
     ORDER BY sj.created_at
     LIMIT 1
  ) j
 WHERE r.service_job_id IS NULL
   AND r.status <> 'open';

-- Resolve requests whose linked job is already completed.
UPDATE public.app_service_requests r
   SET status = 'resolved', resolved_at = COALESCE(sj.completed_at, now())
  FROM public.service_jobs sj
 WHERE r.service_job_id = sj.id
   AND sj.status = 'completed'::service_job_status
   AND r.status <> 'resolved';
