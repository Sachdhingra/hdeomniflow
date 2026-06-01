
-- Inventory Manager tables
CREATE TABLE public.inventory_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  description TEXT,
  photo_url TEXT,
  reorder_threshold INTEGER NOT NULL DEFAULT 5,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_products TO authenticated;
GRANT ALL ON public.inventory_products TO service_role;
ALTER TABLE public.inventory_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inv_products_select" ON public.inventory_products FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'sales'::app_role));
CREATE POLICY "inv_products_insert" ON public.inventory_products FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "inv_products_update" ON public.inventory_products FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'sales'::app_role));
CREATE POLICY "inv_products_delete" ON public.inventory_products FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role));

CREATE TABLE public.display_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL UNIQUE REFERENCES public.inventory_products(id) ON DELETE CASCADE,
  quantity_on_display INTEGER NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.display_inventory TO authenticated;
GRANT ALL ON public.display_inventory TO service_role;
ALTER TABLE public.display_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "display_inv_all" ON public.display_inventory FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'sales'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'sales'::app_role));

CREATE TABLE public.pending_display (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL UNIQUE REFERENCES public.inventory_products(id) ON DELETE CASCADE,
  quantity_pending INTEGER NOT NULL DEFAULT 0,
  date_marked TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_display TO authenticated;
GRANT ALL ON public.pending_display TO service_role;
ALTER TABLE public.pending_display ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pending_display_all" ON public.pending_display FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'sales'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'sales'::app_role));

CREATE TABLE public.inventory_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.inventory_products(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  quantity_change INTEGER NOT NULL,
  lead_id UUID,
  service_job_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.inventory_audit_log TO authenticated;
GRANT ALL ON public.inventory_audit_log TO service_role;
ALTER TABLE public.inventory_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inv_audit_select" ON public.inventory_audit_log FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'sales'::app_role));
CREATE POLICY "inv_audit_insert" ON public.inventory_audit_log FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'sales'::app_role));

CREATE INDEX idx_inv_audit_product ON public.inventory_audit_log(product_id);
CREATE INDEX idx_inv_products_category ON public.inventory_products(category);

-- Add product_id to service_jobs for self-delivery inventory tracking
ALTER TABLE public.service_jobs ADD COLUMN IF NOT EXISTS inventory_product_id UUID REFERENCES public.inventory_products(id);

-- Trigger: when a self_delivery service_job has an inventory_product_id, decrement display + increment pending + log
CREATE OR REPLACE FUNCTION public.handle_self_delivery_inventory()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type = 'self_delivery'::service_job_type
     AND NEW.inventory_product_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.inventory_product_id IS DISTINCT FROM NEW.inventory_product_id) THEN

    UPDATE public.display_inventory
       SET quantity_on_display = GREATEST(0, quantity_on_display - 1),
           last_updated = now()
     WHERE product_id = NEW.inventory_product_id;

    INSERT INTO public.pending_display (product_id, quantity_pending, date_marked)
    VALUES (NEW.inventory_product_id, 1, now())
    ON CONFLICT (product_id) DO UPDATE
      SET quantity_pending = public.pending_display.quantity_pending + 1,
          date_marked = now();

    INSERT INTO public.inventory_audit_log (product_id, action, quantity_change, lead_id, service_job_id, created_by)
    VALUES (NEW.inventory_product_id, 'sold', -1, NEW.source_lead_id, NEW.id, COALESCE(NEW.updated_by, NEW.created_by));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_self_delivery_inventory
AFTER INSERT OR UPDATE OF inventory_product_id, type ON public.service_jobs
FOR EACH ROW EXECUTE FUNCTION public.handle_self_delivery_inventory();
