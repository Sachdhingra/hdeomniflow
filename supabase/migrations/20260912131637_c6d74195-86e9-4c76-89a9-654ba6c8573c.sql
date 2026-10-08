DROP POLICY IF EXISTS "Public can view active banners" ON public.scheme_banners;

CREATE POLICY "Visitors can view active scheme banners"
ON public.scheme_banners
FOR SELECT
TO anon
USING (active = true);

CREATE POLICY "Staff can view active scheme banners"
ON public.scheme_banners
FOR SELECT
TO authenticated
USING (active = true OR public.has_role(auth.uid(), 'admin'::public.app_role));