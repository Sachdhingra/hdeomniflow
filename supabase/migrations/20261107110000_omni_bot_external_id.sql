-- Provider message ids (WhatsApp wamid, Instagram mid) so that redelivered webhooks do not get a second reply.
ALTER TABLE public.omni_bot_messages ADD COLUMN IF NOT EXISTS external_id text;

-- Unique per channel for customer messages that carry a provider id. Assistant rows have none.
CREATE UNIQUE INDEX IF NOT EXISTS uq_omni_bot_messages_external
  ON public.omni_bot_messages (channel, external_id)
  WHERE external_id IS NOT NULL;
