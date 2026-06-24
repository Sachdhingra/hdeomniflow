CREATE TABLE IF NOT EXISTS public.agent_signal_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_name text,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  shift_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  duration_minutes integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.agent_signal_logs TO authenticated;
GRANT ALL ON public.agent_signal_logs TO service_role;

ALTER TABLE public.agent_signal_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents insert their own signal logs"
  ON public.agent_signal_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = agent_id);

CREATE POLICY "Agents update their own signal logs"
  ON public.agent_signal_logs FOR UPDATE TO authenticated
  USING (auth.uid() = agent_id) WITH CHECK (auth.uid() = agent_id);

CREATE POLICY "Agents view own; admin/service_head view all"
  ON public.agent_signal_logs FOR SELECT TO authenticated
  USING (
    auth.uid() = agent_id
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'service_head'::app_role)
    OR public.has_role(auth.uid(), 'accounts'::app_role)
  );

CREATE INDEX IF NOT EXISTS agent_signal_logs_shift_idx
  ON public.agent_signal_logs (shift_date DESC, agent_id, occurred_at DESC);
