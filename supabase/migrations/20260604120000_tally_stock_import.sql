
-- Add item_code to inventory_products for Tally matching
ALTER TABLE public.inventory_products
  ADD COLUMN IF NOT EXISTS item_code TEXT,
  ADD COLUMN IF NOT EXISTS tally_last_synced TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_products_item_code
  ON public.inventory_products(item_code)
  WHERE item_code IS NOT NULL;

-- Extend audit log to record Tally import details
ALTER TABLE public.inventory_audit_log
  ADD COLUMN IF NOT EXISTS notes TEXT;
