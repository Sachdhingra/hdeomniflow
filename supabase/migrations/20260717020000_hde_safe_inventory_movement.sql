
-- Safe inventory movement for hde_inventory
--
-- Problems fixed:
--   1. Showroom-sale completion re-added the SOLD product's qty back onto the
--      showroom row, cancelling the sale deduction (stock inflated).
--   2. All inventory movement ran client-side under the caller's RLS role —
--      field agents (and audit inserts by accounts) silently wrote nothing.
--   3. Company-order completion hardcoded inventory_type='warehouse' even when
--      the destination is a showroom, so later display-row lookups missed it.
--   4. Rejected / cancelled / deleted orders never restored the stock deducted
--      at order creation.
--   5. Deductions were absolute overwrites computed from a stale page snapshot
--      (racy) and normal sale deductions were never audit-logged.
--
-- Design: every movement goes through one SECURITY DEFINER helper that locks
-- the row, applies a delta, derives inventory_type from the location, clamps
-- at zero (recording the clamp), and writes inventory_audit_log. Triggers on
-- hde_orders drive sale deduction, reversal and completion movements so the
-- books stay consistent no matter which role performs the action.

-- ─── 1. Core atomic movement helper ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hde_apply_inventory_delta(
  p_product_id  uuid,
  p_location_id uuid,
  p_delta       integer,
  p_action      text,
  p_actor       uuid,
  p_order_id    uuid DEFAULT NULL,
  p_reason      text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loc_type text;
  v_inv_type text;
  v_old      integer;
  v_new      integer;
  v_applied  integer;
BEGIN
  IF p_product_id IS NULL OR p_location_id IS NULL OR COALESCE(p_delta, 0) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT type INTO v_loc_type FROM public.hde_locations WHERE id = p_location_id;
  v_inv_type := CASE WHEN v_loc_type = 'warehouse' THEN 'warehouse' ELSE 'display' END;

  SELECT quantity INTO v_old
    FROM public.hde_inventory
   WHERE product_id = p_product_id AND location_id = p_location_id
   FOR UPDATE;

  IF NOT FOUND THEN
    v_old := 0;
    INSERT INTO public.hde_inventory (product_id, location_id, quantity, inventory_type, updated_by)
    VALUES (p_product_id, p_location_id, GREATEST(0, p_delta), v_inv_type, p_actor)
    ON CONFLICT (product_id, location_id)
    DO UPDATE SET
      quantity       = GREATEST(0, public.hde_inventory.quantity + p_delta),
      inventory_type = EXCLUDED.inventory_type,
      updated_by     = COALESCE(p_actor, public.hde_inventory.updated_by),
      updated_at     = now()
    RETURNING quantity INTO v_new;
  ELSE
    UPDATE public.hde_inventory
       SET quantity       = GREATEST(0, quantity + p_delta),
           inventory_type = v_inv_type,
           updated_by     = COALESCE(p_actor, updated_by),
           updated_at     = now()
     WHERE product_id = p_product_id AND location_id = p_location_id
    RETURNING quantity INTO v_new;
  END IF;

  v_applied := v_new - v_old;

  -- Always log the movement — including a fully clamped one (applied 0), so
  -- oversells / zero-stock override sales stay visible for reconciliation.
  INSERT INTO public.inventory_audit_log
    (product_id, action, quantity_change, location_id, service_job_id, created_by, reason)
  VALUES (
    p_product_id, p_action, v_applied, p_location_id, p_order_id, p_actor,
    CASE WHEN v_applied <> p_delta
      THEN COALESCE(p_reason || ' ', '') || '[requested ' || p_delta || ', applied ' || v_applied || ' — clamped at 0]'
      ELSE p_reason
    END
  );

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.hde_apply_inventory_delta(uuid, uuid, integer, text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hde_apply_inventory_delta(uuid, uuid, integer, text, uuid, uuid, text) FROM authenticated;

-- ─── 2. Receive Stock RPC (atomic increment + audit, replaces stale upsert) ──

CREATE OR REPLACE FUNCTION public.hde_receive_stock(
  p_product_id  uuid,
  p_location_id uuid,
  p_qty         integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(p_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'Quantity must be at least 1';
  END IF;
  IF NOT (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accounts'::app_role)) THEN
    RAISE EXCEPTION 'Not authorized to receive stock';
  END IF;
  RETURN public.hde_apply_inventory_delta(
    p_product_id, p_location_id, p_qty, 'stock_received', auth.uid(), NULL, 'Stock received');
END;
$$;

GRANT EXECUTE ON FUNCTION public.hde_receive_stock(uuid, uuid, integer) TO authenticated;

-- ─── 3. Sale deduction on order creation (warehouse / showroom sales) ────────

CREATE OR REPLACE FUNCTION public.handle_hde_order_sale_deduction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.order_type IN ('warehouse', 'showroom') AND NEW.location_id IS NOT NULL THEN
    PERFORM public.hde_apply_inventory_delta(
      NEW.product_id, NEW.location_id,
      -GREATEST(1, COALESCE(NEW.qty_sold, 1)),
      'sale_deduction', NEW.created_by, NEW.id,
      'Sold via ' || NEW.order_type || ' — order ' || NEW.order_number);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hde_order_sale_deduction ON public.hde_orders;
CREATE TRIGGER trg_hde_order_sale_deduction
  AFTER INSERT ON public.hde_orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_hde_order_sale_deduction();

-- ─── 4. Status-change movements: reversal + showroom completion ──────────────

CREATE OR REPLACE FUNCTION public.handle_hde_order_status_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deducted integer;
  v_qty      integer;
  v_rids     uuid[];
  v_rid      uuid;
  v_wh_loc   uuid;
BEGIN
  -- 4a. Restore stock when an unfulfilled sale is rejected or cancelled.
  --     Restores exactly what the sale_deduction audit entry says was applied,
  --     so a clamped deduction never creates phantom stock on reversal.
  IF NEW.order_type IN ('warehouse', 'showroom')
     AND NEW.status IN ('rejected', 'cancelled')
     AND OLD.status NOT IN ('rejected', 'cancelled', 'completed')
     AND NEW.location_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.inventory_audit_log
        WHERE service_job_id = NEW.id AND action IN ('sale_reversal', 'sale_reversal_on_delete'))
  THEN
    SELECT -quantity_change INTO v_deducted
      FROM public.inventory_audit_log
     WHERE service_job_id = NEW.id AND action = 'sale_deduction'
     ORDER BY created_at LIMIT 1;

    IF COALESCE(v_deducted, 0) > 0 THEN
      PERFORM public.hde_apply_inventory_delta(
        NEW.product_id, NEW.location_id, v_deducted,
        'sale_reversal', COALESCE(NEW.rejected_by, NEW.created_by), NEW.id,
        'Order ' || NEW.order_number || ' ' || NEW.status || ' — stock restored');
    END IF;
  END IF;

  -- 4b. Showroom sale completed: pull each replacement from the warehouse with
  --     the most stock and put it on display at the showroom. The SOLD product
  --     is NOT touched here — its deduction already happened at order creation.
  IF NEW.order_type = 'showroom'
     AND NEW.status = 'completed'
     AND OLD.status IS DISTINCT FROM 'completed'
     AND NEW.location_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.inventory_audit_log
        WHERE service_job_id = NEW.id AND action = 'replacement_display_receipt')
  THEN
    -- Resolve replacement product IDs via the 3-layer fallback
    v_rids := COALESCE(NEW.replacement_product_ids, '{}'::uuid[]);
    IF (array_length(v_rids, 1) IS NULL) AND NEW.custom_specs LIKE '%_rids%' THEN
      BEGIN
        SELECT array_agg(j::uuid) INTO v_rids
          FROM jsonb_array_elements_text((NEW.custom_specs::jsonb) -> '_rids') j;
      EXCEPTION WHEN others THEN
        v_rids := '{}'::uuid[];
      END;
    END IF;
    IF (array_length(v_rids, 1) IS NULL) AND NEW.replacement_product_id IS NOT NULL THEN
      v_rids := ARRAY[NEW.replacement_product_id];
    END IF;

    v_qty := GREATEST(1, COALESCE(NEW.qty_sold, 1));

    IF array_length(v_rids, 1) > 0 THEN
      FOREACH v_rid IN ARRAY v_rids LOOP
        SELECT i.location_id INTO v_wh_loc
          FROM public.hde_inventory i
          JOIN public.hde_locations l ON l.id = i.location_id AND l.type = 'warehouse'
         WHERE i.product_id = v_rid AND i.quantity > 0
         ORDER BY i.quantity DESC
         LIMIT 1;

        IF v_wh_loc IS NOT NULL THEN
          PERFORM public.hde_apply_inventory_delta(
            v_rid, v_wh_loc, -v_qty,
            'replacement_warehouse_deduction', COALESCE(NEW.completed_by, NEW.created_by), NEW.id,
            'Replacement dispatched for order ' || NEW.order_number);
        END IF;

        PERFORM public.hde_apply_inventory_delta(
          v_rid, NEW.location_id, v_qty,
          'replacement_display_receipt', COALESCE(NEW.completed_by, NEW.created_by), NEW.id,
          'Replacement put on display for order ' || NEW.order_number);

        v_wh_loc := NULL;
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hde_order_status_movement ON public.hde_orders;
CREATE TRIGGER trg_hde_order_status_movement
  AFTER UPDATE OF status ON public.hde_orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_hde_order_status_movement();

-- ─── 5. Restore stock when an unfulfilled sale order is deleted ──────────────

CREATE OR REPLACE FUNCTION public.handle_hde_order_delete_restore()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deducted integer;
BEGIN
  IF OLD.order_type IN ('warehouse', 'showroom')
     AND OLD.status NOT IN ('completed', 'rejected', 'cancelled')
     AND OLD.location_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.inventory_audit_log
        WHERE service_job_id = OLD.id AND action IN ('sale_reversal', 'sale_reversal_on_delete'))
  THEN
    SELECT -quantity_change INTO v_deducted
      FROM public.inventory_audit_log
     WHERE service_job_id = OLD.id AND action = 'sale_deduction'
     ORDER BY created_at LIMIT 1;

    IF COALESCE(v_deducted, 0) > 0 THEN
      PERFORM public.hde_apply_inventory_delta(
        OLD.product_id, OLD.location_id, v_deducted,
        'sale_reversal_on_delete', auth.uid(), OLD.id,
        'Order ' || OLD.order_number || ' deleted before fulfilment — stock restored');
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_hde_order_delete_restore ON public.hde_orders;
CREATE TRIGGER trg_hde_order_delete_restore
  BEFORE DELETE ON public.hde_orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_hde_order_delete_restore();

-- ─── 6. Company (warehouse-request) completion: correct inventory_type ───────

CREATE OR REPLACE FUNCTION public.handle_hde_company_order_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.order_type = 'company'
     AND NEW.status = 'completed'
     AND OLD.status IS DISTINCT FROM 'completed'
     AND NEW.location_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.inventory_audit_log
        WHERE service_job_id = NEW.id AND action = 'warehouse_receipt')
  THEN
    PERFORM public.hde_apply_inventory_delta(
      NEW.product_id, NEW.location_id,
      GREATEST(1, COALESCE(NEW.qty_sold, 1)),
      'warehouse_receipt', COALESCE(NEW.completed_by, NEW.created_by), NEW.id,
      'Received via warehouse request ' || NEW.order_number);
  END IF;
  RETURN NEW;
END;
$$;

-- (trigger trg_hde_company_order_completion already exists and now uses the
--  replaced function body above)

-- ─── 7. Data repair: fix inventory_type mismatched with its location type ────

UPDATE public.hde_inventory i
   SET inventory_type = CASE WHEN l.type = 'warehouse' THEN 'warehouse' ELSE 'display' END
  FROM public.hde_locations l
 WHERE l.id = i.location_id
   AND i.inventory_type <> CASE WHEN l.type = 'warehouse' THEN 'warehouse' ELSE 'display' END;

-- ─── 8. Widen audit-log RLS so every inventory-managing role is recorded ─────
-- (accounts/site_agent/service_head audit inserts previously failed silently)

DROP POLICY IF EXISTS "inv_audit_insert" ON public.inventory_audit_log;
CREATE POLICY "inv_audit_insert" ON public.inventory_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'sales'::app_role) OR
    has_role(auth.uid(), 'accounts'::app_role) OR has_role(auth.uid(), 'site_agent'::app_role) OR
    has_role(auth.uid(), 'service_head'::app_role) OR has_role(auth.uid(), 'field_agent'::app_role)
  );

DROP POLICY IF EXISTS "inv_audit_select" ON public.inventory_audit_log;
CREATE POLICY "inv_audit_select" ON public.inventory_audit_log
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'sales'::app_role) OR
    has_role(auth.uid(), 'accounts'::app_role) OR has_role(auth.uid(), 'service_head'::app_role)
  );
