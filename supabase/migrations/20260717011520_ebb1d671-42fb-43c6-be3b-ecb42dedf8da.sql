
-- =========================================================================
-- ELITE CARD LOYALTY — BASE SCHEMA + WON-LEAD PATCHES
-- =========================================================================

-- ---------- 1. redemption_requests: add used_in_bill_id ------------------
ALTER TABLE public.redemption_requests
  ADD COLUMN IF NOT EXISTS used_in_bill_id UUID;

-- ---------- 2. card_bill_entries -----------------------------------------
CREATE TABLE IF NOT EXISTS public.card_bill_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  entered_by UUID REFERENCES auth.users(id),
  lead_id UUID UNIQUE REFERENCES public.leads(id) ON DELETE SET NULL,
  bill_reference TEXT,
  bill_date DATE NOT NULL DEFAULT CURRENT_DATE,
  gross_bill_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  base_scheme_discount_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  card_discount_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  redemption_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  redemption_request_id UUID REFERENCES public.redemption_requests(id) ON DELETE SET NULL,
  net_bill_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_card_sale BOOLEAN NOT NULL DEFAULT false,
  is_return BOOLEAN NOT NULL DEFAULT false,
  approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending','approved','rejected')),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_bill_entries TO authenticated;
GRANT ALL ON public.card_bill_entries TO service_role;
ALTER TABLE public.card_bill_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cbe_admin_all" ON public.card_bill_entries
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "cbe_accounts_read" ON public.card_bill_entries
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'accounts'::app_role));

CREATE POLICY "cbe_accounts_update" ON public.card_bill_entries
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'accounts'::app_role))
  WITH CHECK (has_role(auth.uid(),'accounts'::app_role));

CREATE POLICY "cbe_sales_read_own" ON public.card_bill_entries
  FOR SELECT TO authenticated
  USING (entered_by = auth.uid());

CREATE TRIGGER cbe_touch_updated_at
  BEFORE UPDATE ON public.card_bill_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- 3. card_commissions ------------------------------------------
CREATE TABLE IF NOT EXISTS public.card_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesperson_id UUID REFERENCES auth.users(id),
  customer_id UUID REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  bill_entry_id UUID REFERENCES public.card_bill_entries(id) ON DELETE SET NULL,
  card_tier TEXT,
  commission_amount NUMERIC(12,2) NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid')),
  payout_month DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_commissions TO authenticated;
GRANT ALL ON public.card_commissions TO service_role;
ALTER TABLE public.card_commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cc_admin_accounts_all" ON public.card_commissions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role));

CREATE POLICY "cc_sales_read_own" ON public.card_commissions
  FOR SELECT TO authenticated
  USING (salesperson_id = auth.uid());

-- ---------- 4. card_settings ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.card_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.card_settings TO authenticated;
GRANT ALL ON public.card_settings TO service_role;
ALTER TABLE public.card_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cs_staff_read" ON public.card_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "cs_admin_write" ON public.card_settings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

INSERT INTO public.card_settings (key, value) VALUES
  ('discount_ceiling_pct', '15.5'::jsonb),
  ('margin_floor_pct',     '20'::jsonb),
  ('cost_base_pct_of_mrp', '64.5'::jsonb),
  ('commission_flat',      '{"elite":100,"super_elite":150,"prestige_elite":200}'::jsonb),
  ('points_validity_months','6'::jsonb),
  ('redemption_cap_pct_of_bill','5'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------- 5. push_notifications_log ------------------------------------
CREATE TABLE IF NOT EXISTS public.push_notifications_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  notification_type TEXT,
  title TEXT,
  message TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened BOOLEAN NOT NULL DEFAULT false
);

GRANT SELECT, INSERT, UPDATE ON public.push_notifications_log TO authenticated;
GRANT ALL ON public.push_notifications_log TO service_role;
ALTER TABLE public.push_notifications_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pnl_admin_accounts" ON public.push_notifications_log
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role));

-- =========================================================================
-- 6. POINTS ENGINE FUNCTIONS
-- =========================================================================

CREATE OR REPLACE FUNCTION public.fn_calc_points(_tier TEXT, _amount NUMERIC)
RETURNS INTEGER LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _tier = 'super_elite'     AND _amount > 0 THEN FLOOR(_amount / 250)::INT
    WHEN _tier = 'prestige_elite'  AND _amount > 0 THEN FLOOR(_amount / 200)::INT
    ELSE 0
  END;
$$;

