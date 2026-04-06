
-- 1. Add phone_number to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_number text;

-- 2. Create audit_flags table for suspicious activity tracking
CREATE TABLE public.audit_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL,
  flag_type text NOT NULL,
  description text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_flags ENABLE ROW LEVEL SECURITY;

-- Only admin can view audit flags
CREATE POLICY "Admins can view audit flags"
  ON public.audit_flags FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- System (service role) and admin can insert audit flags
CREATE POLICY "Admins can insert audit flags"
  ON public.audit_flags FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Allow service role to insert (edge functions)
ALTER TABLE public.audit_flags FORCE ROW LEVEL SECURITY;

-- 3. Create agent_performance view-like table for caching scores
CREATE TABLE public.agent_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  period text NOT NULL DEFAULT 'daily',
  score integer NOT NULL DEFAULT 0,
  jobs_completed integer NOT NULL DEFAULT 0,
  on_time_pct integer NOT NULL DEFAULT 0,
  reschedule_count integer NOT NULL DEFAULT 0,
  flags_count integer NOT NULL DEFAULT 0,
  calculated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view agent scores"
  ON public.agent_scores FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage agent scores"
  ON public.agent_scores FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
