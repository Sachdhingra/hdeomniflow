
-- Bootstrap HDE inventory tables (previous migrations did not apply) and seed correct location names.

-- Locations
CREATE TABLE IF NOT EXISTS public.hde_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('warehouse', 'showroom')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hde_locations TO authenticated;
GRANT ALL ON public.hde_locations TO service_role;
ALTER TABLE public.hde_locations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='view_hde_locations' AND tablename='hde_locations') THEN
    CREATE POLICY "view_hde_locations" ON public.hde_locations
      FOR SELECT TO authenticated USING (is_active = true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='admin_manage_hde_locations' AND tablename='hde_locations') THEN
    CREATE POLICY "admin_manage_hde_locations" ON public.hde_locations
      FOR ALL TO authenticated
      USING (has_role(auth.uid(), 'admin'::app_role))
      WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;

-- Seed / fix location names
INSERT INTO public.hde_locations (name, type)
SELECT v.name, v.type FROM (VALUES
  ('Warehouse', 'warehouse'),
  ('Showroom 1 - Patel Nagar', 'showroom'),
  ('Showroom 2 - Subhash Road', 'showroom')
) AS v(name, type)
WHERE NOT EXISTS (SELECT 1 FROM public.hde_locations);

-- Rename existing generic showroom names if they were previously seeded
UPDATE public.hde_locations SET name = 'Showroom 1 - Patel Nagar'
  WHERE name = 'Showroom 1';
UPDATE public.hde_locations SET name = 'Showroom 2 - Subhash Road'
  WHERE name = 'Showroom 2';

-- Inventory
CREATE TABLE IF NOT EXISTS public.hde_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.hde_locations(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  inventory_type text NOT NULL CHECK (inventory_type IN ('warehouse', 'display')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(product_id, location_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hde_inventory TO authenticated;
GRANT ALL ON public.hde_inventory TO service_role;
ALTER TABLE public.hde_inventory ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='view_hde_inventory' AND tablename='hde_inventory') THEN
    CREATE POLICY "view_hde_inventory" ON public.hde_inventory
      FOR SELECT TO authenticated USING (
        has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'sales'::app_role) OR
        has_role(auth.uid(),'service_head'::app_role) OR has_role(auth.uid(),'accounts'::app_role) OR
        has_role(auth.uid(),'site_agent'::app_role) OR has_role(auth.uid(),'field_agent'::app_role)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='manage_hde_inventory' AND tablename='hde_inventory') THEN
    CREATE POLICY "manage_hde_inventory" ON public.hde_inventory
      FOR ALL TO authenticated
      USING (
        has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'sales'::app_role) OR
        has_role(auth.uid(),'site_agent'::app_role) OR has_role(auth.uid(),'accounts'::app_role) OR
        has_role(auth.uid(),'service_head'::app_role)
      )
      WITH CHECK (
        has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'sales'::app_role) OR
        has_role(auth.uid(),'site_agent'::app_role) OR has_role(auth.uid(),'accounts'::app_role) OR
        has_role(auth.uid(),'service_head'::app_role)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hde_inv_product ON public.hde_inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_hde_inv_location ON public.hde_inventory(location_id);

DROP TRIGGER IF EXISTS trg_hde_inventory_updated_at ON public.hde_inventory;
CREATE TRIGGER trg_hde_inventory_updated_at
  BEFORE UPDATE ON public.hde_inventory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Display items
CREATE TABLE IF NOT EXISTS public.hde_display_items (
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hde_display_items TO authenticated;
GRANT ALL ON public.hde_display_items TO service_role;
ALTER TABLE public.hde_display_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='view_hde_display_items' AND tablename='hde_display_items') THEN
    CREATE POLICY "view_hde_display_items" ON public.hde_display_items
      FOR SELECT TO authenticated USING (
        has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'sales'::app_role) OR
        has_role(auth.uid(),'service_head'::app_role) OR has_role(auth.uid(),'accounts'::app_role) OR
        has_role(auth.uid(),'site_agent'::app_role) OR has_role(auth.uid(),'field_agent'::app_role)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='manage_hde_display_items' AND tablename='hde_display_items') THEN
    CREATE POLICY "manage_hde_display_items" ON public.hde_display_items
      FOR ALL TO authenticated
      USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'sales'::app_role) OR has_role(auth.uid(),'service_head'::app_role))
      WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'sales'::app_role) OR has_role(auth.uid(),'service_head'::app_role));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hde_display_product ON public.hde_display_items(product_id);
CREATE INDEX IF NOT EXISTS idx_hde_display_status ON public.hde_display_items(display_status);

DROP TRIGGER IF EXISTS trg_hde_display_updated_at ON public.hde_display_items;
CREATE TRIGGER trg_hde_display_updated_at
  BEFORE UPDATE ON public.hde_display_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Orders
