
-- 1. Add 'converted' to lead_status enum
ALTER TYPE public.lead_status ADD VALUE IF NOT EXISTS 'converted';

-- 2. Extend leads table
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS customer_email TEXT,
  ADD COLUMN IF NOT EXISTS visit_date DATE,
  ADD COLUMN IF NOT EXISTS products_viewed JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS liked_product TEXT,
  ADD COLUMN IF NOT EXISTS price_sensitivity TEXT CHECK (price_sensitivity IN ('expensive','reasonable','ok')),
  ADD COLUMN IF NOT EXISTS has_family BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS family_visit_date DATE,
  ADD COLUMN IF NOT EXISTS concern_type TEXT CHECK (concern_type IN ('budget','design','family','timing','none')),
  ADD COLUMN IF NOT EXISTS conversion_probability INT DEFAULT 30 CHECK (conversion_probability BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS next_action_suggested TEXT,
  ADD COLUMN IF NOT EXISTS why_lost TEXT,
  ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ DEFAULT now();

-- 3. lead_stage_history
CREATE TABLE IF NOT EXISTS public.lead_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  old_stage TEXT,
  new_stage TEXT NOT NULL,
  changed_by_id UUID,
  reason TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_stage_history_lead ON public.lead_stage_history(lead_id, changed_at DESC);

ALTER TABLE public.lead_stage_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View stage history for accessible leads"
  ON public.lead_stage_history FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(),'admin'::app_role) OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = lead_stage_history.lead_id
        AND (l.created_by = auth.uid() OR l.assigned_to = auth.uid())
    )
  );

CREATE POLICY "Insert stage history for accessible leads"
  ON public.lead_stage_history FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(),'admin'::app_role) OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = lead_stage_history.lead_id
        AND (l.created_by = auth.uid() OR l.assigned_to = auth.uid())
    )
  );

-- 4. auto_nurture_messages
CREATE TABLE IF NOT EXISTS public.auto_nurture_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  trigger_stage TEXT NOT NULL,
  days_in_stage INT NOT NULL DEFAULT 0,
  concern_type TEXT,
  message_type TEXT NOT NULL,
  message_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  twilio_message_sid TEXT,
  customer_opened BOOLEAN NOT NULL DEFAULT false,
  customer_response TEXT,
  responded_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nurture_lead ON public.auto_nurture_messages(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nurture_status ON public.auto_nurture_messages(status, scheduled_for);

ALTER TABLE public.auto_nurture_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all nurture messages"
  ON public.auto_nurture_messages FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "View nurture messages for accessible leads"
  ON public.auto_nurture_messages FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(),'admin'::app_role) OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = auto_nurture_messages.lead_id
        AND (l.created_by = auth.uid() OR l.assigned_to = auth.uid())
    )
  );

-- 5. automation_logs
CREATE TABLE IF NOT EXISTS public.automation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_logs_lead ON public.automation_logs(lead_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_logs_event ON public.automation_logs(event_type, executed_at DESC);

ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage automation logs"
  ON public.automation_logs FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "View automation logs for accessible leads"
  ON public.automation_logs FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(),'admin'::app_role) OR (
      lead_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.leads l
        WHERE l.id = automation_logs.lead_id
          AND (l.created_by = auth.uid() OR l.assigned_to = auth.uid())
      )
    )
  );

-- 6. Trigger: track stage changes
CREATE OR REPLACE FUNCTION public.track_lead_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.stage_changed_at := now();
    INSERT INTO public.lead_stage_history (lead_id, old_stage, new_stage, changed_by_id)
    VALUES (NEW.id, OLD.status::text, NEW.status::text, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_track_lead_stage ON public.leads;
CREATE TRIGGER trg_track_lead_stage
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.track_lead_stage_change();

-- 7. Conversion probability function
CREATE OR REPLACE FUNCTION public.calculate_conversion_probability(_lead_id UUID)
RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  l RECORD;
  score INT := 30;
  days_since_visit INT;
  days_in_stage INT;
  any_opened BOOLEAN;
  any_messages BOOLEAN;
BEGIN
  SELECT * INTO l FROM public.leads WHERE id = _lead_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  days_since_visit := EXTRACT(DAY FROM (now() - COALESCE(l.visit_date::timestamptz, l.created_at)));
  days_in_stage := EXTRACT(DAY FROM (now() - COALESCE(l.stage_changed_at, l.created_at)));

  IF days_since_visit < 14 THEN score := score + 20; END IF;

  SELECT bool_or(customer_opened), count(*) > 0
    INTO any_opened, any_messages
    FROM public.auto_nurture_messages WHERE lead_id = _lead_id;

  IF any_opened THEN score := score + 15; END IF;
  IF l.status = 'follow_up' THEN score := score + 10; END IF;
  IF COALESCE(l.has_family, false) THEN score := score + 10; END IF;
  IF days_in_stage > 21 THEN score := score - 5; END IF;
  IF any_messages AND NOT any_opened THEN score := score - 10; END IF;

  RETURN GREATEST(0, LEAST(100, score));
END;
$$;
