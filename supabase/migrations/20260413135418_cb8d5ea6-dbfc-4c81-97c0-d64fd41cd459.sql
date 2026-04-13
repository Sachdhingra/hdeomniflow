DROP POLICY IF EXISTS "Authenticated users can upload field-agent-photos" ON storage.objects;

CREATE POLICY "Authenticated users can upload field-agent-photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'field-agent-photos');