-- Credit / reverse points on approval (patched version from update SQL)
CREATE OR REPLACE FUNCTION public.fn_credit_or_reverse_points()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer    public.elite_customers%ROWTYPE;
  v_prev_count  INTEGER;
  v_points      INTEGER;
  v_current_pts INTEGER;
  v_rr_status   TEXT;
  v_rr_pts      INTEGER;
BEGIN
  IF NEW.approval_status <> 'approved' OR OLD.approval_status = 'approved' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_customer FROM public.elite_customers WHERE id = NEW.customer_id;

  IF NEW.is_return THEN
    v_points := public.fn_calc_points(v_customer.card_tier, NEW.gross_bill_amount);
    IF v_points > 0 THEN
      v_current_pts := COALESCE(
        (SELECT SUM(points) FROM public.card_points WHERE customer_id = NEW.customer_id), 0
      );
      IF v_current_pts > 0 THEN
        INSERT INTO public.card_points (customer_id, points, transaction_type, notes)
        VALUES (NEW.customer_id, -LEAST(v_points, v_current_pts), 'reversal',
                'Reversal from bill entry '||NEW.id::text);
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF v_customer.card_tier IN ('super_elite','prestige_elite')
     AND v_customer.app_activated
     AND (v_customer.card_issue_date IS NULL OR NEW.bill_date >= v_customer.card_issue_date) THEN

    SELECT COUNT(*) INTO v_prev_count
    FROM public.card_bill_entries
    WHERE customer_id = NEW.customer_id
      AND approval_status = 'approved'
      AND is_return = FALSE
      AND id <> NEW.id
      AND (v_customer.card_issue_date IS NULL OR bill_date >= v_customer.card_issue_date);

    IF v_prev_count > 0 THEN
      v_points := public.fn_calc_points(v_customer.card_tier, NEW.net_bill_amount);
      IF v_points > 0 THEN
        INSERT INTO public.card_points (customer_id, points, transaction_type, expires_at, notes)
        VALUES (NEW.customer_id, v_points, 'purchase', NOW() + INTERVAL '6 months',
                'Earned from bill entry '||NEW.id::text);
      END IF;
    END IF;
  END IF;

  IF NEW.redemption_request_id IS NOT NULL THEN
    SELECT status, points_requested INTO v_rr_status, v_rr_pts
    FROM public.redemption_requests WHERE id = NEW.redemption_request_id;

    IF v_rr_status = 'approved' THEN
      INSERT INTO public.card_points (customer_id, points, transaction_type, notes)
      VALUES (NEW.customer_id, -v_rr_pts, 'redemption',
              'Redeemed via bill entry '||NEW.id::text);
      UPDATE public.redemption_requests
        SET status = 'used', used_in_bill_id = NEW.id, processed_at = now()
      WHERE id = NEW.redemption_request_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_or_reverse_points ON public.card_bill_entries;
CREATE TRIGGER trg_credit_or_reverse_points
  AFTER UPDATE OF approval_status ON public.card_bill_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_credit_or_reverse_points();

-- Commission on approved card-sale entry
CREATE OR REPLACE FUNCTION public.fn_insert_commission_on_card_sale()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tier   TEXT;
  v_amount NUMERIC;
  v_flat   JSONB;
BEGIN
  IF NOT NEW.is_card_sale OR NEW.approval_status <> 'approved'
     OR OLD.approval_status = 'approved' THEN
    RETURN NEW;
  END IF;

  SELECT card_tier INTO v_tier FROM public.elite_customers WHERE id = NEW.customer_id;
  SELECT value INTO v_flat FROM public.card_settings WHERE key = 'commission_flat';
  v_amount := COALESCE((v_flat->>v_tier)::NUMERIC, 0);

  IF v_amount > 0 THEN
    INSERT INTO public.card_commissions
      (salesperson_id, customer_id, bill_entry_id, card_tier, commission_amount)
    VALUES (NEW.entered_by, NEW.customer_id, NEW.id, v_tier, v_amount);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_insert_commission ON public.card_bill_entries;
CREATE TRIGGER trg_insert_commission
  AFTER UPDATE OF approval_status ON public.card_bill_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_insert_commission_on_card_sale();

