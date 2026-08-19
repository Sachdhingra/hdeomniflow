-- Photo buckets are private: the app never renders a `/object/public/...` URL,
-- it mints a short-lived signed URL at render time (src/lib/photoUrls.ts).
--
-- Two things have to hold for that to work, and both were until now only set
-- in the dashboard rather than in migrations:
--   1. the buckets exist and are private, and
--   2. every signed-in staff member is covered by a storage SELECT policy —
--      createSignedUrl() is refused without one, which is what left the lead
--      cards showing broken thumbnails.

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('job-photos', 'job-photos', false),
  ('field-agent-photos', 'field-agent-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- ---------------------------------------------------------------- job-photos
DROP POLICY IF EXISTS "Anyone can view job photos" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for job-photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read job photos" ON storage.objects;
CREATE POLICY "Authenticated read job photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'job-photos');

DROP POLICY IF EXISTS "Authenticated users can upload photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload job photos" ON storage.objects;
CREATE POLICY "Authenticated upload job photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'job-photos');

-- ------------------------------------------------------- field-agent-photos
DROP POLICY IF EXISTS "Public read access for field-agent-photos" ON storage.objects;
DROP POLICY IF EXISTS "Field agent photos public read" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read field agent photos" ON storage.objects;
CREATE POLICY "Authenticated read field agent photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'field-agent-photos');

DROP POLICY IF EXISTS "Authenticated users can upload to field-agent-photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload field-agent-photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload field agent photos" ON storage.objects;
CREATE POLICY "Authenticated upload field agent photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'field-agent-photos');

-- Photo uploads use upsert, so overwriting an existing object needs UPDATE too.
DROP POLICY IF EXISTS "Authenticated users can update field-agent-photos" ON storage.objects;
DROP POLICY IF EXISTS "Owner update field agent photos" ON storage.objects;
CREATE POLICY "Owner update field agent photos"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'field-agent-photos' AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role)))
WITH CHECK (bucket_id = 'field-agent-photos');
