-- Fix WhatsApp Meta Cloud API integration issues
-- 1. Widen concern_type CHECK constraint to include all values returned by analyzeInbound()
--    (old values: budget, design, family, timing, none)
--    (new values: price, delivery, quality, design, customization, comparison, timeline)
ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_concern_type_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_concern_type_check
  CHECK (concern_type IN (
    -- legacy / manually-set values
    'budget', 'design', 'family', 'timing', 'none',
    -- analysis-derived values from conversation-analysis.ts
    'price', 'delivery', 'quality', 'customization', 'comparison', 'timeline'
  ));

-- 2. Ensure lead_messages.sent_at allows NULL (for failed sends) — it already does,
--    but make explicit for clarity (no-op if constraint is already nullable).
ALTER TABLE public.lead_messages
  ALTER COLUMN sent_at SET DEFAULT now();

-- 3. Ensure the whatsapp_inbound_unmatched event type works in automation_logs.
--    The event_type column is unconstrained TEXT, so no change needed.
--    This comment documents the two new event_type values written by the webhook:
--      whatsapp_inbound_unmatched  (was: interakt_inbound_unmatched)
--      whatsapp_webhook_error      (was: interakt_webhook_error)
