
-- Reconcile inventory for closed/completed orders that never reflected.
--
-- Root cause: trg_hde_company_order_completion is only CREATEd in migration
-- 20260619000000. The safe-movement migration (20260717020000) replaced the
-- trigger FUNCTION but assumed the trigger itself already existed on the live
-- database. If 20260619000000 was never applied manually, completing a
-- company (warehouse-request) order fired nothing — stock never arrived.
-- Additional gaps: showroom completions whose client-side movement silently
-- failed (RLS), and company orders completed with no delivery location.
--
-- This migration is idempotent and safe to re-run.

-- ─── 1. Ensure the company completion trigger actually exists ────────────────

DROP TRIGGER IF EXISTS trg_hde_company_order_completion ON public.hde_orders;
CREATE TRIGGER trg_hde_company_order_completion
  AFTER UPDATE OF status ON public.hde_orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_hde_company_order_completion();

-- ─── 2. Backfill completed company orders that never received stock ──────────
-- The old trigger and both backfills always wrote a 'warehouse_receipt' audit
-- entry, so its absence reliably means the receipt never happened.

DO $do$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT o.*
      FROM public.hde_orders o
     WHERE o.order_type = 'company'
       AND o.status = 'completed'
       AND o.location_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.inventory_audit_log al
          WHERE al.service_job_id = o.id AND al.action = 'warehouse_receipt')
     ORDER BY o.completed_at NULLS LAST
  LOOP
    PERFORM public.hde_apply_inventory_delta(
      r.product_id, r.location_id,
      GREATEST(1, COALESCE(r.qty_sold, 1)),
      'warehouse_receipt', COALESCE(r.completed_by, r.created_by), r.id,
      'Backfill: completed warehouse request ' || r.order_number || ' had no receipt');
  END LOOP;
END;
$do$;

-- ─── 3. Conservative backfill for completed showroom orders ──────────────────
-- For completed showroom orders with no replacement movement on record, ensure
-- each replacement product at least has a display row at the showroom. Uses
-- ON CONFLICT DO NOTHING (create-if-missing, never increment) because some of
-- these may have been moved client-side without an audit entry — incrementing
-- blindly would double-count. Warehouse-side deduction is NOT attempted for
-- the same reason; use Stock Count to true up warehouse quantities.

DO $do$
DECLARE
  r      RECORD;
  v_rids uuid[];
  v_rid  uuid;
  v_qty  integer;
  v_ins  integer;
BEGIN
  FOR r IN
    SELECT o.*
      FROM public.hde_orders o
     WHERE o.order_type = 'showroom'
       AND o.status = 'completed'
       AND o.location_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.inventory_audit_log al
          WHERE al.service_job_id = o.id
            AND al.action IN ('replacement_display_receipt', 'showroom_replacement_installed'))
     ORDER BY o.completed_at NULLS LAST
  LOOP
    v_rids := COALESCE(r.replacement_product_ids, '{}'::uuid[]);
    IF (array_length(v_rids, 1) IS NULL) AND r.custom_specs LIKE '%_rids%' THEN
      BEGIN
        SELECT array_agg(j::uuid) INTO v_rids
          FROM jsonb_array_elements_text((r.custom_specs::jsonb) -> '_rids') j;
      EXCEPTION WHEN others THEN
        v_rids := '{}'::uuid[];
      END;
    END IF;
    IF (array_length(v_rids, 1) IS NULL) AND r.replacement_product_id IS NOT NULL THEN
      v_rids := ARRAY[r.replacement_product_id];
    END IF;

    v_qty := GREATEST(1, COALESCE(r.qty_sold, 1));

    IF array_length(v_rids, 1) > 0 THEN
      FOREACH v_rid IN ARRAY v_rids LOOP
        INSERT INTO public.hde_inventory
          (product_id, location_id, quantity, inventory_type, updated_by)
        VALUES
          (v_rid, r.location_id, v_qty, 'display', COALESCE(r.completed_by, r.created_by))
        ON CONFLICT (product_id, location_id) DO NOTHING;
        GET DIAGNOSTICS v_ins = ROW_COUNT;

        IF v_ins > 0 THEN
          INSERT INTO public.inventory_audit_log
            (product_id, action, quantity_change, location_id, service_job_id, created_by, reason)
          VALUES (
            v_rid, 'showroom_replacement_installed', v_qty, r.location_id, r.id,
            COALESCE(r.completed_by, r.created_by),
            'Backfill: display row created for completed order ' || r.order_number);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END;
$do$;

-- ─── 4. Report: completed company orders with NO delivery location ───────────
-- Their stock arrived somewhere physically but is tracked nowhere. Run this
-- SELECT to see them, then for each one either add the stock to the right
-- location with:
--   SELECT public.hde_apply_inventory_delta('<product-id>','<location-id>',
--     <qty>, 'warehouse_receipt', NULL, '<order-id>',
--     'Manual receipt: order had no delivery location');
-- or ignore it if the item was delivered straight to a customer.

-- SELECT o.order_number, p.product_name, p.sku, o.qty_sold,
--        o.completed_at, pr.name AS completed_by
--   FROM public.hde_orders o
--   LEFT JOIN public.products p ON p.id = o.product_id
--   LEFT JOIN public.profiles pr ON pr.id = o.completed_by
--  WHERE o.order_type = 'company'
--    AND o.status = 'completed'
--    AND o.location_id IS NULL
--  ORDER BY o.completed_at DESC;
