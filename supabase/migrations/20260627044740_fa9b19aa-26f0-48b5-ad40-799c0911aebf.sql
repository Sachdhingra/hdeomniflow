
CREATE TABLE public.login_banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL,
  link_url TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.login_banners TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.login_banners TO authenticated;
GRANT ALL ON public.login_banners TO service_role;

ALTER TABLE public.login_banners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read live login banners"
ON public.login_banners FOR SELECT
TO anon, authenticated
USING (
  active = true
  AND (start_date IS NULL OR start_date <= now())
  AND (end_date IS NULL OR end_date >= now())
);

CREATE POLICY "Admins can read all login banners"
ON public.login_banners FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert login banners"
ON public.login_banners FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update login banners"
ON public.login_banners FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete login banners"
ON public.login_banners FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_login_banners_updated
BEFORE UPDATE ON public.login_banners
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_login_banners_active_window
ON public.login_banners (active, start_date, end_date, sort_order);
