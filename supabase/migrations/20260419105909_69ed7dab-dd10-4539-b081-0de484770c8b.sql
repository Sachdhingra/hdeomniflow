-- Allow sales/site_agent users to view service jobs linked to leads they created or are assigned to,
-- so they can see completion photos uploaded by field agents.
CREATE POLICY "Lead owners can view linked service jobs"
ON public.service_jobs
FOR SELECT
TO authenticated
USING (
  source_lead_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = service_jobs.source_lead_id
      AND (l.created_by = auth.uid() OR l.assigned_to = auth.uid())
  )
);