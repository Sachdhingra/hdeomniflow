
-- HDE Display Inventory & Fulfillment Management Module

-- Locations (configurable by Admin)
CREATE TABLE public.hde_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('warehouse', 'showroom')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.hde_locations (name, type) VALUES
  ('Warehouse', 'warehouse'),
  ('Showroom 1', 'showroom'),
  ('Showroom 2', 'showroom');

-- Inventory per product per location
CREATE TABLE public.hde_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.hde_locations(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  inventory_type text NOT NULL CHECK (inventory_type IN ('warehouse', 'display')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(product_id, location_id)
);

-- Display item status tracking per physical unit
CREATE TABLE public.hde_display_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.hde_locations(id) ON DELETE CASCADE,
  display_status text NOT NULL DEFAULT 'on_display'
    CHECK (display_status IN ('on_display','sold','replacement_pending','approved','ordered','received','installed')),
  replacement_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  order_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Fulfillment orders
CREATE TABLE public.hde_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  order_type text NOT NULL CHECK (order_type IN ('warehouse','showroom','company')),
  company_order_reason text CHECK (company_order_reason IN ('no_stock','fresh_piece','custom')),
  order_tag text CHECK (order_tag IN ('stock_out_order','fresh_piece_order','custom_order')),

  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  replacement_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  location_id uuid REFERENCES public.hde_locations(id) ON DELETE SET NULL,
  display_item_id uuid REFERENCES public.hde_display_items(id) ON DELETE SET NULL,

  customer_name text,
  customer_phone text,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval','approved','rejected','service_assigned','field_assigned','in_progress','completed','cancelled')),

  notes text,
  custom_specs text,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  rejected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejection_reason text,
  service_assigned_at timestamptz,
  service_assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  field_assigned_at timestamptz,
  field_assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date date,
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- FK from display_items to orders
ALTER TABLE public.hde_display_items
  ADD CONSTRAINT fk_display_items_order
  FOREIGN KEY (order_id) REFERENCES public.hde_orders(id) ON DELETE SET NULL;

-- Order timeline / audit trail per order
CREATE TABLE public.hde_order_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.hde_orders(id) ON DELETE CASCADE,
  action text NOT NULL,
  description text,
  old_value text,
  new_value text,
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  performed_at timestamptz NOT NULL DEFAULT now()
);

-- Job completion photos
CREATE TABLE public.hde_job_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.hde_orders(id) ON DELETE CASCADE,
  photo_type text NOT NULL CHECK (photo_type IN ('before','after','other')),
  photo_url text NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  lat numeric,
  lng numeric
);

-- Indexes
CREATE INDEX idx_hde_inv_product ON public.hde_inventory(product_id);
CREATE INDEX idx_hde_inv_location ON public.hde_inventory(location_id);
CREATE INDEX idx_hde_orders_status ON public.hde_orders(status);
CREATE INDEX idx_hde_orders_created_by ON public.hde_orders(created_by);
CREATE INDEX idx_hde_orders_field ON public.hde_orders(field_assigned_to);
CREATE INDEX idx_hde_orders_created ON public.hde_orders(created_at DESC);
CREATE INDEX idx_hde_timeline_order ON public.hde_order_timeline(order_id, performed_at DESC);
CREATE INDEX idx_hde_photos_order ON public.hde_job_photos(order_id);
CREATE INDEX idx_hde_display_product ON public.hde_display_items(product_id);
CREATE INDEX idx_hde_display_status ON public.hde_display_items(display_status);

-- updated_at triggers
CREATE TRIGGER trg_hde_inventory_updated_at
  BEFORE UPDATE ON public.hde_inventory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_hde_orders_updated_at
  BEFORE UPDATE ON public.hde_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_hde_display_updated_at
  BEFORE UPDATE ON public.hde_display_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Order number generator
CREATE OR REPLACE FUNCTION public.generate_hde_order_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  seq_num INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(order_number FROM 12) AS INT)), 0) + 1
    INTO seq_num FROM public.hde_orders
   WHERE order_number LIKE 'HDE-' || TO_CHAR(now(), 'YYYYMM') || '-%';
  RETURN 'HDE-' || TO_CHAR(now(), 'YYYYMM') || '-' || LPAD(seq_num::text, 4, '0');
END;
$$;

-- RLS
ALTER TABLE public.hde_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hde_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hde_display_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hde_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hde_order_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hde_job_photos ENABLE ROW LEVEL SECURITY;

-- Locations
CREATE POLICY "view_hde_locations" ON public.hde_locations
  FOR SELECT TO authenticated USING (is_active = true);
CREATE POLICY "admin_manage_hde_locations" ON public.hde_locations
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Inventory
CREATE POLICY "view_hde_inventory" ON public.hde_inventory
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'sales'::app_role) OR
    has_role(auth.uid(), 'service_head'::app_role) OR has_role(auth.uid(), 'accounts'::app_role) OR
    has_role(auth.uid(), 'site_agent'::app_role) OR has_role(auth.uid(), 'field_agent'::app_role)
  );
CREATE POLICY "admin_manage_hde_inventory" ON public.hde_inventory
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Display items
CREATE POLICY "view_hde_display_items" ON public.hde_display_items
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'sales'::app_role) OR
    has_role(auth.uid(), 'service_head'::app_role) OR has_role(auth.uid(), 'accounts'::app_role) OR
    has_role(auth.uid(), 'site_agent'::app_role) OR has_role(auth.uid(), 'field_agent'::app_role)
  );
CREATE POLICY "manage_hde_display_items" ON public.hde_display_items
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'sales'::app_role) OR
    has_role(auth.uid(), 'service_head'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'sales'::app_role) OR
    has_role(auth.uid(), 'service_head'::app_role)
  );

-- Orders: view rules
CREATE POLICY "view_hde_orders" ON public.hde_orders
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'accounts'::app_role) OR
    has_role(auth.uid(), 'service_head'::app_role) OR
    created_by = auth.uid() OR
    field_assigned_to = auth.uid()
  );
CREATE POLICY "sales_create_hde_orders" ON public.hde_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'sales'::app_role) OR
    has_role(auth.uid(), 'site_agent'::app_role)
  );
CREATE POLICY "manage_hde_orders" ON public.hde_orders
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accounts'::app_role) OR
    has_role(auth.uid(), 'service_head'::app_role) OR has_role(auth.uid(), 'field_agent'::app_role) OR
    created_by = auth.uid()
  );
CREATE POLICY "admin_delete_hde_orders" ON public.hde_orders
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Order timeline
CREATE POLICY "view_hde_order_timeline" ON public.hde_order_timeline
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accounts'::app_role) OR
    has_role(auth.uid(), 'service_head'::app_role) OR
    EXISTS (
      SELECT 1 FROM public.hde_orders o WHERE o.id = order_id
        AND (o.created_by = auth.uid() OR o.field_assigned_to = auth.uid())
    )
  );
CREATE POLICY "insert_hde_order_timeline" ON public.hde_order_timeline
  FOR INSERT TO authenticated WITH CHECK (true);

-- Job photos
CREATE POLICY "view_hde_job_photos" ON public.hde_job_photos
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'service_head'::app_role) OR
    uploaded_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.hde_orders o WHERE o.id = order_id
        AND (o.created_by = auth.uid() OR o.field_assigned_to = auth.uid())
    )
  );
CREATE POLICY "upload_hde_job_photos" ON public.hde_job_photos
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'field_agent'::app_role) OR
    has_role(auth.uid(), 'service_head'::app_role)
  );
CREATE POLICY "admin_delete_photos" ON public.hde_job_photos
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
