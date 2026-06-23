
CREATE TABLE IF NOT EXISTS public.agent_live_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL,
  agent_name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  shift_date DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_live_locations_agent_captured
  ON public.agent_live_locations (agent_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_live_locations_shift
  ON public.agent_live_locations (shift_date, captured_at DESC);

GRANT SELECT, INSERT ON public.agent_live_locations TO authenticated;
GRANT ALL ON public.agent_live_locations TO service_role;

ALTER TABLE public.agent_live_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents insert own pings"
  ON public.agent_live_locations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = agent_id);

CREATE POLICY "Agents read own pings"
  ON public.agent_live_locations FOR SELECT TO authenticated
  USING (auth.uid() = agent_id);

CREATE POLICY "Admins read all pings"
  ON public.agent_live_locations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
