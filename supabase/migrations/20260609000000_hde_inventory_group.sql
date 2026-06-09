
-- Group ID lets products added together (e.g. bed headboard + base) share
-- a single inventory card showing all codes and combined value.
ALTER TABLE public.hde_inventory
  ADD COLUMN IF NOT EXISTS group_id uuid;

CREATE INDEX IF NOT EXISTS idx_hde_inv_group ON public.hde_inventory(group_id)
  WHERE group_id IS NOT NULL;
