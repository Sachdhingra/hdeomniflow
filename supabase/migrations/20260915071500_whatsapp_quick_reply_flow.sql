-- WhatsApp quick-reply conversation flow.
-- Customers answer by tapping a button instead of typing or calling back, so
-- every answer arrives as an exact payload we can act on deterministically.

-- 1. Flow state on the lead ---------------------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS qr_step text,
  ADD COLUMN IF NOT EXISTS qr_step_sent_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS qr_last_payload text,
  ADD COLUMN IF NOT EXISTS qr_last_label text,
  ADD COLUMN IF NOT EXISTS qr_last_answer_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS qr_answer_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qr_opted_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qr_snooze_until timestamp with time zone;

COMMENT ON COLUMN public.leads.qr_step IS 'Quick-reply step the customer was last asked.';
COMMENT ON COLUMN public.leads.qr_last_payload IS 'Exact button payload the customer last tapped.';
COMMENT ON COLUMN public.leads.qr_opted_out IS 'Customer tapped "Stop messages" — no automated WhatsApp goes out again.';
COMMENT ON COLUMN public.leads.qr_snooze_until IS 'Automated follow-ups paused until this time, at the customer''s request.';

-- Leads still waiting on a tap, cheapest lookup for the board.
CREATE INDEX IF NOT EXISTS idx_leads_qr_awaiting
  ON public.leads(qr_step_sent_at DESC)
  WHERE deleted_at IS NULL AND qr_step IS NOT NULL AND qr_last_answer_at IS NULL;

-- 2. Which step each message belongs to --------------------------------------
ALTER TABLE public.lead_messages
  ADD COLUMN IF NOT EXISTS flow_step text,
  ADD COLUMN IF NOT EXISTS quick_reply_payload text,
  ADD COLUMN IF NOT EXISTS quick_reply_label text;

COMMENT ON COLUMN public.lead_messages.flow_step IS 'Quick-reply step this message asked (outbound) or answered (inbound).';
COMMENT ON COLUMN public.lead_messages.quick_reply_payload IS 'Exact WhatsApp button payload — never inferred from free text.';

CREATE INDEX IF NOT EXISTS idx_lead_messages_flow_step
  ON public.lead_messages(lead_id, created_at DESC)
  WHERE flow_step IS NOT NULL;

-- 3. Twilio Content SID registry ---------------------------------------------
-- Each step needs a Twilio Content template with quick-reply buttons. Steps
-- marked requires_approved_template are business-initiated and only work once
-- Meta approves them; the rest are sent inside the 24h service window.
CREATE TABLE IF NOT EXISTS public.whatsapp_quick_reply_steps (
  step_key text PRIMARY KEY,
  title text NOT NULL,
  question text NOT NULL,
  requires_approved_template boolean NOT NULL DEFAULT true,
  content_sid text,
  is_active boolean NOT NULL DEFAULT true,
  note text,
  sort_order integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.whatsapp_quick_reply_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view quick reply steps" ON public.whatsapp_quick_reply_steps;
CREATE POLICY "Staff can view quick reply steps"
  ON public.whatsapp_quick_reply_steps FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins manage quick reply steps" ON public.whatsapp_quick_reply_steps;
CREATE POLICY "Admins manage quick reply steps"
  ON public.whatsapp_quick_reply_steps FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Seed the flow. content_sid stays NULL until an admin pastes the Twilio SID;
-- the engine logs "quick_reply_template_missing" rather than sending anything
-- half-configured.
INSERT INTO public.whatsapp_quick_reply_steps
  (step_key, title, question, requires_approved_template, sort_order)
VALUES
  ('qr_reengage', 'Re-engage — still looking?',
   'Hi {{1}}! Home Decor Enterprises here (authorised Godrej Interio, {{3}}). Are you still looking for {{2}}? Just tap below — no need to call.',
   true, 10),
  ('qr_what_helps', 'What helps most?',
   'Great! What would help you most right now, {{1}}?', false, 20),
  ('qr_offer_catalogue', 'Offer catalogue',
   'No problem, {{1}}. Would you like our latest catalogue and this month''s offers on {{2}}?', false, 30),
  ('qr_visit_when', 'Showroom visit timing',
   'Lovely — when would you like to visit our {{1}} showroom?', false, 40),
  ('qr_price_feedback', 'Price feedback',
   'Hi {{1}}, did the price we shared for {{2}} work for you?', true, 50),
  ('qr_emi_offer', 'EMI / offer rescue',
   'Understood, {{1}}. We have easy EMI and seasonal offers on {{2}}. Should I check the best option for you?', false, 60),
  ('qr_post_visit', 'After showroom visit',
   'Thanks for visiting us, {{1}}! Did you find what you were looking for?', true, 70),
  ('qr_nudge', 'Silent lead nudge',
   'Hi {{1}}, one tap is all we need — should we keep your enquiry for {{2}} open?', true, 80)
ON CONFLICT (step_key) DO UPDATE
  SET title = EXCLUDED.title,
      question = EXCLUDED.question,
      requires_approved_template = EXCLUDED.requires_approved_template,
      sort_order = EXCLUDED.sort_order;

-- 4. Resolve an inbound tap to the exact question it answered -----------------
-- WhatsApp gives us OriginalRepliedMessageSid; that pins the answer to one
-- outbound question even when several are outstanding.
CREATE OR REPLACE FUNCTION public.find_flow_step_by_provider_message(p_sid text)
RETURNS TABLE(lead_id uuid, flow_step text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.lead_id, m.flow_step
  FROM public.lead_messages m
  WHERE m.provider_message_id = p_sid
    AND m.flow_step IS NOT NULL
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.find_flow_step_by_provider_message(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_flow_step_by_provider_message(text) TO service_role;
