
-- Allow admin to permanently delete leads
CREATE POLICY "Admin can permanently delete leads"
ON public.leads
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Allow admin to permanently delete service_jobs
CREATE POLICY "Admin can permanently delete service_jobs"
ON public.service_jobs
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Allow admin to permanently delete site_visits
CREATE POLICY "Admin can permanently delete site_visits"
ON public.site_visits
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));
