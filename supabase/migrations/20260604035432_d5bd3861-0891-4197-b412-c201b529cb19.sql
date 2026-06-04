
-- Threads
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS parent_message_id uuid REFERENCES public.chat_messages(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS chat_messages_parent_idx ON public.chat_messages(parent_message_id);

-- Mute flag on user_status
ALTER TABLE public.user_status
  ADD COLUMN IF NOT EXISTS is_muted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS muted_until timestamptz,
  ADD COLUMN IF NOT EXISTS muted_reason text;

-- Moderation log
CREATE TABLE IF NOT EXISTS public.chat_moderation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  target_message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  channel_id uuid REFERENCES public.chat_channels(id) ON DELETE SET NULL,
  moderator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.chat_moderation_log TO authenticated;
GRANT ALL ON public.chat_moderation_log TO service_role;

ALTER TABLE public.chat_moderation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read moderation log"
  ON public.chat_moderation_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "Admins insert moderation log"
  ON public.chat_moderation_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) AND moderator_id = auth.uid());
