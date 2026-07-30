-- 1. Multi-replacement support
ALTER TABLE public.hde_orders ADD COLUMN IF NOT EXISTS replacement_product_ids uuid[];

-- 2. Audit log gets an order reference (idempotency + traceability)
ALTER TABLE public.inventory_audit_log ADD COLUMN IF NOT EXISTS order_id uuid;
CREATE INDEX IF NOT EXISTS idx_inv_audit_order ON public.inventory_audit_log(order_id) WHERE order_id IS NOT NULL;

GRANT SELECT, INSERT ON public.inventory_audit_log TO authenticated;
GRANT ALL ON public.inventory_audit_log TO service_role;

-- Helper: apply a delta at a location, creating the row if needed
CREATE OR REPLACE FUNCTION public.fn_hde_apply_stock(
  _product uuid, _location uuid, _delta int, _by uuid,
  _action text, _order uuid, _reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_type text;
  v_id uuid;
  v_qty int;
BEGIN
  IF _product IS NULL OR _location IS NULL OR COALESCE(_delta,0) = 0 THEN RETURN; END IF;

  SELECT CASE WHEN type = 'showroom' THEN 'display' ELSE 'warehouse' END
    INTO v_type FROM public.hde_locations WHERE id = _location;
  IF v_type IS NULL THEN RETURN; END IF;

  SELECT id, quantity INTO v_id, v_qty
    FROM public.hde_inventory WHERE product_id = _product AND location_id = _location;

  IF v_id IS NULL THEN
    INSERT INTO public.hde_inventory (product_id, location_id, quantity, inventory_type, updated_by)
    VALUES (_product, _location, GREATEST(0, _delta), v_type, _by);
  ELSE
    UPDATE public.hde_inventory
       SET quantity = GREATEST(0, COALESCE(v_qty,0) + _delta),
           updated_at = now(),
           updated_by = COALESCE(_by, updated_by)
     WHERE id = v_id;
  END IF;

  INSERT INTO public.inventory_audit_log (product_id, action, quantity_change, location_id, created_by, order_id, reason)
  VALUES (_product, _action, _delta, _location, _by, _order, _reason);
END;
$$;

-- 3. Deduct stock when a warehouse/showroom sale order is created
CREATE OR REPLACE FUNCTION public.fn_hde_order_sale_deduction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.order_type NOT IN ('warehouse','showroom') THEN RETURN NEW; END IF;
  IF NEW.location_id IS NULL OR NEW.product_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IN ('rejected','cancelled') THEN RETURN NEW; END IF;

  PERFORM public.fn_hde_apply_stock(
    NEW.product_id, NEW.location_id, -GREATEST(1, COALESCE(NEW.qty_sold,1)),
    NEW.created_by, 'order_sale', NEW.id,
    'Auto-deducted on order ' || NEW.order_number);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hde_order_sale_deduction ON public.hde_orders;
CREATE TRIGGER trg_hde_order_sale_deduction
AFTER INSERT ON public.hde_orders
FOR EACH ROW EXECUTE FUNCTION public.fn_hde_order_sale_deduction();

-- 4. Restore stock if the order is rejected/cancelled before fulfilment
CREATE OR REPLACE FUNCTION public.fn_hde_order_sale_restore()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.order_type NOT IN ('warehouse','showroom') THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('rejected','cancelled') THEN RETURN NEW; END IF;
  IF OLD.status IN ('rejected','cancelled','completed') THEN RETURN NEW; END IF;

  -- only restore what was actually deducted, and only once
  IF NOT EXISTS (SELECT 1 FROM public.inventory_audit_log
                  WHERE order_id = NEW.id AND action = 'order_sale') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_audit_log
              WHERE order_id = NEW.id AND action = 'order_sale_restore') THEN
    RETURN NEW;
  END IF;

  PERFORM public.fn_hde_apply_stock(
    NEW.product_id, NEW.location_id, GREATEST(1, COALESCE(NEW.qty_sold,1)),
    COALESCE(NEW.rejected_by, NEW.completed_by, NEW.created_by),
    'order_sale_restore', NEW.id,
    'Stock restored — order ' || NEW.order_number || ' ' || NEW.status);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hde_order_sale_restore ON public.hde_orders;
CREATE TRIGGER trg_hde_order_sale_restore
AFTER UPDATE OF status ON public.hde_orders
FOR EACH ROW EXECUTE FUNCTION public.fn_hde_order_sale_restore();

-- 5. Completion movement: company receipts + showroom replacements
CREATE OR REPLACE FUNCTION public.fn_hde_order_completion_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_loc uuid;
  v_src uuid;
  rep uuid;
  reps uuid[];
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_audit_log
              WHERE order_id = NEW.id
                AND action IN ('order_company_receipt','order_display_replacement')) THEN
    RETURN NEW;
  END IF;

  IF NEW.order_type = 'company' THEN
    v_loc := NEW.location_id;
    IF v_loc IS NULL THEN
      SELECT id INTO v_loc FROM public.hde_locations
       WHERE type = 'warehouse' AND COALESCE(is_active,true) ORDER BY created_at LIMIT 1;
    END IF;
    PERFORM public.fn_hde_apply_stock(
      NEW.product_id, v_loc, GREATEST(1, COALESCE(NEW.qty_sold,1)), NEW.completed_by,
      'order_company_receipt', NEW.id,
      'Company order ' || NEW.order_number || ' received');
    RETURN NEW;
  END IF;

  IF NEW.order_type = 'showroom' THEN
    reps := COALESCE(NEW.replacement_product_ids,
                     CASE WHEN NEW.replacement_product_id IS NULL
                          THEN ARRAY[]::uuid[] ELSE ARRAY[NEW.replacement_product_id] END);
    IF NEW.location_id IS NULL THEN RETURN NEW; END IF;

    FOREACH rep IN ARRAY reps LOOP
      -- pull from the warehouse location holding the most stock (if any)
      SELECT i.location_id INTO v_src
        FROM public.hde_inventory i
        JOIN public.hde_locations l ON l.id = i.location_id
       WHERE i.product_id = rep AND l.type = 'warehouse' AND i.quantity > 0
       ORDER BY i.quantity DESC LIMIT 1;

      IF v_src IS NOT NULL THEN
        PERFORM public.fn_hde_apply_stock(rep, v_src, -1, NEW.completed_by,
          'order_display_replacement', NEW.id,
          'Moved to display for order ' || NEW.order_number);
      END IF;

      PERFORM public.fn_hde_apply_stock(rep, NEW.location_id, 1, NEW.completed_by,
        'order_display_replacement', NEW.id,
        'Placed on display — order ' || NEW.order_number);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hde_company_order_completion ON public.hde_orders;
DROP TRIGGER IF EXISTS trg_hde_order_status_movement ON public.hde_orders;
CREATE TRIGGER trg_hde_order_status_movement
AFTER UPDATE OF status ON public.hde_orders
FOR EACH ROW EXECUTE FUNCTION public.fn_hde_order_completion_movement();