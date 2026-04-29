-- 1. Add columns to leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS journey_stage TEXT,
  ADD COLUMN IF NOT EXISTS journey_stage_changed_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS journey_stage_auto BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cold_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_payment_link_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_alert_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS score_breakdown JSONB DEFAULT '{}'::jsonb;

-- Backfill existing leads
UPDATE public.leads SET journey_stage = CASE
  WHEN status::text = 'new' THEN 'problem'
  WHEN status::text = 'contacted' THEN 'exploration'
  WHEN status::text = 'follow_up' THEN 'evaluation'
  WHEN status::text = 'negotiation' THEN 'reassurance'
  WHEN status::text IN ('won','converted') THEN 'decision'
  WHEN status::text = 'overdue' THEN 'cold'
  ELSE 'exploration'
END
WHERE journey_stage IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_journey_stage ON public.leads(journey_stage) WHERE deleted_at IS NULL;

-- 2. Lead alerts
CREATE TABLE IF NOT EXISTS public.lead_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL,
  alert_type TEXT NOT NULL, -- fast_response, site_visit_needed, payment_unread, cold_reengage, objection_unhandled
  severity TEXT NOT NULL DEFAULT 'info', -- info | warning | critical
  message TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_alerts_lead_id ON public.lead_alerts(lead_id, resolved);

ALTER TABLE public.lead_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View alerts for accessible leads"
ON public.lead_alerts FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = lead_alerts.lead_id
      AND (l.created_by = auth.uid() OR l.assigned_to = auth.uid())
  )
);

CREATE POLICY "Update alerts for accessible leads"
ON public.lead_alerts FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(),'admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = lead_alerts.lead_id
      AND (l.created_by = auth.uid() OR l.assigned_to = auth.uid())
  )
);

CREATE POLICY "Admins manage alerts"
ON public.lead_alerts FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role))
WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- 3. Journey history
CREATE TABLE IF NOT EXISTS public.lead_journey_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  reason TEXT,
  auto BOOLEAN NOT NULL DEFAULT true,
  changed_by UUID,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journey_history_lead ON public.lead_journey_history(lead_id, changed_at DESC);

ALTER TABLE public.lead_journey_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View journey history for accessible leads"
ON public.lead_journey_history FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = lead_journey_history.lead_id
      AND (l.created_by = auth.uid() OR l.assigned_to = auth.uid())
  )
);

CREATE POLICY "Insert journey history for accessible leads"
ON public.lead_journey_history FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(),'admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = lead_journey_history.lead_id
      AND (l.created_by = auth.uid() OR l.assigned_to = auth.uid())
  )
);

