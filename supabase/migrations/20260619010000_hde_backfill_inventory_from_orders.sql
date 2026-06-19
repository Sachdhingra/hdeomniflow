
-- One-time backfill: reconcile hde_inventory for all hde_orders completed
-- before the DB trigger (trg_hde_company_order_completion) was in place.
--
-- Strategy by order type:
--   company  → UPSERT (increment) — app code didn't exist before, safe to add
--   showroom → INSERT ON CONFLICT DO NOTHING — app code may have already run
--   warehouse → sold outbound, no inbound inventory effect
--
-- Idempotent: each order is skipped if inventory_audit_log already has an entry
-- for it (service_job_id = order.id + action-specific guard).

DO $$
DECLARE
  r        RECORD;
  v_qty    integer;
  v_rids   uuid[];
  v_rid    uuid;
BEGIN

  -- ── 1. Company orders (warehouse requests delivered to showroom) ─────────────
  -- Safe to increment: the company-order branch of handleComplete was only added
  -- today; completed orders before that have no inventory entry.
  FOR r IN
    SELECT o.*
    FROM public.hde_orders o
    WHERE o.status = 'completed'
      AND o.order_type = 'company'
      AND o.location_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.inventory_audit_log al
         WHERE al.service_job_id = o.id
           AND al.action = 'warehouse_receipt'
      )
    ORDER BY o.completed_at
  LOOP
    v_qty := COALESCE(r.qty_sold, 1);

    INSERT INTO public.hde_inventory
      (product_id, location_id, quantity, inventory_type, updated_by)
    VALUES
      (r.product_id, r.location_id, v_qty, 'warehouse', r.completed_by)
    ON CONFLICT (product_id, location_id)
    DO UPDATE SET
      quantity   = public.hde_inventory.quantity + v_qty,
      updated_by = r.completed_by,
      updated_at = now();

    INSERT INTO public.inventory_audit_log
      (product_id, action, quantity_change, service_job_id, created_by, reason)
    VALUES (
      r.product_id,
      'warehouse_receipt',
      v_qty,
      r.id,
      COALESCE(r.completed_by, r.created_by),
      'Backfill: ' || r.order_number
    );
  END LOOP;

  -- ── 2. Showroom replacement orders (display swap completed) ──────────────────
  -- App-level code may have already shifted warehouse→showroom for some rows.
  -- Use ON CONFLICT DO NOTHING so we only fill genuine gaps, never double-count.
  FOR r IN
    SELECT o.*
    FROM public.hde_orders o
    WHERE o.status = 'completed'
      AND o.order_type = 'showroom'
      AND o.location_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.inventory_audit_log al
         WHERE al.service_job_id = o.id
           AND al.action = 'showroom_replacement_installed'
      )
    ORDER BY o.completed_at
  LOOP
    -- Resolve replacement product IDs via 3-layer fallback
    v_rids := COALESCE(r.replacement_product_ids, '{}'::uuid[]);

    -- Layer 2: custom_specs JSON {"_rids": ["uuid",…]}
    IF (array_length(v_rids, 1) IS NULL OR array_length(v_rids, 1) = 0)
       AND r.custom_specs LIKE '%_rids%'
    THEN
      BEGIN
        SELECT array_agg(j::uuid)
          INTO v_rids
          FROM jsonb_array_elements_text((r.custom_specs::jsonb) -> '_rids') j;
      EXCEPTION WHEN others THEN
        v_rids := '{}'::uuid[];
      END;
    END IF;

    -- Layer 3: single FK column
    IF (array_length(v_rids, 1) IS NULL OR array_length(v_rids, 1) = 0)
       AND r.replacement_product_id IS NOT NULL
    THEN
      v_rids := ARRAY[r.replacement_product_id];
    END IF;

    IF array_length(v_rids, 1) > 0 THEN
      FOREACH v_rid IN ARRAY v_rids LOOP
        -- DO NOTHING if row already exists (app code handled it)
        INSERT INTO public.hde_inventory
          (product_id, location_id, quantity, inventory_type, updated_by)
        VALUES
          (v_rid, r.location_id, 1, 'display', r.completed_by)
        ON CONFLICT (product_id, location_id) DO NOTHING;
      END LOOP;

      INSERT INTO public.inventory_audit_log
        (product_id, action, quantity_change, service_job_id, created_by, reason)
      VALUES (
        r.product_id,
        'showroom_replacement_installed',
        1,
        r.id,
        COALESCE(r.completed_by, r.created_by),
        'Backfill: ' || r.order_number
      );
    END IF;
  END LOOP;

END $$;
