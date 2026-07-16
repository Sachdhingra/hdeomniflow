-- Elite Card Loyalty — Won-lead driven points flow (simplified)
--
-- 1. Bill entries are auto-created when a lead linked to an elite card is
--    marked won/converted. One entry per lead, ever (unique lead_id).
-- 2. Manual bill entry by sales is removed (policy dropped) — admin keeps
--    full access for exceptions such as returns.
-- 3. Accounts confirms the FINAL net value at approval time; points credit
--    off net_bill_amount as before (2nd approved sale onwards).
-- 4. Points validity reduced from 12 months to 6 months.
-- 5. Card tier is chosen once by sales; any later change requires admin.

-- ============================================================
-- 1. LINK BILL ENTRIES TO LEADS (one entry per lead, ever)
-- ============================================================
ALTER TABLE public.card_bill_entries
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.card_bill_entries
    ADD CONSTRAINT card_bill_entries_lead_id_key UNIQUE (lead_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. TRIGGER: auto-create a pending bill entry on won/converted
--    Fires after the elite opt-in BEFORE-trigger, so elite_card_id
--    set within the same UPDATE is already visible here.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_lead_won_create_bill_entry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_entered_by UUID;
BEGIN
  IF NEW.status NOT IN ('won', 'converted')
     OR NEW.elite_card_id IS NULL
     OR COALESCE(NEW.value_in_rupees, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  v_entered_by := COALESCE(NEW.updated_by, NEW.created_by);
  IF v_entered_by IS NULL THEN
    RETURN NEW;
  END IF;

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

DROP TRIGGER IF EXISTS trg_lead_won_bill_entry ON public.leads;
CREATE TRIGGER trg_lead_won_bill_entry
  AFTER INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_won_create_bill_entry();

-- ============================================================
-- 3. POINTS VALIDITY: 12 months → 6 months
--    Full replacement of fn_credit_or_reverse_points; only the
--    expires_at interval changes.
-- ============================================================
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
  -- Only act on the transition → 'approved'
  IF NEW.approval_status <> 'approved' OR OLD.approval_status = 'approved' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_customer FROM public.elite_customers WHERE id = NEW.customer_id;

  -- ── RETURN: reverse earned points ──────────────────────────────────────
  IF NEW.is_return THEN
    v_points := public.fn_calc_points(v_customer.card_tier, NEW.gross_bill_amount);
    IF v_points > 0 THEN
      v_current_pts := COALESCE(
        (SELECT SUM(points) FROM public.card_points WHERE customer_id = NEW.customer_id), 0
      );
      IF v_current_pts > 0 THEN
        INSERT INTO public.card_points (customer_id, points, transaction_type, bill_id)
        VALUES (NEW.customer_id, -LEAST(v_points, v_current_pts), 'reversal', NEW.id);
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- ── REGULAR SALE: earn points ──────────────────────────────────────────
  IF v_customer.card_tier IN ('super_elite', 'prestige_elite') AND v_customer.app_activated THEN
    -- First purchase earns zero — check prior approved non-return entries
    SELECT COUNT(*) INTO v_prev_count
    FROM public.card_bill_entries
    WHERE customer_id = NEW.customer_id
      AND approval_status = 'approved'
      AND is_return = FALSE
      AND id <> NEW.id;

    IF v_prev_count > 0 THEN
      v_points := public.fn_calc_points(v_customer.card_tier, NEW.net_bill_amount);
      IF v_points > 0 THEN
        INSERT INTO public.card_points (customer_id, points, transaction_type, bill_id, expires_at)
        VALUES (NEW.customer_id, v_points, 'purchase', NEW.id, NOW() + INTERVAL '6 months');
      END IF;
    END IF;
  END IF;

  -- ── REDEMPTION: deduct points for a linked + approved request ──────────
  IF NEW.redemption_request_id IS NOT NULL THEN
    SELECT status, points_requested INTO v_rr_status, v_rr_pts
    FROM public.redemption_requests
    WHERE id = NEW.redemption_request_id;

    IF v_rr_status = 'approved' THEN
      INSERT INTO public.card_points (customer_id, points, transaction_type, bill_id)
      VALUES (NEW.customer_id, -v_rr_pts, 'redemption', NEW.id);

      UPDATE public.redemption_requests
        SET status = 'used', used_in_bill_id = NEW.id
      WHERE id = NEW.redemption_request_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Anniversary bonus points follow the same 6-month validity
CREATE OR REPLACE FUNCTION public.fn_award_anniversary_bonus()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec     RECORD;
  v_bonus INTEGER;
  v_count INTEGER := 0;
  v_today DATE    := CURRENT_DATE;
BEGIN
  FOR rec IN
    SELECT ec.id, ec.card_tier
    FROM public.elite_customers ec
    WHERE ec.card_tier IN ('super_elite', 'prestige_elite')
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
    INSERT INTO public.card_points (customer_id, points, transaction_type, expires_at)
    VALUES (rec.id, v_bonus, 'anniversary_bonus', NOW() + INTERVAL '6 months');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ============================================================
-- 4. TIER LOCK: sales chooses a tier once; changing an already-set
--    tier requires the admin role. auth.uid() IS NULL covers
--    service-role / server-side contexts, which stay allowed.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_lock_card_tier()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.card_tier IS NOT NULL
     AND NEW.card_tier IS DISTINCT FROM OLD.card_tier
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'TIER_LOCKED: card tier can only be changed by an admin';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_card_tier ON public.elite_customers;
CREATE TRIGGER trg_lock_card_tier
  BEFORE UPDATE OF card_tier ON public.elite_customers
  FOR EACH ROW EXECUTE FUNCTION public.fn_lock_card_tier();

-- ============================================================
-- 5. STOP MANUAL SALES ENTRIES (double-counting guard)
--    Bill entries now come only from the won-lead trigger.
--    Admin keeps full access via cbe_admin_all for exceptions.
-- ============================================================
DROP POLICY IF EXISTS "cbe_sales_insert" ON public.card_bill_entries;
