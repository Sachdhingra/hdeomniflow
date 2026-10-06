-- Saved quotes: keep everything the Excel quotation shows, number quotes centrally,
-- and only move a linked lead's deal to "Quote sent" once the quote is actually sent.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS quote_number text,
  ADD COLUMN IF NOT EXISTS billing_address text,
  ADD COLUMN IF NOT EXISTS delivery_address text,
  ADD COLUMN IF NOT EXISTS handling_charges numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtotal numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_total numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grand_total numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS image_source text;

-- Older rows were saved as drafts; anything else is unknown, so normalise before the check.
UPDATE public.quotes SET status = 'draft' WHERE status NOT IN ('draft','sent','accepted','rejected');
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_status_check
  CHECK (status IN ('draft','sent','accepted','rejected'));

-- Quote numbers: HDE/Dehradun/<FY>/<running number>, assigned by the database so two
-- salespeople can never get the same number.
CREATE SEQUENCE IF NOT EXISTS public.quote_number_seq START 1001;
GRANT USAGE ON SEQUENCE public.quote_number_seq TO service_role;

CREATE OR REPLACE FUNCTION public.assign_quote_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_fy int := CASE WHEN extract(month FROM v_today) >= 4 THEN extract(year FROM v_today)::int ELSE extract(year FROM v_today)::int - 1 END;
BEGIN
  IF NEW.quote_number IS NULL OR btrim(NEW.quote_number) = '' THEN
    NEW.quote_number := format('HDE/Dehradun/%s-%s/%s', v_fy, lpad(((v_fy + 1) % 100)::text, 2, '0'), nextval('public.quote_number_seq'));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.assign_quote_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_quote_number() TO service_role;

DROP TRIGGER IF EXISTS trg_assign_quote_number ON public.quotes;
CREATE TRIGGER trg_assign_quote_number BEFORE INSERT ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.assign_quote_number();

UPDATE public.quotes q SET quote_number = format('HDE/Dehradun/OLD/%s', left(q.id::text, 8)) WHERE q.quote_number IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_quote_number ON public.quotes(quote_number);
CREATE INDEX IF NOT EXISTS idx_quotes_lead ON public.quotes(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_created_by ON public.quotes(created_by, created_at DESC);

-- A linked quote only counts for the pipeline once it is sent (a saved draft is not a
-- quote the customer has seen). Accepted moves the deal to won. Rejection is left to
-- staff, because closing a deal as lost needs a reason.
CREATE OR REPLACE FUNCTION public.sync_quote_to_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage text;
BEGIN
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  v_stage := CASE NEW.status WHEN 'sent' THEN 'quote_sent' WHEN 'accepted' THEN 'won' ELSE NULL END;
  IF v_stage IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status AND OLD.lead_id IS NOT DISTINCT FROM NEW.lead_id THEN
    RETURN NEW;
  END IF;
  PERFORM set_config('app.lead_deal_change_source', 'quote', true);
  PERFORM public.advance_lead_deal(NEW.lead_id, v_stage, 'quote', COALESCE(NEW.sent_at, now()));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_quote_to_deal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_quote_to_deal() TO service_role;

DROP TRIGGER IF EXISTS trg_sync_quote_to_deal ON public.quotes;
CREATE TRIGGER trg_sync_quote_to_deal AFTER INSERT OR UPDATE OF lead_id, status ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.sync_quote_to_deal();

-- A quote may only be linked to a lead its creator can see (own/assigned lead, or admin).
CREATE OR REPLACE FUNCTION public.check_quote_lead_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.lead_id IS NULL OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.lead_id IS NOT DISTINCT FROM NEW.lead_id THEN RETURN NEW; END IF;
  IF public.has_role(auth.uid(), 'admin') OR EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = NEW.lead_id AND l.deleted_at IS NULL
      AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid())
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'You can only link a quote to your own leads';
END;
$$;
REVOKE ALL ON FUNCTION public.check_quote_lead_access() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_quote_lead_access() TO service_role;

DROP TRIGGER IF EXISTS trg_check_quote_lead_access ON public.quotes;
CREATE TRIGGER trg_check_quote_lead_access BEFORE INSERT OR UPDATE OF lead_id ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.check_quote_lead_access();

-- Salespeople see the quotes linked to leads they can see (e.g. a colleague's quote
-- for a lead now assigned to them), read-only.
DROP POLICY IF EXISTS "quotes_lead_visible" ON public.quotes;
CREATE POLICY "quotes_lead_visible" ON public.quotes FOR SELECT TO authenticated
  USING (lead_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = quotes.lead_id AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid())
  ));
DROP POLICY IF EXISTS "quote_items_lead_visible" ON public.quote_items;
CREATE POLICY "quote_items_lead_visible" ON public.quote_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.quotes q JOIN public.leads l ON l.id = q.lead_id
    WHERE q.id = quote_items.quote_id AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid())
  ));
