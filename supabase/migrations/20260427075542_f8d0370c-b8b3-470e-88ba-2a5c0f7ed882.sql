-- Allow lead owners (creator/assignee of source lead) to update their linked
-- service_jobs ONLY while it is rejected by accounts and not yet assigned.
-- This enables the "Resubmit" flow from Sales Dashboard.

CREATE POLICY "Lead owners can resubmit rejected dispatches"
ON public.service_jobs
FOR UPDATE
TO authenticated
USING (
  source_lead_id IS NOT NULL
  AND deleted_at IS NULL
  AND accounts_approval_status = 'rejected'
  AND assigned_agent IS NULL
  AND EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = service_jobs.source_lead_id
      AND (l.created_by = auth.uid() OR l.assigned_to = auth.uid())
  )
)
WITH CHECK (
  source_lead_id IS NOT NULL
  AND deleted_at IS NULL
  AND accounts_approval_status = 'pending'
  AND assigned_agent IS NULL
  AND EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = service_jobs.source_lead_id
      AND (l.created_by = auth.uid() OR l.assigned_to = auth.uid())
  )
);

-- Also ensure accounts users can see resubmitted rows. The existing
-- accounts_manage_service_jobs policy already allows ALL for accounts,
-- so no change needed there.