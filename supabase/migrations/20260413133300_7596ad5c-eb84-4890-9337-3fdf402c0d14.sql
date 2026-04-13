-- Fix UPDATE policy to include WITH CHECK (required for upsert)
DROP POLICY IF EXISTS "Authenticated users can update field-agent-photos" ON storage.objects;

CREATE POLICY "Authenticated users can update field-agent-photos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'field-agent-photos')
WITH CHECK (bucket_id = 'field-agent-photos');