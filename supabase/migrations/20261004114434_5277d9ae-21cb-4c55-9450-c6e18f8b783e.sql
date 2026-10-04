DROP POLICY IF EXISTS "Admin read website gallery" ON storage.objects;
CREATE POLICY "Admin read website gallery"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'website-gallery' AND public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admin upload website gallery" ON storage.objects;
CREATE POLICY "Admin upload website gallery"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'website-gallery' AND public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admin delete website gallery" ON storage.objects;
CREATE POLICY "Admin delete website gallery"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'website-gallery' AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.website_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url text NOT NULL,
  storage_path text NOT NULL,
  caption text NOT NULL DEFAULT '',
  category text,
  source_job_id uuid REFERENCES public.service_jobs(id) ON DELETE SET NULL,
  source_photo text,
  active boolean NOT NULL DEFAULT true,
  delivered_on date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_gallery TO authenticated;
GRANT ALL ON public.website_gallery TO service_role;
ALTER TABLE public.website_gallery ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_website_gallery_active ON public.website_gallery(active, created_at DESC);

DROP POLICY IF EXISTS "admin_manage_website_gallery" ON public.website_gallery;
CREATE POLICY "admin_manage_website_gallery" ON public.website_gallery FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));