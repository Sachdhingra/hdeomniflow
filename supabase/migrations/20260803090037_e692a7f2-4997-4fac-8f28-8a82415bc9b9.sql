CREATE POLICY "pl_files_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('product-images','product-brochures','product-videos'));
CREATE POLICY "pl_files_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('product-images','product-brochures','product-videos') AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "pl_files_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('product-images','product-brochures','product-videos') AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (bucket_id IN ('product-images','product-brochures','product-videos') AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "pl_files_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('product-images','product-brochures','product-videos') AND public.has_role(auth.uid(),'admin'));