-- Anniversary bonus
CREATE OR REPLACE FUNCTION public.fn_award_anniversary_bonus()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec RECORD; v_bonus INTEGER; v_count INTEGER := 0; v_today DATE := CURRENT_DATE;
BEGIN
  FOR rec IN
    SELECT ec.id, ec.card_tier
    FROM public.elite_customers ec
    WHERE ec.card_tier IN ('super_elite','prestige_elite')
      AND ec.app_activated = TRUE
      AND ec.status = 'active'
      AND ec.card_enrollment_date IS NOT NULL
      AND EXTRACT(MONTH FROM ec.card_enrollment_date) = EXTRACT(MONTH FROM v_today)
      AND EXTRACT(DAY   FROM ec.card_enrollment_date) = EXTRACT(DAY   FROM v_today)
      AND EXTRACT(YEAR  FROM ec.card_enrollment_date) < EXTRACT(YEAR  FROM v_today)
      AND NOT EXISTS (
        SELECT 1 FROM public.card_points cp
        WHERE cp.customer_id = ec.id
          AND cp.transaction_type = 'anniversary_bonus'
          AND cp.created_at::date = v_today
      )
  LOOP
    v_bonus := CASE rec.card_tier WHEN 'super_elite' THEN 25 ELSE 50 END;
    INSERT INTO public.card_points (customer_id, points, transaction_type, expires_at, notes)
    VALUES (rec.id, v_bonus, 'anniversary_bonus', NOW() + INTERVAL '6 months',
            'Card anniversary bonus');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- Point expiry sweeper
CREATE OR REPLACE FUNCTION public.fn_expire_points()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec RECORD; v_count INTEGER := 0;
BEGIN
  FOR rec IN
    SELECT id, customer_id, points
    FROM public.card_points
    WHERE points > 0
      AND transaction_type IN ('purchase','anniversary_bonus','referral')
      AND expires_at IS NOT NULL
      AND expires_at <= now()
      AND COALESCE(is_expired,false) = false
  LOOP
    INSERT INTO public.card_points (customer_id, points, transaction_type, notes)
    VALUES (rec.customer_id, -rec.points, 'expiry',
            'Auto-expiry of points from '||rec.id::text);
    UPDATE public.card_points SET is_expired = true WHERE id = rec.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- Keep aggregate points on elite_customers in sync
CREATE OR REPLACE FUNCTION public.fn_sync_customer_points()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cid UUID := COALESCE(NEW.customer_id, OLD.customer_id);
  v_current INTEGER; v_lifetime INTEGER;
BEGIN
  SELECT COALESCE(SUM(points),0) INTO v_current
    FROM public.card_points WHERE customer_id = v_cid;
  SELECT COALESCE(SUM(points),0) INTO v_lifetime
    FROM public.card_points
   WHERE customer_id = v_cid
     AND transaction_type IN ('purchase','anniversary_bonus','referral');
  UPDATE public.elite_customers
     SET current_points = GREATEST(0, v_current),
         lifetime_points = GREATEST(0, v_lifetime),
         updated_at = now()
   WHERE id = v_cid;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_customer_points ON public.card_points;
CREATE TRIGGER trg_sync_customer_points
  AFTER INSERT OR UPDATE OR DELETE ON public.card_points
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_customer_points();

-- =========================================================================
-- 7. WON-LEAD AUTO ENTRY  (patched version)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.fn_lead_won_create_bill_entry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_entered_by UUID;
  v_issue_date DATE;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status::text IN ('won','converted') THEN
    RETURN NEW;
  END IF;

  IF NEW.status::text NOT IN ('won','converted')
     OR NEW.elite_card_id IS NULL
     OR COALESCE(NEW.value_in_rupees,0) <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT card_issue_date INTO v_issue_date
    FROM public.elite_customers WHERE id = NEW.elite_card_id;
  IF v_issue_date IS NULL OR CURRENT_DATE < v_issue_date THEN
    RETURN NEW;
  END IF;

  v_entered_by := COALESCE(NEW.updated_by, NEW.created_by);
  IF v_entered_by IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.card_bill_entries
    (customer_id, entered_by, lead_id, bill_date,
     gross_bill_amount, net_bill_amount, approval_status, notes)
  VALUES
    (NEW.elite_card_id, v_entered_by, NEW.id, CURRENT_DATE,
     NEW.value_in_rupees, NEW.value_in_rupees, 'pending',
     'Auto-created from won lead — accounts to confirm final net value')
  ON CONFLICT (lead_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_won_create_bill_entry ON public.leads;
CREATE TRIGGER trg_lead_won_create_bill_entry
  AFTER INSERT OR UPDATE OF status ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_won_create_bill_entry();

-- =========================================================================
-- 8. TIER LOCK
-- =========================================================================
CREATE OR REPLACE FUNCTION public.fn_lock_card_tier()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.card_tier IS NOT NULL
     AND NEW.card_tier IS DISTINCT FROM OLD.card_tier
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'TIER_LOCKED: card tier can only be changed by an admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_card_tier ON public.elite_customers;
CREATE TRIGGER trg_lock_card_tier
  BEFORE UPDATE OF card_tier ON public.elite_customers
  FOR EACH ROW EXECUTE FUNCTION public.fn_lock_card_tier();
