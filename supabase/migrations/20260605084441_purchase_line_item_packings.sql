-- Add no_of_packings to purchase_line_items
-- Tracks how many cartons/packages were received per line item
ALTER TABLE public.purchase_line_items
  ADD COLUMN IF NOT EXISTS no_of_packings INTEGER;
