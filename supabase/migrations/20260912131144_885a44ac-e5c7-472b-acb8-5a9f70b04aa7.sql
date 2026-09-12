GRANT SELECT ON public.scheme_banners TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheme_banners TO authenticated;
GRANT ALL ON public.scheme_banners TO service_role;