-- Add order tracking columns to leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS orders JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS repeat_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_sales NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS repeat_customer BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_purchase_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_purchase_date TIMESTAMPTZ;

-- Index for fast phone lookup (repeat customer recognition)
CREATE INDEX IF NOT EXISTS idx_leads_customer_phone ON public.leads(customer_phone) WHERE deleted_at IS NULL;

-- Trigger function to recompute aggregates whenever orders array changes
CREATE OR REPLACE FUNCTION public.recompute_lead_order_aggregates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_total NUMERIC := 0;
  v_first TIMESTAMPTZ;
  v_last TIMESTAMPTZ;
BEGIN
  IF NEW.orders IS NULL OR jsonb_typeof(NEW.orders) <> 'array' THEN
    NEW.orders := '[]'::jsonb;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM( (elem->>'amount')::numeric ), 0),
    MIN( NULLIF(elem->>'date','')::timestamptz ),
    MAX( NULLIF(elem->>'date','')::timestamptz )
  INTO v_count, v_total, v_first, v_last
  FROM jsonb_array_elements(NEW.orders) AS elem;

  NEW.repeat_count := GREATEST(0, v_count - 1);
  NEW.total_sales := v_total;
  NEW.repeat_customer := v_count > 1;
  NEW.first_purchase_date := v_first;
  NEW.last_purchase_date := v_last;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_lead_order_aggregates ON public.leads;
CREATE TRIGGER trg_recompute_lead_order_aggregates
BEFORE INSERT OR UPDATE OF orders ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.recompute_lead_order_aggregates();