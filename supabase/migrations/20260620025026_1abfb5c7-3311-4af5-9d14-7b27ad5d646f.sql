-- Fix: hde_inventory is unique on (product_id, location_id) regardless of inventory_type.
-- Lookup must match that, otherwise inserts collide. Also infer inventory_type from
-- the destination location.
CREATE OR REPLACE FUNCTION public.handle_hde_company_order_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loc uuid;
  v_loc_type text;
  v_qty int;
  v_existing_id uuid;
  v_existing_qty int;
BEGIN
  IF NEW.order_type <> 'company' THEN RETURN NEW; END IF;
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NEW; END IF;
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;

  v_loc := NEW.location_id;
  IF v_loc IS NULL THEN
    SELECT id INTO v_loc FROM public.hde_locations
     WHERE type = 'warehouse' AND COALESCE(is_active, true) = true
     ORDER BY created_at LIMIT 1;
  END IF;
  IF v_loc IS NULL THEN RETURN NEW; END IF;

  SELECT type INTO v_loc_type FROM public.hde_locations WHERE id = v_loc;
  v_qty := GREATEST(1, COALESCE(NEW.qty_sold, 1));

  SELECT id, quantity INTO v_existing_id, v_existing_qty
    FROM public.hde_inventory
   WHERE product_id = NEW.product_id AND location_id = v_loc
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.hde_inventory
       SET quantity = COALESCE(v_existing_qty, 0) + v_qty,
           updated_at = now(),
           updated_by = COALESCE(NEW.completed_by, updated_by)
     WHERE id = v_existing_id;
  ELSE
    INSERT INTO public.hde_inventory (product_id, location_id, quantity, inventory_type, updated_by)
    VALUES (NEW.product_id, v_loc, v_qty,
            CASE WHEN v_loc_type = 'showroom' THEN 'display' ELSE 'warehouse' END,
            NEW.completed_by);
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill (re-run with the corrected lookup)
DO $$
DECLARE
  o RECORD;
  v_loc uuid;
  v_loc_type text;
  v_qty int;
  v_existing_id uuid;
  v_existing_qty int;
  v_default_wh uuid;
BEGIN
  SELECT id INTO v_default_wh FROM public.hde_locations
   WHERE type = 'warehouse' AND COALESCE(is_active, true) = true
   ORDER BY created_at LIMIT 1;

  FOR o IN
    SELECT id, product_id, location_id, qty_sold, completed_by
      FROM public.hde_orders
     WHERE status = 'completed'
       AND order_type = 'company'
       AND product_id IS NOT NULL
  LOOP
    v_loc := COALESCE(o.location_id, v_default_wh);
    IF v_loc IS NULL THEN CONTINUE; END IF;
    SELECT type INTO v_loc_type FROM public.hde_locations WHERE id = v_loc;
    v_qty := GREATEST(1, COALESCE(o.qty_sold, 1));

    SELECT id, quantity INTO v_existing_id, v_existing_qty
      FROM public.hde_inventory
     WHERE product_id = o.product_id AND location_id = v_loc
     LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      UPDATE public.hde_inventory
         SET quantity = COALESCE(v_existing_qty, 0) + v_qty,
             updated_at = now(),
             updated_by = COALESCE(o.completed_by, updated_by)
       WHERE id = v_existing_id;
    ELSE
      INSERT INTO public.hde_inventory (product_id, location_id, quantity, inventory_type, updated_by)
      VALUES (o.product_id, v_loc, v_qty,
              CASE WHEN v_loc_type = 'showroom' THEN 'display' ELSE 'warehouse' END,
              o.completed_by);
    END IF;
  END LOOP;
END $$;