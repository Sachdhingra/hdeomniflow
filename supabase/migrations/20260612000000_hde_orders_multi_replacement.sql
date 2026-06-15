
-- Allow multiple replacement products per order (for multi-code sets e.g. bed headboard + base)
ALTER TABLE public.hde_orders
  ADD COLUMN IF NOT EXISTS replacement_product_ids uuid[] DEFAULT '{}';
