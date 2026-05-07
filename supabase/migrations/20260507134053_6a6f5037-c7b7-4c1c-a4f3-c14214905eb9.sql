
ALTER TABLE public.lead_messages
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_message text;

ALTER TABLE public.message_logs
  ADD COLUMN IF NOT EXISTS provider_message_id text;

CREATE INDEX IF NOT EXISTS idx_lead_messages_provider_message_id
  ON public.lead_messages(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_logs_provider_message_id
  ON public.message_logs(provider_message_id)
  WHERE provider_message_id IS NOT NULL;
