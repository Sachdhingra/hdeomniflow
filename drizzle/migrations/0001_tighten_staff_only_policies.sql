CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
$$;
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM anon;

-- Staff-only reads (customers who sign up to the loyalty app are excluded)
ALTER POLICY "pl_variants_read" ON public.pl_product_variants USING (public.is_staff(auth.uid()));
ALTER POLICY "pl_products_read" ON public.pl_products USING (public.is_staff(auth.uid()));
ALTER POLICY "redemption_options_read" ON public.redemption_options USING (public.is_staff(auth.uid()));
ALTER POLICY "pl_specs_read" ON public.pl_product_specifications USING (public.is_staff(auth.uid()));
ALTER POLICY "pl_videos_read" ON public.pl_product_videos USING (public.is_staff(auth.uid()));
ALTER POLICY "cs_staff_read" ON public.card_settings USING (public.is_staff(auth.uid()));
ALTER POLICY "All authenticated can view rates" ON public.logistics_rates USING (public.is_staff(auth.uid()));
ALTER POLICY "All authenticated can view kitchen locations" ON public.kitchen_visit_locations USING (public.is_staff(auth.uid()));
ALTER POLICY "Anyone authenticated can view status" ON public.user_status USING (public.is_staff(auth.uid()));

-- Timeline entries: staff only, recorded as themselves
ALTER POLICY "insert_hde_order_timeline" ON public.hde_order_timeline
  WITH CHECK (public.is_staff(auth.uid()) AND (performed_by IS NULL OR performed_by = auth.uid()));

-- Kiosk feedback: open submission but validated, no system flags set by the submitter
ALTER POLICY "Anyone can submit feedback" ON public.customer_feedback
  WITH CHECK (
    length(btrim(customer_name)) BETWEEN 1 AND 100
    AND customer_phone ~ '^(\+?91)?[6-9][0-9]{9}$'
    AND overall_rating BETWEEN 1 AND 5
    AND staff_rating BETWEEN 1 AND 5
    AND (comments IS NULL OR length(comments) <= 2000)
    AND reviewed_on_google = false AND thank_you_sent = false
    AND lead_created = false AND lead_id IS NULL
  );

-- Storage: staff-only reads, writes tied to the uploader
ALTER POLICY "pl_files_read" ON storage.objects
  USING (bucket_id = ANY (ARRAY['product-images','product-brochures','product-videos']) AND public.is_staff(auth.uid()));
ALTER POLICY "Anyone can view job photos" ON storage.objects
  USING (bucket_id = 'job-photos' AND public.is_staff(auth.uid()));
ALTER POLICY "Authenticated read field agent photos" ON storage.objects
  USING (bucket_id = 'field-agent-photos' AND public.is_staff(auth.uid()));
ALTER POLICY "Authenticated users can upload photos" ON storage.objects
  WITH CHECK (bucket_id = 'job-photos' AND public.is_staff(auth.uid()) AND owner_id = auth.uid()::text);
ALTER POLICY "Authenticated upload field agent photos" ON storage.objects
  WITH CHECK (bucket_id = 'field-agent-photos' AND public.is_staff(auth.uid()) AND owner_id = auth.uid()::text);
ALTER POLICY "Authenticated users can upload field-agent-photos" ON storage.objects
  WITH CHECK (bucket_id = 'field-agent-photos' AND public.is_staff(auth.uid()) AND owner_id = auth.uid()::text);
ALTER POLICY "Authenticated users can upload to field-agent-photos" ON storage.objects
  WITH CHECK (bucket_id = 'field-agent-photos' AND public.is_staff(auth.uid()) AND owner_id = auth.uid()::text);
ALTER POLICY "Authenticated users can update field-agent-photos" ON storage.objects
  USING (bucket_id = 'field-agent-photos' AND (owner_id = auth.uid()::text OR public.has_role(auth.uid(), 'admin')))
  WITH CHECK (bucket_id = 'field-agent-photos' AND (owner_id = auth.uid()::text OR public.has_role(auth.uid(), 'admin')));
ALTER POLICY "Authenticated users can delete field-agent-photos" ON storage.objects
  USING (bucket_id = 'field-agent-photos' AND (owner_id = auth.uid()::text OR public.has_role(auth.uid(), 'admin')));