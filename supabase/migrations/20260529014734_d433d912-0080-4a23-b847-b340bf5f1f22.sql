
-- Elite customers table
CREATE TABLE IF NOT EXISTS public.elite_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT NOT NULL,
  phone_1 TEXT NOT NULL,
  phone_2 TEXT,
  card_issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  card_expiry_date DATE GENERATED ALWAYS AS (card_issue_date + INTERVAL '3 years') STORED,
  status TEXT NOT NULL DEFAULT 'active',
  lead_id UUID,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_elite_customers_phone1 ON public.elite_customers(phone_1);
CREATE INDEX IF NOT EXISTS idx_elite_customers_expiry ON public.elite_customers(card_expiry_date);
CREATE INDEX IF NOT EXISTS idx_elite_customers_lead ON public.elite_customers(lead_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.elite_customers TO authenticated;
GRANT ALL ON public.elite_customers TO service_role;

ALTER TABLE public.elite_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "elite_select_auth" ON public.elite_customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "elite_insert_auth" ON public.elite_customers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "elite_update_auth" ON public.elite_customers FOR UPDATE TO authenticated USING (true);
CREATE POLICY "elite_delete_admin" ON public.elite_customers FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));

CREATE TRIGGER trg_elite_updated_at
BEFORE UPDATE ON public.elite_customers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add columns to leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS elite_opted_in BOOLEAN,
  ADD COLUMN IF NOT EXISTS elite_opted_date DATE,
  ADD COLUMN IF NOT EXISTS elite_card_id UUID REFERENCES public.elite_customers(id) ON DELETE SET NULL;

-- Auto-create / update elite_customers when leads.elite_opted_in toggles
CREATE OR REPLACE FUNCTION public.handle_lead_elite_optin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_id UUID;
  v_issue DATE;
BEGIN
  -- Opt-in: create elite card if none linked
  IF NEW.elite_opted_in IS TRUE AND (OLD.elite_opted_in IS DISTINCT FROM TRUE) THEN
    IF NEW.elite_card_id IS NULL THEN
      v_issue := COALESCE(NEW.elite_opted_date, CURRENT_DATE);
      INSERT INTO public.elite_customers (customer_name, phone_1, card_issue_date, status, lead_id, created_by, notes)
      VALUES (
        NEW.customer_name,
        NEW.customer_phone,
        v_issue,
        'active',
        NEW.id,
        COALESCE(NEW.updated_by, NEW.created_by),
        'Auto-enrolled from lead'
      )
      RETURNING id INTO v_new_id;
      NEW.elite_card_id := v_new_id;
    ELSE
      UPDATE public.elite_customers
         SET status = 'active',
             lead_id = COALESCE(lead_id, NEW.id),
             updated_at = now()
       WHERE id = NEW.elite_card_id;
    END IF;
  END IF;

  -- Opt-out: mark linked card as opted_out
  IF NEW.elite_opted_in IS FALSE AND (OLD.elite_opted_in IS DISTINCT FROM FALSE) THEN
    IF NEW.elite_card_id IS NOT NULL THEN
      UPDATE public.elite_customers
         SET status = 'opted_out', updated_at = now()
       WHERE id = NEW.elite_card_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_elite_optin ON public.leads;
CREATE TRIGGER trg_lead_elite_optin
BEFORE INSERT OR UPDATE OF elite_opted_in, elite_opted_date ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.handle_lead_elite_optin();