CREATE TABLE IF NOT EXISTS public.hde_orders (
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
  qty_sold integer DEFAULT 1,
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hde_orders TO authenticated;
GRANT ALL ON public.hde_orders TO service_role;
ALTER TABLE public.hde_orders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_display_items_order') THEN
    ALTER TABLE public.hde_display_items
      ADD CONSTRAINT fk_display_items_order
      FOREIGN KEY (order_id) REFERENCES public.hde_orders(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='view_hde_orders' AND tablename='hde_orders') THEN
    CREATE POLICY "view_hde_orders" ON public.hde_orders FOR SELECT TO authenticated USING (
      has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role) OR
      has_role(auth.uid(),'service_head'::app_role) OR created_by = auth.uid() OR field_assigned_to = auth.uid()
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='sales_create_hde_orders' AND tablename='hde_orders') THEN
    CREATE POLICY "sales_create_hde_orders" ON public.hde_orders FOR INSERT TO authenticated WITH CHECK (
      has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'sales'::app_role) OR has_role(auth.uid(),'site_agent'::app_role)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='manage_hde_orders' AND tablename='hde_orders') THEN
    CREATE POLICY "manage_hde_orders" ON public.hde_orders FOR UPDATE TO authenticated USING (
      has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role) OR
      has_role(auth.uid(),'service_head'::app_role) OR has_role(auth.uid(),'field_agent'::app_role) OR created_by = auth.uid()
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='admin_delete_hde_orders' AND tablename='hde_orders') THEN
    CREATE POLICY "admin_delete_hde_orders" ON public.hde_orders FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'::app_role));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hde_orders_status ON public.hde_orders(status);
CREATE INDEX IF NOT EXISTS idx_hde_orders_created_by ON public.hde_orders(created_by);
CREATE INDEX IF NOT EXISTS idx_hde_orders_field ON public.hde_orders(field_assigned_to);
CREATE INDEX IF NOT EXISTS idx_hde_orders_created ON public.hde_orders(created_at DESC);

DROP TRIGGER IF EXISTS trg_hde_orders_updated_at ON public.hde_orders;
CREATE TRIGGER trg_hde_orders_updated_at
  BEFORE UPDATE ON public.hde_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Order timeline
CREATE TABLE IF NOT EXISTS public.hde_order_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.hde_orders(id) ON DELETE CASCADE,
  action text NOT NULL,
  description text,
  old_value text,
  new_value text,
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  performed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hde_order_timeline TO authenticated;
GRANT ALL ON public.hde_order_timeline TO service_role;
ALTER TABLE public.hde_order_timeline ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='view_hde_order_timeline' AND tablename='hde_order_timeline') THEN
    CREATE POLICY "view_hde_order_timeline" ON public.hde_order_timeline FOR SELECT TO authenticated USING (
      has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role) OR has_role(auth.uid(),'service_head'::app_role) OR
      EXISTS (SELECT 1 FROM public.hde_orders o WHERE o.id = order_id AND (o.created_by = auth.uid() OR o.field_assigned_to = auth.uid()))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='insert_hde_order_timeline' AND tablename='hde_order_timeline') THEN
    CREATE POLICY "insert_hde_order_timeline" ON public.hde_order_timeline FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hde_timeline_order ON public.hde_order_timeline(order_id, performed_at DESC);

-- Job photos
CREATE TABLE IF NOT EXISTS public.hde_job_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.hde_orders(id) ON DELETE CASCADE,
  photo_type text NOT NULL CHECK (photo_type IN ('before','after','other')),
  photo_url text NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  lat numeric,
  lng numeric
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hde_job_photos TO authenticated;
GRANT ALL ON public.hde_job_photos TO service_role;
ALTER TABLE public.hde_job_photos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='view_hde_job_photos' AND tablename='hde_job_photos') THEN
    CREATE POLICY "view_hde_job_photos" ON public.hde_job_photos FOR SELECT TO authenticated USING (
      has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'service_head'::app_role) OR uploaded_by = auth.uid() OR
      EXISTS (SELECT 1 FROM public.hde_orders o WHERE o.id = order_id AND (o.created_by = auth.uid() OR o.field_assigned_to = auth.uid()))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='upload_hde_job_photos' AND tablename='hde_job_photos') THEN
    CREATE POLICY "upload_hde_job_photos" ON public.hde_job_photos FOR INSERT TO authenticated WITH CHECK (
      has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'field_agent'::app_role) OR has_role(auth.uid(),'service_head'::app_role) OR has_role(auth.uid(),'sales'::app_role)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='admin_delete_hde_job_photos' AND tablename='hde_job_photos') THEN
    CREATE POLICY "admin_delete_hde_job_photos" ON public.hde_job_photos FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'::app_role));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hde_photos_order ON public.hde_job_photos(order_id);

-- Product photos
CREATE TABLE IF NOT EXISTS public.hde_product_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL UNIQUE REFERENCES public.products(id) ON DELETE CASCADE,
  photo_url text NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hde_product_photos TO authenticated;
GRANT ALL ON public.hde_product_photos TO service_role;
ALTER TABLE public.hde_product_photos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='view_hde_product_photos' AND tablename='hde_product_photos') THEN
    CREATE POLICY "view_hde_product_photos" ON public.hde_product_photos FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='manage_hde_product_photos' AND tablename='hde_product_photos') THEN
    CREATE POLICY "manage_hde_product_photos" ON public.hde_product_photos FOR ALL TO authenticated
      USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'sales'::app_role) OR has_role(auth.uid(),'site_agent'::app_role))
      WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'sales'::app_role) OR has_role(auth.uid(),'site_agent'::app_role));
  END IF;
END $$;

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
