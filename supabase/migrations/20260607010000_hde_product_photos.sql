
-- Product photos table (one photo per product, uploadable by sales + admin)
CREATE TABLE public.hde_product_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL UNIQUE REFERENCES public.products(id) ON DELETE CASCADE,
  photo_url text NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hde_product_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view_hde_product_photos" ON public.hde_product_photos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "upload_hde_product_photos" ON public.hde_product_photos
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'sales'::app_role) OR
    has_role(auth.uid(), 'site_agent'::app_role)
  );

CREATE POLICY "update_hde_product_photos" ON public.hde_product_photos
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'sales'::app_role) OR
    has_role(auth.uid(), 'site_agent'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'sales'::app_role) OR
    has_role(auth.uid(), 'site_agent'::app_role)
  );

-- Allow sales to update hde_inventory quantity (for receiving stock)
CREATE POLICY "sales_update_hde_inventory" ON public.hde_inventory
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'sales'::app_role) OR has_role(auth.uid(), 'site_agent'::app_role) OR
    has_role(auth.uid(), 'service_head'::app_role) OR has_role(auth.uid(), 'accounts'::app_role)
  );

-- Allow sales to insert new inventory rows (for adding articles)
CREATE POLICY "sales_insert_hde_inventory" ON public.hde_inventory
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'sales'::app_role) OR has_role(auth.uid(), 'site_agent'::app_role) OR
    has_role(auth.uid(), 'accounts'::app_role)
  );
