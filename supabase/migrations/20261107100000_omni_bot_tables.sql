-- Omni-channel sales bot memory and sender state (used by the omni-bot edge function only).
-- Service role only: no client policies are created, so browsers and signed-in users cannot read or write.

CREATE TABLE IF NOT EXISTS public.omni_bot_senders (
  channel text NOT NULL,
  sender_id text NOT NULL,
  name text,
  opted_out boolean NOT NULL DEFAULT false,
  enquiry_sent boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, sender_id)
);

CREATE TABLE IF NOT EXISTS public.omni_bot_messages (
  id bigserial PRIMARY KEY,
  channel text NOT NULL,
  sender_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_omni_bot_messages_sender
  ON public.omni_bot_messages (channel, sender_id, created_at DESC);

ALTER TABLE public.omni_bot_senders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_bot_messages ENABLE ROW LEVEL SECURITY;
