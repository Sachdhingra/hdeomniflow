-- Extend agent_live_locations with enhanced tracking data
ALTER TABLE public.agent_live_locations
ADD COLUMN IF NOT EXISTS accuracy DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS altitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS speed DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ;

-- Geofence violations tracking
CREATE TABLE IF NOT EXISTS public.geofence_violations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  distance_from_site INTEGER NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_geofence_violations_job
  ON public.geofence_violations (job_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_geofence_violations_agent
  ON public.geofence_violations (agent_id, recorded_at DESC);

GRANT SELECT, INSERT ON public.geofence_violations TO authenticated;
GRANT ALL ON public.geofence_violations TO service_role;

ALTER TABLE public.geofence_violations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents insert own violations"
  ON public.geofence_violations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = agent_id);

CREATE POLICY "Agents read own violations"
  ON public.geofence_violations FOR SELECT TO authenticated
  USING (auth.uid() = agent_id);

CREATE POLICY "Admins read all violations"
  ON public.geofence_violations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Location anomalies detection
CREATE TABLE IF NOT EXISTS public.location_anomalies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL,
  job_id UUID,
  anomaly_type TEXT NOT NULL,
  reasons TEXT[] NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  location_count INTEGER NOT NULL,
  analysis_window_minutes INTEGER NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_location_anomalies_agent
  ON public.location_anomalies (agent_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_location_anomalies_type
  ON public.location_anomalies (anomaly_type, detected_at DESC);

GRANT SELECT, INSERT ON public.location_anomalies TO authenticated;
GRANT ALL ON public.location_anomalies TO service_role;

ALTER TABLE public.location_anomalies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read anomalies"
  ON public.location_anomalies FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- GPS disable attempts logging
CREATE TABLE IF NOT EXISTS public.gps_tampering_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  duration_seconds INTEGER,
  failure_count INTEGER,
  last_known_location JSONB,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  shift_date DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gps_tampering_attempts_agent
  ON public.gps_tampering_attempts (agent_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_gps_tampering_attempts_shift
  ON public.gps_tampering_attempts (shift_date, agent_id);

GRANT SELECT, INSERT ON public.gps_tampering_attempts TO authenticated;
GRANT ALL ON public.gps_tampering_attempts TO service_role;

ALTER TABLE public.gps_tampering_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read tampering attempts"
  ON public.gps_tampering_attempts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
