CREATE TABLE public.lead_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES public.leads(id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'yes_received' CHECK (stage IN ('yes_received','contacted','visit_booked','quote_sent','negotiation','won','lost')),
  yes_received_at timestamptz NOT NULL DEFAULT now(),
  stage_started_at timestamptz NOT NULL DEFAULT now(),
  owner_id uuid,
  next_step text,
  next_step_due_date date,
  close_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.lead_deals TO authenticated;
GRANT ALL ON public.lead_deals TO service_role;
ALTER TABLE public.lead_deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view all lead deals" ON public.lead_deals FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Sales view accessible lead deals" ON public.lead_deals FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_deals.lead_id AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid())));
CREATE POLICY "Admins manage all lead deals" ON public.lead_deals FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Sales manage accessible lead deals" ON public.lead_deals FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_deals.lead_id AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_deals.lead_id AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid())));

CREATE TABLE public.lead_deal_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.lead_deals(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  old_stage text CHECK (old_stage IS NULL OR old_stage IN ('yes_received','contacted','visit_booked','quote_sent','negotiation','won','lost')),
  new_stage text NOT NULL CHECK (new_stage IN ('yes_received','contacted','visit_booked','quote_sent','negotiation','won','lost')),
  next_step text,
  next_step_due_date date,
  changed_by_id uuid,
  change_source text NOT NULL DEFAULT 'manual' CHECK (change_source IN ('manual','whatsapp_yes','customer_contact','site_visit','quote','lead_status','backfill')),
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.lead_deal_history TO authenticated;
GRANT ALL ON public.lead_deal_history TO service_role;
ALTER TABLE public.lead_deal_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view all lead deal history" ON public.lead_deal_history FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Sales view accessible lead deal history" ON public.lead_deal_history FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_deal_history.lead_id AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid())));

