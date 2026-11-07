-- Kreation X3 quotes can hold several units (for example two wardrobes for one customer).
-- Each part line records which unit it belongs to. NULL means unit 1 / not a Kreation unit.
ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS group_no integer;

COMMENT ON COLUMN public.quote_items.group_no IS
  'Kreation X3 unit number the line belongs to (1, 2, ...). NULL for other products and single-unit quotes.';
