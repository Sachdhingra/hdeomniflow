
-- message_reactions
CREATE TABLE public.message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_reactions TO authenticated;
GRANT ALL ON public.message_reactions TO service_role;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view reactions"
ON public.message_reactions FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.chat_messages m
  WHERE m.id = message_reactions.message_id
    AND public.is_chat_member(m.channel_id, auth.uid())
));

CREATE POLICY "Users can add their own reactions"
ON public.message_reactions FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND EXISTS (
  SELECT 1 FROM public.chat_messages m
  WHERE m.id = message_reactions.message_id
    AND public.is_chat_member(m.channel_id, auth.uid())
));

CREATE POLICY "Users can remove their own reactions"
ON public.message_reactions FOR DELETE TO authenticated
USING (user_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
ALTER TABLE public.message_reactions REPLICA IDENTITY FULL;

-- user_status (away message)
CREATE TABLE public.user_status (
  user_id uuid PRIMARY KEY,
  is_away boolean NOT NULL DEFAULT false,
  away_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_status TO authenticated;
GRANT INSERT, UPDATE ON public.user_status TO authenticated;
GRANT ALL ON public.user_status TO service_role;
ALTER TABLE public.user_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view status"
ON public.user_status FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can upsert own status"
ON public.user_status FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own status"
ON public.user_status FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.user_status;

-- edit/delete columns on chat_messages
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
