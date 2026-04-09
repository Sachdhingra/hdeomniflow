
-- Create the field-agent-photos bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('field-agent-photos', 'field-agent-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access
CREATE POLICY "Public read access for field-agent-photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'field-agent-photos');

-- Allow authenticated users to upload
CREATE POLICY "Authenticated users can upload to field-agent-photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'field-agent-photos');

-- Allow authenticated users to update their uploads
CREATE POLICY "Authenticated users can update field-agent-photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'field-agent-photos');

-- Allow authenticated users to delete their uploads
CREATE POLICY "Authenticated users can delete field-agent-photos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'field-agent-photos');
