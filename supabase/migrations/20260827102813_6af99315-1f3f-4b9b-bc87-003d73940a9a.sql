DROP POLICY IF EXISTS "Admins manage settings" ON public.app_settings;
CREATE POLICY "Admins manage settings" ON public.app_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Anyone can read public settings" ON public.app_settings;
CREATE POLICY "Anyone can read public settings" ON public.app_settings
  FOR SELECT TO anon, authenticated
  USING (key = ANY (ARRAY['google_review_url'::text, 'business_phone'::text]));