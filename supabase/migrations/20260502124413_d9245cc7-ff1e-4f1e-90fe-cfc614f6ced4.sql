
-- ============ Leads: conversation context ============
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_inbound_sentiment text,
  ADD COLUMN IF NOT EXISTS last_inbound_concern text,
  ADD COLUMN IF NOT EXISTS last_inbound_intent text,
  ADD COLUMN IF NOT EXISTS conversation_message_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unanswered_outbound_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS needs_personal_call boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dead_lead boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_recommended_message_type text;

CREATE INDEX IF NOT EXISTS idx_leads_needs_personal_call ON public.leads(needs_personal_call) WHERE needs_personal_call = true;
CREATE INDEX IF NOT EXISTS idx_leads_unanswered ON public.leads(unanswered_outbound_count) WHERE unanswered_outbound_count > 0;

-- ============ Lead messages: per-message analysis ============
ALTER TABLE public.lead_messages
  ADD COLUMN IF NOT EXISTS sentiment text,
  ADD COLUMN IF NOT EXISTS intent text,
  ADD COLUMN IF NOT EXISTS concern text,
  ADD COLUMN IF NOT EXISTS length_category text,
  ADD COLUMN IF NOT EXISTS variant text,
  ADD COLUMN IF NOT EXISTS message_kind text,
  ADD COLUMN IF NOT EXISTS sequence_number int;

CREATE INDEX IF NOT EXISTS idx_lead_messages_lead_seq ON public.lead_messages(lead_id, sequence_number);

-- ============ Template variants (A/B) ============
CREATE TABLE IF NOT EXISTS public.message_template_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.message_templates(id) ON DELETE CASCADE,
  variant_label text NOT NULL,                      -- 'A', 'B', 'C'
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sent_count int NOT NULL DEFAULT 0,
  reply_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(template_id, variant_label)
);

ALTER TABLE public.message_template_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage variants"
  ON public.message_template_variants
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "View active variants"
  ON public.message_template_variants
  FOR SELECT TO authenticated
  USING (is_active = true OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_message_template_variants_updated_at
  BEFORE UPDATE ON public.message_template_variants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Variant performance view (admin only via RLS on underlying tables) ============
CREATE OR REPLACE VIEW public.template_variant_performance
WITH (security_invoker = true) AS
SELECT
  v.id AS variant_id,
  v.template_id,
  t.title AS template_title,
  t.stage,
  v.variant_label,
  v.sent_count,
  v.reply_count,
  CASE WHEN v.sent_count > 0
       THEN ROUND((v.reply_count::numeric / v.sent_count::numeric) * 100, 1)
       ELSE 0 END AS reply_rate_pct,
  v.is_active
FROM public.message_template_variants v
JOIN public.message_templates t ON t.id = v.template_id;

-- ============ Helper: increment variant sent/reply counters ============
CREATE OR REPLACE FUNCTION public.bump_variant_sent(_variant_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.message_template_variants
  SET sent_count = sent_count + 1, updated_at = now()
  WHERE id = _variant_id;
$$;

CREATE OR REPLACE FUNCTION public.bump_variant_reply(_variant_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.message_template_variants
  SET reply_count = reply_count + 1, updated_at = now()
  WHERE id = _variant_id;
$$;
