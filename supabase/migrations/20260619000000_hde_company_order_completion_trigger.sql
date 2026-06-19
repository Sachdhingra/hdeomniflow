
-- DB trigger: when a warehouse/company hde_order is marked completed,
-- auto-upsert hde_inventory at the destination location and write an audit entry.
--
-- Corrections from request:
--   • status 'closed' → 'completed' (hde_orders has no 'closed' value)
--   • display_inventory → hde_inventory (both hde_orders and hde_inventory reference products.id;
--     display_inventory references inventory_products.id — a different product catalogue)
--   • ON CONFLICT key is (product_id, location_id) — the UNIQUE constraint on hde_inventory
--   • audit column is 'reason', not 'notes'

CREATE OR REPLACE FUNCTION public.handle_hde_company_order_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty integer;
BEGIN
  -- Only for company (warehouse request) orders transitioning into 'completed'
  IF NEW.order_type = 'company'
     AND NEW.status = 'completed'
     AND OLD.status IS DISTINCT FROM 'completed'
     AND NEW.location_id IS NOT NULL
  THEN
    v_qty := COALESCE(NEW.qty_sold, 1);

    -- Upsert hde_inventory: increment quantity if row exists, insert if not
    INSERT INTO public.hde_inventory (product_id, location_id, quantity, inventory_type, updated_by)
    VALUES (NEW.product_id, NEW.location_id, v_qty, 'warehouse', NEW.completed_by)
    ON CONFLICT (product_id, location_id)
    DO UPDATE SET
      quantity   = public.hde_inventory.quantity + v_qty,
      updated_by = NEW.completed_by,
      updated_at = now();

    -- Audit log
    INSERT INTO public.inventory_audit_log
      (product_id, action, quantity_change, service_job_id, created_by, reason)
    VALUES (
      NEW.product_id,
      'warehouse_receipt',
      v_qty,
      NEW.id,
      COALESCE(NEW.completed_by, NEW.created_by),
      'Auto-added via warehouse dispatch closure'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hde_company_order_completion ON public.hde_orders;
CREATE TRIGGER trg_hde_company_order_completion
  AFTER UPDATE OF status ON public.hde_orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_hde_company_order_completion();
