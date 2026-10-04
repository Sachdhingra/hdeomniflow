-- Website gallery: delivery photos an admin has approved for the public website
-- (hdefurniture.netlify.app, "Recently delivered in Dehradun").
--
-- Delivery proof photos stay in the private job-photos bucket because they can
-- show the customer, their home or their invoice. Publishing copies the chosen
-- photo into the public website-gallery bucket, so only that copy is public and
-- removing it from the site never touches the proof photo. Rows carry a caption
-- and category only: never the customer's name, phone or address.

INSERT INTO storage.buckets (id, name, public)
VALUES ('website-gallery', 'website-gallery', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Admin upload website gallery" ON storage.objects;
CREATE POLICY "Admin upload website gallery"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'website-gallery' AND has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admin delete website gallery" ON storage.objects;
CREATE POLICY "Admin delete website gallery"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'website-gallery' AND has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.website_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url text NOT NULL,
  storage_path text NOT NULL,
  caption text NOT NULL DEFAULT '',
  category text,
  -- The proof photo this was copied from, so the review list can mark it as published.
  source_job_id uuid REFERENCES public.service_jobs(id) ON DELETE SET NULL,
  source_photo text,
  active boolean NOT NULL DEFAULT true,
  delivered_on date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_website_gallery_active ON public.website_gallery(active, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_gallery TO authenticated;
GRANT ALL ON public.website_gallery TO service_role;
ALTER TABLE public.website_gallery ENABLE ROW LEVEL SECURITY;

-- Only admins manage it. The website reads it through the website-gallery
-- function, which returns active rows only.
DROP POLICY IF EXISTS "admin_manage_website_gallery" ON public.website_gallery;
CREATE POLICY "admin_manage_website_gallery" ON public.website_gallery FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
