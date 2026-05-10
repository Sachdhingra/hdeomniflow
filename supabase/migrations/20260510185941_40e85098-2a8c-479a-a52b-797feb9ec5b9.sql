-- Add files column to chat_messages
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS files jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Create private storage bucket for chat attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: path layout = <channel_id>/<uuid>-<filename>
DROP POLICY IF EXISTS "chat_attach_select" ON storage.objects;
CREATE POLICY "chat_attach_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND public.has_chat_access(auth.uid())
  AND public.is_chat_member(
    ((storage.foldername(name))[1])::uuid,
    auth.uid()
  )
);

DROP POLICY IF EXISTS "chat_attach_insert" ON storage.objects;
CREATE POLICY "chat_attach_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND public.has_chat_access(auth.uid())
  AND public.is_chat_member(
    ((storage.foldername(name))[1])::uuid,
    auth.uid()
  )
  AND owner = auth.uid()
);

DROP POLICY IF EXISTS "chat_attach_delete" ON storage.objects;
CREATE POLICY "chat_attach_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
);