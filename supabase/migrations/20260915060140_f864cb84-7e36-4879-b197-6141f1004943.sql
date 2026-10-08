ALTER TABLE public.lead_messages
  ADD COLUMN IF NOT EXISTS outreach_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS seen_at timestamp with time zone;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_messages_provider_message_id_unique
  ON public.lead_messages(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_messages_unseen_inbound
  ON public.lead_messages(lead_id, created_at DESC)
  WHERE message_type = 'inbound' AND seen_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_phone_last10
  ON public.leads ((right(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 10)))
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.find_latest_lead_by_phone(p_phone text)
RETURNS TABLE(id uuid, conversation_message_count integer, assigned_to uuid, created_by uuid, customer_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, COALESCE(l.conversation_message_count, 0), l.assigned_to, l.created_by, l.customer_name
  FROM public.leads l
  WHERE l.deleted_at IS NULL
    AND right(regexp_replace(l.customer_phone, '[^0-9]', '', 'g'), 10)
      = right(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g'), 10)
  ORDER BY l.created_at DESC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.find_latest_lead_by_phone(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_latest_lead_by_phone(text) TO service_role;