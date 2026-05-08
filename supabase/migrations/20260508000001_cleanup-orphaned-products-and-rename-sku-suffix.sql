-- Step 1: Soft-delete all active products that have no visible category.
-- This covers:
--   (a) products where category_id is NULL
--   (b) products whose category was soft-deleted (deleted_at IS NOT NULL),
--       which made them appear as "—" in the product list.
UPDATE public.products
SET deleted_at = now(),
    status     = 'inactive',
    updated_at = now()
WHERE deleted_at IS NULL
  AND (
        category_id IS NULL
        OR category_id IN (
              SELECT id FROM public.categories WHERE deleted_at IS NOT NULL
           )
      );

-- Step 2: Strip the trailing _2 suffix from SKUs now that the conflicting
-- base-SKU rows have been soft-deleted in Step 1.
-- Safety guard: only rename when the target SKU is not already taken by
-- another active product (avoids silent collisions in edge cases).
UPDATE public.products
SET sku        = left(sku, length(sku) - 2),
    updated_at = now()
WHERE deleted_at IS NULL
  AND right(sku, 2) = '_2'
  AND NOT EXISTS (
        SELECT 1
        FROM   public.products p2
        WHERE  p2.deleted_at IS NULL
          AND  p2.sku  = left(products.sku, length(products.sku) - 2)
          AND  p2.id  != products.id
      );
