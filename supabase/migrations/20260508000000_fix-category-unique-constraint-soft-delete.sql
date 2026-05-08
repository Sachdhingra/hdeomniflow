-- Fix: allow recreating a category after soft-delete
-- The original UNIQUE constraint on `name` blocked inserting a new record
-- with the same name as a soft-deleted one.
-- Replace it with a partial unique index that only covers active (non-deleted) rows.

ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_name_key;

DROP INDEX IF EXISTS idx_categories_name;

CREATE UNIQUE INDEX idx_categories_name_active
  ON public.categories(name)
  WHERE deleted_at IS NULL;
