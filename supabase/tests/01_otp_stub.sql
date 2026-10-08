-- Extra stand-ins for the OTP suite: bill entries, settings, and the LIVE
-- waiting-period logic (fn_points_window_start + fn_guard_redemption_eligibility
-- copied from production) so eligibility behaves exactly as it does live.
--
-- Run on a FRESH database, because the eligibility trigger below would reject
-- the redemption rows the ledger tests insert for ineligible customers:
--   psql -f 00_prereq_stub.sql ; psql -f 01_otp_stub.sql
--   psql -f ../migrations/20260912000000_point_lot_consumption.sql   (and ...010000, ...020000)
--   psql -f ../migrations/20260912030000_otp_redemption.sql
--   psql -f otp_redemption_test.sql
CREATE TABLE public.card_settings (
  key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.card_settings (key, value) VALUES
  ('points_cooling_days','30'), ('points_validity_months','6'), ('redemption_cap_pct_of_bill','5');
GRANT ALL ON public.card_settings TO service_role;

CREATE TABLE public.card_bill_entries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           UUID NOT NULL REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  entered_by            UUID,
  lead_id               UUID,
  bill_reference        TEXT,
  bill_date             DATE NOT NULL DEFAULT CURRENT_DATE,
  gross_bill_amount     NUMERIC NOT NULL DEFAULT 0,
  redemption_amount     NUMERIC NOT NULL DEFAULT 0,
  redemption_request_id UUID,
  net_bill_amount       NUMERIC NOT NULL DEFAULT 0,
  is_return             BOOLEAN NOT NULL DEFAULT false,
  approval_status       TEXT NOT NULL DEFAULT 'pending',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.card_bill_entries ENABLE ROW LEVEL SECURITY;   -- no policies for the test roles: like live, sales cannot write it directly
GRANT ALL ON public.card_bill_entries TO anon, authenticated, service_role;

CREATE TABLE public.service_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_lead_id UUID, type TEXT, status TEXT, completed_at TIMESTAMPTZ,
  photos TEXT[], deleted_at TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION public.fn_points_window_start(_customer uuid, _issue date, _exclude_entry uuid)
 RETURNS timestamp with time zone LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT MIN(sj.completed_at)
  FROM public.card_bill_entries cbe
  JOIN public.service_jobs sj ON sj.source_lead_id = cbe.lead_id
  WHERE cbe.customer_id = _customer
    AND cbe.approval_status = 'approved'
    AND cbe.is_return = FALSE
    AND cbe.lead_id IS NOT NULL
    AND (_exclude_entry IS NULL OR cbe.id <> _exclude_entry)
    AND (_issue IS NULL OR cbe.bill_date >= _issue)
    AND sj.type::text IN ('delivery', 'self_delivery')
    AND sj.status::text = 'completed'
    AND sj.completed_at IS NOT NULL
    AND sj.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM unnest(COALESCE(sj.photos, ARRAY[]::text[])) p WHERE p LIKE 'http%');
$function$;

CREATE OR REPLACE FUNCTION public.fn_guard_redemption_eligibility()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_customer     public.elite_customers%ROWTYPE;
  v_window_days  INTEGER;
  v_window_start TIMESTAMPTZ;
  v_ok           BOOLEAN;
BEGIN
  SELECT * INTO v_customer FROM public.elite_customers WHERE id = NEW.customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
  v_window_days := COALESCE(NULLIF((SELECT value #>> '{}' FROM public.card_settings WHERE key = 'points_cooling_days'), '')::INTEGER, 30);
  v_window_start := public.fn_points_window_start(NEW.customer_id, v_customer.card_issue_date, NULL);
  SELECT EXISTS (
    SELECT 1 FROM public.card_bill_entries
    WHERE customer_id = NEW.customer_id AND approval_status = 'approved' AND is_return = FALSE
      AND (v_customer.card_issue_date IS NULL OR bill_date >= v_customer.card_issue_date)
      AND (v_window_start IS NULL OR bill_date >= (v_window_start::date + v_window_days))
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Points can be redeemed from your next purchase, after the % day waiting period from your card purchase.', v_window_days
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_guard_redemption_eligibility BEFORE INSERT ON public.redemption_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_redemption_eligibility();