-- 4. Trigger to log journey changes + stamp time
CREATE OR REPLACE FUNCTION public.track_journey_stage_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.journey_stage IS DISTINCT FROM NEW.journey_stage THEN
    NEW.journey_stage_changed_at := now();
    INSERT INTO public.lead_journey_history(lead_id, from_stage, to_stage, auto, changed_by)
    VALUES (NEW.id, OLD.journey_stage, NEW.journey_stage, COALESCE(NEW.journey_stage_auto, true), auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_track_journey_stage ON public.leads;
CREATE TRIGGER trg_track_journey_stage
BEFORE UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.track_journey_stage_change();

-- 5. Score breakdown function
CREATE OR REPLACE FUNCTION public.calculate_score_breakdown(_lead_id uuid)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l RECORD;
  engagement INT := 0;
  intent INT := 0;
  timeline INT := 0;
  msgs_in INT := 0;
  msgs_out INT := 0;
  products_count INT := 0;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = _lead_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;

  SELECT COUNT(*) FILTER (WHERE message_type = 'inbound'),
         COUNT(*) FILTER (WHERE message_type = 'outbound')
    INTO msgs_in, msgs_out
    FROM public.lead_messages WHERE lead_id = _lead_id;

  IF msgs_in > 0 THEN engagement := engagement + 10; END IF;
  IF l.response_time_minutes IS NOT NULL AND l.response_time_minutes < 30 THEN engagement := engagement + 10; END IF;
  IF msgs_in > 1 THEN engagement := engagement + 10; END IF;

  IF l.products_viewed IS NOT NULL THEN
    products_count := jsonb_array_length(l.products_viewed);
    IF products_count >= 2 THEN engagement := engagement + 5; END IF;
  END IF;

  IF l.budget_range IS NOT NULL AND l.budget_range <> '' THEN intent := intent + 15; END IF;
  IF l.decision_timeline IS NOT NULL AND l.decision_timeline <> '' THEN intent := intent + 15; END IF;
  IF l.family_situation IS NOT NULL AND l.family_situation <> '' THEN intent := intent + 10; END IF;
  IF l.stated_need IS NOT NULL AND l.stated_need <> '' THEN intent := intent + 10; END IF;
  IF l.objection_type IS NOT NULL AND l.objection_type <> '' THEN intent := intent + 5; END IF;

  IF l.decision_timeline = 'this_month' THEN timeline := 20;
  ELSIF l.decision_timeline = 'next_month' THEN timeline := 10;
  ELSE timeline := 0;
  END IF;

  RETURN jsonb_build_object(
    'engagement', LEAST(40, engagement),
    'intent', LEAST(40, intent),
    'timeline', LEAST(20, timeline),
    'total', LEAST(100, LEAST(40, engagement) + LEAST(40, intent) + LEAST(20, timeline)),
    'messages_in', msgs_in,
    'messages_out', msgs_out,
    'products_viewed_count', products_count
  );
END;
$$;

-- 6. Stage detection function
CREATE OR REPLACE FUNCTION public.detect_journey_stage(_lead_id uuid)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l RECORD;
  age_days INT;
  msgs_in INT := 0;
  msgs_out INT := 0;
  last_in TIMESTAMPTZ;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = _lead_id;
  IF NOT FOUND THEN RETURN 'problem'; END IF;

  IF l.status::text IN ('won','converted') THEN RETURN 'decision'; END IF;
  IF l.status::text = 'lost' THEN RETURN 'cold'; END IF;

  age_days := EXTRACT(DAY FROM (now() - COALESCE(l.created_at, now())))::int;

  SELECT COUNT(*) FILTER (WHERE message_type = 'inbound'),
         COUNT(*) FILTER (WHERE message_type = 'outbound'),
         MAX(sent_at) FILTER (WHERE message_type = 'inbound')
    INTO msgs_in, msgs_out, last_in
    FROM public.lead_messages WHERE lead_id = _lead_id;

  -- Cold: no inbound in 7+ days and old enough
  IF (last_in IS NULL OR last_in < now() - interval '7 days') AND age_days > 14 THEN
    RETURN 'cold';
  END IF;

  -- Decision: explicit signals
  IF l.status::text = 'negotiation' AND COALESCE(l.barrier_addressed, false) AND l.decision_timeline = 'this_month' THEN
    RETURN 'decision';
  END IF;

  -- Reassurance: high intent (budget + timeline) OR negotiation status OR 14+ days engaged
  IF (l.budget_range IS NOT NULL AND l.decision_timeline IN ('this_month','next_month'))
     OR l.status::text = 'negotiation'
     OR (age_days >= 14 AND msgs_in >= 2) THEN
    RETURN 'reassurance';
  END IF;

  -- Evaluation: budget OR objection OR family discussion OR 7+ days
  IF l.budget_range IS NOT NULL OR l.objection_type IS NOT NULL
     OR (l.family_situation IS NOT NULL AND msgs_in >= 1)
     OR age_days >= 7 THEN
    RETURN 'evaluation';
  END IF;

  -- Exploration: at least one inbound, or aged 1+ days
  IF msgs_in >= 1 OR age_days >= 1 THEN
    RETURN 'exploration';
  END IF;

  RETURN 'problem';
END;
$$;