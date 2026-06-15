-- Fix concern_type CHECK constraint on leads table.
-- The old constraint only allowed ('budget','design','family','timing','none') but
-- conversation-analysis.ts returns ('price','delivery','quality','design',
-- 'customization','comparison','timeline') causing CHECK violations on every
-- inbound message with a non-design concern, silently rolling back lead UPDATEs.

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_concern_type_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_concern_type_check
  CHECK (concern_type IN (
    'budget', 'design', 'family', 'timing', 'none',
    'price', 'delivery', 'quality', 'customization', 'comparison', 'timeline'
  ));
