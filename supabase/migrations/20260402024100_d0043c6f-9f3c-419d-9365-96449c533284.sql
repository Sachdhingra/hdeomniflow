
-- Add new statuses to service_job_status enum
ALTER TYPE public.service_job_status ADD VALUE IF NOT EXISTS 'on_route';
ALTER TYPE public.service_job_status ADD VALUE IF NOT EXISTS 'on_site';
ALTER TYPE public.service_job_status ADD VALUE IF NOT EXISTS 'rescheduled';

-- Create reschedule history table
CREATE TABLE public.reschedule_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  original_date DATE,
  new_date DATE NOT NULL,
  reason TEXT NOT NULL,
  rescheduled_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.reschedule_history ENABLE ROW LEVEL SECURITY;

-- Admin, service_head can view/create reschedule history
CREATE POLICY "Admins and service heads can view reschedule history"
  ON public.reschedule_history FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'service_head'::app_role));

CREATE POLICY "Admins and service heads can create reschedule history"
  ON public.reschedule_history FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'service_head'::app_role));

-- Create storage bucket for job/lead photos
INSERT INTO storage.buckets (id, name, public) VALUES ('job-photos', 'job-photos', true);

-- Storage RLS: authenticated users can upload
CREATE POLICY "Authenticated users can upload photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'job-photos');

CREATE POLICY "Anyone can view job photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'job-photos');
