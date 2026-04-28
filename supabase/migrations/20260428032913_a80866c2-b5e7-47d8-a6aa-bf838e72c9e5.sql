-- 1. Extend leads table
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS neighborhood TEXT,
  ADD COLUMN IF NOT EXISTS product_viewed TEXT,
  ADD COLUMN IF NOT EXISTS stated_need TEXT,
  ADD COLUMN IF NOT EXISTS preferred_style TEXT,
  ADD COLUMN IF NOT EXISTS family_situation TEXT,
  ADD COLUMN IF NOT EXISTS decision_timeline TEXT,
  ADD COLUMN IF NOT EXISTS budget_range TEXT,
  ADD COLUMN IF NOT EXISTS messages_sent INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_response_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS response_time_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS objection_type TEXT,
  ADD COLUMN IF NOT EXISTS barrier_addressed BOOLEAN NOT NULL DEFAULT false;

-- 2. lead_messages table
CREATE TABLE IF NOT EXISTS public.lead_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL CHECK (message_type IN ('outbound','inbound')),
  message_body TEXT NOT NULL,
  template_used TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  delivered_at TIMESTAMP WITH TIME ZONE,
  read_at TIMESTAMP WITH TIME ZONE,
  response_received BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_messages_lead_id ON public.lead_messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_messages_sent_at ON public.lead_messages(sent_at DESC);

ALTER TABLE public.lead_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View messages for accessible leads"
ON public.lead_messages FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = lead_messages.lead_id
      AND (l.created_by = auth.uid() OR l.assigned_to = auth.uid())
  )
);

CREATE POLICY "Insert messages for accessible leads"
ON public.lead_messages FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = lead_messages.lead_id
      AND (l.created_by = auth.uid() OR l.assigned_to = auth.uid())
  )
);

CREATE POLICY "Update own messages"
ON public.lead_messages FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR created_by = auth.uid()
);

-- 3. Trigger: maintain message counters on lead
CREATE OR REPLACE FUNCTION public.sync_lead_message_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_out TIMESTAMP WITH TIME ZONE;
BEGIN
  IF NEW.message_type = 'outbound' THEN
    UPDATE public.leads
    SET messages_sent = messages_sent + 1,
        last_message_at = NEW.sent_at,
        updated_at = now()
    WHERE id = NEW.lead_id;
  ELSIF NEW.message_type = 'inbound' THEN
    SELECT last_message_at INTO last_out FROM public.leads WHERE id = NEW.lead_id;
    UPDATE public.leads
    SET last_response_at = NEW.sent_at,
        response_time_minutes = CASE
          WHEN last_out IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (NEW.sent_at - last_out))/60)::int
          ELSE response_time_minutes
        END,
        updated_at = now()
    WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lead_messages_sync_stats ON public.lead_messages;
CREATE TRIGGER lead_messages_sync_stats
AFTER INSERT ON public.lead_messages
FOR EACH ROW EXECUTE FUNCTION public.sync_lead_message_stats();

-- 4. Extend quality score formula
CREATE OR REPLACE FUNCTION public.calculate_conversion_probability(_lead_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  days_in_stage    := EXTRACT(DAY FROM (now() - COALESCE(l.stage_changed_at, l.created_at)));

  IF days_since_visit < 14 THEN score := score + 20; END IF;

  SELECT bool_or(customer_opened), count(*) > 0
    INTO any_opened, any_messages
    FROM public.auto_nurture_messages WHERE lead_id = _lead_id;

  IF any_opened THEN score := score + 15; END IF;
  IF l.status = 'follow_up' THEN score := score + 10; END IF;
  IF COALESCE(l.has_family, false) THEN score := score + 10; END IF;
  IF days_in_stage > 21 THEN score := score - 5; END IF;
  IF any_messages AND NOT any_opened THEN score := score - 10; END IF;

  -- New psychology signals
  IF l.decision_timeline = 'this_month' THEN score := score + 15;
  ELSIF l.decision_timeline = 'next_month' THEN score := score + 5;
  END IF;
  IF l.budget_range IS NOT NULL AND l.budget_range <> '' THEN score := score + 5; END IF;
  IF l.response_time_minutes IS NOT NULL AND l.response_time_minutes < 30 THEN score := score + 10; END IF;
  IF COALESCE(l.barrier_addressed, false) THEN score := score + 10; END IF;
  IF l.objection_type IS NOT NULL AND NOT COALESCE(l.barrier_addressed, false) THEN score := score - 10; END IF;

  RETURN GREATEST(0, LEAST(100, score));
END;
$function$;