CREATE INDEX idx_lead_deals_stage_due ON public.lead_deals(stage, next_step_due_date);
CREATE INDEX idx_lead_deals_owner_stage ON public.lead_deals(owner_id, stage);
CREATE INDEX idx_lead_deal_history_deal ON public.lead_deal_history(deal_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.lead_deal_stage_rank(p_stage text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_stage
    WHEN 'yes_received' THEN 1
    WHEN 'contacted' THEN 2
    WHEN 'visit_booked' THEN 3
    WHEN 'quote_sent' THEN 4
    WHEN 'negotiation' THEN 5
    WHEN 'won' THEN 6
    WHEN 'lost' THEN 6
    ELSE 0
  END
$$;

CREATE OR REPLACE FUNCTION public.advance_lead_deal(
  p_lead_id uuid,
  p_stage text,
  p_source text,
  p_event_at timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead public.leads%ROWTYPE;
  v_deal public.lead_deals%ROWTYPE;
BEGIN
  IF p_stage NOT IN ('yes_received','contacted','visit_booked','quote_sent','negotiation','won','lost') THEN
    RAISE EXCEPTION 'Invalid deal stage';
  END IF;
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id AND deleted_at IS NULL;
  IF NOT FOUND OR v_lead.follow_up_reply_state IS DISTINCT FROM 'interested' THEN RETURN; END IF;

  INSERT INTO public.lead_deals (lead_id, stage, yes_received_at, stage_started_at, owner_id, next_step, next_step_due_date)
  VALUES (
    v_lead.id,
    p_stage,
    COALESCE(v_lead.follow_up_reply_at, p_event_at, now()),
    COALESCE(p_event_at, now()),
    COALESCE(v_lead.assigned_to, v_lead.created_by),
    CASE p_stage
      WHEN 'yes_received' THEN 'Contact customer'
      WHEN 'contacted' THEN 'Book customer visit'
      WHEN 'visit_booked' THEN 'Prepare and send quote'
      WHEN 'quote_sent' THEN 'Follow up on quote'
      WHEN 'negotiation' THEN 'Agree final terms'
      ELSE NULL
    END,
    CASE WHEN p_stage IN ('won','lost') THEN NULL ELSE COALESCE(v_lead.next_follow_up_date, (COALESCE(p_event_at, now())::date + 1)) END
  )
  ON CONFLICT (lead_id) DO NOTHING;

  SELECT * INTO v_deal FROM public.lead_deals WHERE lead_id = p_lead_id FOR UPDATE;
  IF v_deal.stage IN ('won','lost') THEN RETURN; END IF;
  IF public.lead_deal_stage_rank(p_stage) > public.lead_deal_stage_rank(v_deal.stage) OR p_stage IN ('won','lost') THEN
    UPDATE public.lead_deals
    SET stage = p_stage,
        stage_started_at = COALESCE(p_event_at, now()),
        owner_id = COALESCE(v_lead.assigned_to, v_lead.created_by, owner_id),
        next_step = CASE p_stage
          WHEN 'contacted' THEN 'Book customer visit'
          WHEN 'visit_booked' THEN 'Prepare and send quote'
          WHEN 'quote_sent' THEN 'Follow up on quote'
          WHEN 'negotiation' THEN 'Agree final terms'
          ELSE NULL
        END,
        next_step_due_date = CASE WHEN p_stage IN ('won','lost') THEN NULL ELSE COALESCE(v_lead.next_follow_up_date, (COALESCE(p_event_at, now())::date + 1)) END,
        updated_at = now()
    WHERE id = v_deal.id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.track_lead_deal_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source text;
BEGIN
  v_source := COALESCE(current_setting('app.lead_deal_change_source', true), 'manual');
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.lead_deal_history (deal_id, lead_id, old_stage, new_stage, next_step, next_step_due_date, changed_by_id, change_source, changed_at)
    VALUES (NEW.id, NEW.lead_id, NULL, NEW.stage, NEW.next_step, NEW.next_step_due_date, auth.uid(), v_source, NEW.stage_started_at);
  ELSIF OLD.stage IS DISTINCT FROM NEW.stage THEN
    NEW.stage_started_at := COALESCE(NEW.stage_started_at, now());
    INSERT INTO public.lead_deal_history (deal_id, lead_id, old_stage, new_stage, next_step, next_step_due_date, changed_by_id, change_source, changed_at)
    VALUES (NEW.id, NEW.lead_id, OLD.stage, NEW.stage, NEW.next_step, NEW.next_step_due_date, auth.uid(), v_source, NEW.stage_started_at);
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_track_lead_deal_history BEFORE INSERT OR UPDATE ON public.lead_deals FOR EACH ROW EXECUTE FUNCTION public.track_lead_deal_history();

CREATE OR REPLACE FUNCTION public.sync_lead_to_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage text;
BEGIN
  IF NEW.follow_up_reply_state = 'interested' AND (TG_OP = 'INSERT' OR OLD.follow_up_reply_state IS DISTINCT FROM NEW.follow_up_reply_state) THEN
    PERFORM set_config('app.lead_deal_change_source', 'whatsapp_yes', true);
    PERFORM public.advance_lead_deal(NEW.id, 'yes_received', 'whatsapp_yes', COALESCE(NEW.follow_up_reply_at, now()));
  END IF;
  IF NEW.follow_up_reply_state = 'interested' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    v_stage := CASE
      WHEN NEW.status IN ('won','converted') THEN 'won'
      WHEN NEW.status = 'lost' THEN 'lost'
      WHEN NEW.status = 'negotiation' THEN 'negotiation'
      ELSE NULL
    END;
    IF v_stage IS NOT NULL THEN
      PERFORM set_config('app.lead_deal_change_source', 'lead_status', true);
      PERFORM public.advance_lead_deal(NEW.id, v_stage, 'lead_status', now());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_sync_lead_to_deal AFTER INSERT OR UPDATE OF follow_up_reply_state, status ON public.leads FOR EACH ROW EXECUTE FUNCTION public.sync_lead_to_deal();

CREATE OR REPLACE FUNCTION public.sync_contact_to_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.message_type = 'outbound' AND NEW.status IN ('sent','delivered','read') THEN
    PERFORM set_config('app.lead_deal_change_source', 'customer_contact', true);
    PERFORM public.advance_lead_deal(NEW.lead_id, 'contacted', 'customer_contact', COALESCE(NEW.sent_at, NEW.created_at));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_sync_contact_to_deal AFTER INSERT OR UPDATE OF status ON public.lead_messages FOR EACH ROW EXECUTE FUNCTION public.sync_contact_to_deal();

CREATE OR REPLACE FUNCTION public.sync_visit_to_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
BEGIN
  IF NEW.customer_phone IS NOT NULL THEN
    SELECT id INTO v_lead_id
    FROM public.find_latest_lead_by_phone(NEW.customer_phone)
    LIMIT 1;
  END IF;
  IF v_lead_id IS NOT NULL THEN
    PERFORM set_config('app.lead_deal_change_source', 'site_visit', true);
    PERFORM public.advance_lead_deal(v_lead_id, 'visit_booked', 'site_visit', COALESCE(NEW.created_at, now()));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_sync_visit_to_deal AFTER INSERT OR UPDATE OF customer_phone ON public.site_visits FOR EACH ROW EXECUTE FUNCTION public.sync_visit_to_deal();

CREATE OR REPLACE FUNCTION public.sync_quote_to_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    PERFORM set_config('app.lead_deal_change_source', 'quote', true);
    PERFORM public.advance_lead_deal(NEW.lead_id, 'quote_sent', 'quote', COALESCE(NEW.created_at, now()));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_sync_quote_to_deal AFTER INSERT OR UPDATE OF lead_id ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.sync_quote_to_deal();

COMMENT ON TABLE public.lead_deals IS 'Commercial pipeline for leads that gave a genuine interested reply.';
COMMENT ON TABLE public.lead_deal_history IS 'Immutable timeline of lead-to-deal stage changes.';