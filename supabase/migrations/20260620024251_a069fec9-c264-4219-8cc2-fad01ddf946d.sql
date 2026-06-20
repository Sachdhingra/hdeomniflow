-- Backfill display inventory from already-completed showroom orders.
-- Idempotent: only fills when no row exists, or when an existing display row has quantity 0.
DO $$
DECLARE
  o RECORD;
  pid uuid;
  all_ids uuid[];
  qty int;
  existing_qty int;
  existing_id uuid;
  rid uuid;
  spec_ids uuid[];
BEGIN
  FOR o IN
    SELECT id, product_id, replacement_product_id, location_id, qty_sold, custom_specs
    FROM public.hde_orders
    WHERE status = 'completed'
      AND order_type = 'showroom'
      AND location_id IS NOT NULL
  LOOP
    all_ids := ARRAY[]::uuid[];
    IF o.product_id IS NOT NULL THEN all_ids := all_ids || o.product_id; END IF;
    IF o.replacement_product_id IS NOT NULL THEN all_ids := all_ids || o.replacement_product_id; END IF;

    -- Parse JSON _rids fallback list
    BEGIN
      IF o.custom_specs IS NOT NULL AND o.custom_specs LIKE '{%' THEN
        SELECT ARRAY(SELECT (jsonb_array_elements_text((o.custom_specs::jsonb)->'_rids'))::uuid)
          INTO spec_ids;
        IF spec_ids IS NOT NULL THEN
          all_ids := all_ids || spec_ids;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    qty := GREATEST(1, COALESCE(o.qty_sold, 1));

    FOR pid IN SELECT DISTINCT unnest(all_ids) LOOP
      SELECT id, quantity INTO existing_id, existing_qty
        FROM public.hde_inventory
       WHERE product_id = pid
         AND location_id = o.location_id
         AND inventory_type = 'display'
       LIMIT 1;

      IF existing_id IS NOT NULL THEN
        IF COALESCE(existing_qty, 0) = 0 THEN
          UPDATE public.hde_inventory
             SET quantity = qty, updated_at = now()
           WHERE id = existing_id;
        END IF;
      ELSE
        INSERT INTO public.hde_inventory (product_id, location_id, quantity, inventory_type)
        VALUES (pid, o.location_id, qty, 'display');
      END IF;
    END LOOP;
  END LOOP;
END $$;