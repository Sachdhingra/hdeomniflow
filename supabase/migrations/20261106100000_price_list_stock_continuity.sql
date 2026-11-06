-- Price-list re-uploads must update articles in place, and stock must never be
-- orphaned or wiped when a price list is replaced.
--
-- Background (what was going wrong):
--   1. Bulk upload always INSERTed. When a SKU already existed it appended _1, _2 …,
--      so re-uploading a price list created duplicate articles with zero stock.
--   2. Stock (hde_inventory) is keyed by products.id. Any product that was recreated
--      (new id) lost its stock link, so the old stock sat on an orphaned id.
--   3. categories.name was UNIQUE across soft-deleted rows, so a deleted category
--      could not be re-created under the same name. That forced delete-and-recreate.
--   4. hde_inventory.product_id cascaded on hard delete, so deleting a product or a
--      category with a hard delete silently destroyed its stock.
--
-- This migration is idempotent.

-- ─── 1. Category names unique among live categories only ────────────────────
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS categories_name_live_key
  ON public.categories (name) WHERE deleted_at IS NULL;

-- ─── 2. Stock blocks hard deletes instead of being wiped by them ────────────
-- A product (or a category, through products.category_id) with stock can no longer
-- be hard-deleted. Soft delete (deleted_at) remains the way to retire an article.
ALTER TABLE public.hde_inventory DROP CONSTRAINT IF EXISTS hde_inventory_product_id_fkey;
ALTER TABLE public.hde_inventory
  ADD CONSTRAINT hde_inventory_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;

-- ─── 3. Move stock from one article to another (admin only) ─────────────────
-- Used to rescue stock that sits on a duplicate or retired article. Quantities are
-- merged per location, the audit trail records every move, and nothing is deleted
-- from products.
CREATE OR REPLACE FUNCTION public.hde_move_stock(_from uuid, _to uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_moved integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can move stock';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _from = _to THEN
    RAISE EXCEPTION 'Choose two different articles';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = _to AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Target article is deleted or does not exist';
  END IF;

  FOR r IN SELECT * FROM public.hde_inventory WHERE product_id = _from LOOP
    UPDATE public.hde_inventory t
       SET quantity = t.quantity + r.quantity,
           updated_at = now(),
           updated_by = auth.uid()
     WHERE t.product_id = _to AND t.location_id = r.location_id;

    IF FOUND THEN
      DELETE FROM public.hde_inventory WHERE id = r.id;
    ELSE
      UPDATE public.hde_inventory
         SET product_id = _to, updated_at = now(), updated_by = auth.uid()
       WHERE id = r.id;
    END IF;

    INSERT INTO public.inventory_audit_log
      (product_id, action, quantity_change, location_id, created_by, reason)
    VALUES
      (_to, 'stock_relink', r.quantity, r.location_id, auth.uid(),
       'Stock moved from article ' || _from::text || ' to ' || _to::text);

    v_moved := v_moved + r.quantity;
  END LOOP;

  RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.hde_move_stock(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hde_move_stock(uuid, uuid) TO authenticated;

-- ─── 4. Fold _N duplicates created by the old importer into their base article ─
-- For each live article whose SKU ends in _<digits> and whose base SKU
-- (without the suffix) is another live article, the stock moves to the base
-- article and the duplicate is soft-deleted (status inactive, deleted_at set).
-- Run with _dry_run = true first to review the list.
--
-- Recommended order: re-upload the current price list first (the importer now
-- updates base SKUs in place, so the base article gets the new prices), then run
-- this function with _dry_run = false.
CREATE OR REPLACE FUNCTION public.hde_merge_suffixed_duplicates(_dry_run boolean DEFAULT true)
RETURNS TABLE (duplicate_sku text, canonical_sku text, stock_units integer, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d record;
  v_base_id uuid;
  v_base_sku text;
  v_units integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can merge articles';
  END IF;

  FOR d IN
    SELECT p.id, p.sku
      FROM public.products p
     WHERE p.deleted_at IS NULL
       AND p.sku ~ '_[0-9]+$'
     ORDER BY p.sku
  LOOP
    v_base_sku := regexp_replace(d.sku, '_[0-9]+$', '');

    SELECT b.id INTO v_base_id
      FROM public.products b
     WHERE b.sku = v_base_sku AND b.deleted_at IS NULL AND b.id <> d.id
     LIMIT 1;

    IF v_base_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(i.quantity), 0)::integer INTO v_units
      FROM public.hde_inventory i WHERE i.product_id = d.id;

    duplicate_sku := d.sku;
    canonical_sku := v_base_sku;
    stock_units := v_units;

    IF _dry_run THEN
      action := 'would merge';
    ELSE
      IF v_units > 0 THEN
        PERFORM public.hde_move_stock(d.id, v_base_id);
      END IF;
      UPDATE public.products
         SET deleted_at = now(), status = 'inactive', updated_at = now()
       WHERE id = d.id;
      action := 'merged';
    END IF;

    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.hde_merge_suffixed_duplicates(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hde_merge_suffixed_duplicates(boolean) TO authenticated;

-- ─── 5. Review view: stock that is not on a live, active article ─────────────
-- Shows stock sitting on deleted, inactive, or missing articles, plus the live
-- article it most likely belongs to (same SKU, or the base SKU without _N).
CREATE OR REPLACE VIEW public.hde_stock_link_health
WITH (security_invoker = true) AS
SELECT
  i.product_id,
  p.sku,
  p.product_name,
  p.status,
  (p.id IS NULL) AS is_missing,
  (p.deleted_at IS NOT NULL) AS is_deleted,
  SUM(i.quantity)::integer AS total_qty,
  s.id AS suggested_product_id,
  s.sku AS suggested_sku
FROM public.hde_inventory i
LEFT JOIN public.products p ON p.id = i.product_id
LEFT JOIN LATERAL (
  SELECT q.id, q.sku
    FROM public.products q
   WHERE q.deleted_at IS NULL
     AND q.id <> i.product_id
     AND regexp_replace(q.sku, '_[0-9]+$', '') = regexp_replace(COALESCE(p.sku, ''), '_[0-9]+$', '')
   ORDER BY (q.sku = COALESCE(p.sku, '')) DESC, q.sku
   LIMIT 1
) s ON true
WHERE p.id IS NULL
   OR p.deleted_at IS NOT NULL
   OR p.status <> 'active'
   OR p.sku ~ '_[0-9]+$'
GROUP BY i.product_id, p.id, p.sku, p.product_name, p.status, p.deleted_at, s.id, s.sku;

GRANT SELECT ON public.hde_stock_link_health TO authenticated;
