
-- Add quantity sold field to hde_orders (for warehouse and showroom sales)
ALTER TABLE public.hde_orders
  ADD COLUMN IF NOT EXISTS qty_sold integer NOT NULL DEFAULT 1 CHECK (qty_sold >= 1);
