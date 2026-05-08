-- 1. Categories: replace full unique on name with partial unique (active rows only)
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_name_key;
DROP INDEX IF EXISTS public.categories_name_key;
CREATE UNIQUE INDEX categories_name_active_unique
  ON public.categories (lower(name))
  WHERE deleted_at IS NULL;

-- 2. Products: replace full unique on sku with partial unique (active rows only)
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_sku_key;
DROP INDEX IF EXISTS public.products_sku_key;
CREATE UNIQUE INDEX products_sku_active_unique
  ON public.products (sku)
  WHERE deleted_at IS NULL;

-- 3. Cascade soft-delete: when a category is soft-deleted, soft-delete its products
CREATE OR REPLACE FUNCTION public.cascade_soft_delete_category_products()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    UPDATE public.products
       SET deleted_at = NEW.deleted_at,
           status = 'inactive',
           updated_at = now()
     WHERE category_id = NEW.id
       AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_soft_delete_category_products ON public.categories;
CREATE TRIGGER trg_cascade_soft_delete_category_products
AFTER UPDATE OF deleted_at ON public.categories
FOR EACH ROW
EXECUTE FUNCTION public.cascade_soft_delete_category_products();

-- 4. Backfill: soft-delete products belonging to already-deleted categories
UPDATE public.products p
   SET deleted_at = c.deleted_at,
       status = 'inactive',
       updated_at = now()
  FROM public.categories c
 WHERE p.category_id = c.id
   AND c.deleted_at IS NOT NULL
   AND p.deleted_at IS NULL;