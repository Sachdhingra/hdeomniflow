
-- USER PRESENCE
CREATE TABLE public.user_presence (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online','away','offline')),
  last_activity TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_presence TO authenticated;
GRANT ALL ON public.user_presence TO service_role;
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat users can view presence" ON public.user_presence
  FOR SELECT TO authenticated USING (public.has_chat_access(auth.uid()));
CREATE POLICY "users update own presence" ON public.user_presence
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- READ RECEIPTS
CREATE TABLE public.message_reads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.message_reads TO authenticated;
GRANT ALL ON public.message_reads TO service_role;
ALTER TABLE public.message_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "channel members view reads" ON public.message_reads
  FOR SELECT TO authenticated USING (public.is_chat_member(channel_id, auth.uid()));
CREATE POLICY "users mark own reads" ON public.message_reads
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND public.is_chat_member(channel_id, auth.uid()));
CREATE INDEX message_reads_msg_idx ON public.message_reads(message_id);
CREATE INDEX message_reads_user_channel_idx ON public.message_reads(user_id, channel_id);

-- PINNED MESSAGES
CREATE TABLE public.pinned_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  pinned_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id)
);
GRANT SELECT, INSERT, DELETE ON public.pinned_messages TO authenticated;
GRANT ALL ON public.pinned_messages TO service_role;
ALTER TABLE public.pinned_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "channel members view pins" ON public.pinned_messages
  FOR SELECT TO authenticated USING (public.is_chat_member(channel_id, auth.uid()));
CREATE POLICY "members can pin" ON public.pinned_messages
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = pinned_by AND public.is_chat_member(channel_id, auth.uid()));
CREATE POLICY "pinner or admin can unpin" ON public.pinned_messages
  FOR DELETE TO authenticated USING (auth.uid() = pinned_by OR public.has_role(auth.uid(),'admin'::app_role));
CREATE INDEX pinned_messages_channel_idx ON public.pinned_messages(channel_id);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_presence;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pinned_messages;
