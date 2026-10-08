DROP POLICY IF EXISTS "Admins manage banners" ON public.scheme_banners;

CREATE POLICY "Admins manage scheme banners"
ON public.scheme_banners
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));