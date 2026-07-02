-- Elite Card Loyalty — Step 3: Points Engine
-- DB triggers: earn on bill approval, reverse on return, sync balance
-- Standalone functions: expire stale points, award anniversary bonus

-- ============================================================
-- 1. SCHEMA ADDITIONS
-- ============================================================

-- Track whether a purchase row's points have already been expired
-- (prevents double-expiry when the cron runs repeatedly)
ALTER TABLE public.card_points
  ADD COLUMN IF NOT EXISTS is_expired BOOLEAN NOT NULL DEFAULT false;

-- Partial index: only un-expired purchase rows with a future expiry date
CREATE INDEX IF NOT EXISTS idx_card_points_expiry_pending
  ON public.card_points(expires_at)
  WHERE transaction_type = 'purchase' AND is_expired = FALSE AND expires_at IS NOT NULL;

-- ============================================================
-- 2. HELPER: calculate points for a tier + net amount
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_calc_points(p_tier TEXT, p_net_amount DECIMAL)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_per_rupees INT;
BEGIN
  CASE p_tier
    WHEN 'super_elite'    THEN v_per_rupees := 250;
    WHEN 'prestige_elite' THEN v_per_rupees := 200;
    ELSE RETURN 0;
  END CASE;
  RETURN FLOOR(GREATEST(p_net_amount, 0) / v_per_rupees)::INTEGER;
END;
$$;

-- ============================================================
-- 3. TRIGGER: keep current_points + lifetime_points in sync
--    Fires AFTER every INSERT / UPDATE / DELETE on card_points.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_sync_current_points()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cid UUID;
BEGIN
  v_cid := COALESCE(NEW.customer_id, OLD.customer_id);
  UPDATE public.elite_customers SET
    current_points  = (
      SELECT COALESCE(SUM(points), 0)
      FROM public.card_points
      WHERE customer_id = v_cid
    ),
    lifetime_points = (
      SELECT COALESCE(SUM(points), 0)
      FROM public.card_points
      WHERE customer_id = v_cid AND points > 0
    )
  WHERE id = v_cid;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_current_points ON public.card_points;
CREATE TRIGGER trg_sync_current_points
  AFTER INSERT OR UPDATE OR DELETE ON public.card_points
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_current_points();

-- ============================================================
-- 4. TRIGGER: earn / reverse points when a bill entry is approved
--    Fires AFTER UPDATE OF approval_status on card_bill_entries.
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
  -- Points only for super_elite / prestige_elite with app activated
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
        VALUES (NEW.customer_id, v_points, 'purchase', NEW.id, NOW() + INTERVAL '12 months');
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

DROP TRIGGER IF EXISTS trg_bill_entry_points ON public.card_bill_entries;
CREATE TRIGGER trg_bill_entry_points
  AFTER UPDATE OF approval_status ON public.card_bill_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_credit_or_reverse_points();

-- ============================================================
-- 5. STANDALONE: expire points past their expires_at
--    Returns the number of purchase rows expired (for logging).
--    Called by the Step-4 edge-function cron job.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_expire_points()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r       RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR r IN
    SELECT id, customer_id, points
    FROM public.card_points
    WHERE transaction_type = 'purchase'
      AND is_expired = FALSE
      AND expires_at IS NOT NULL
      AND expires_at < NOW()
    FOR UPDATE SKIP LOCKED          -- safe for concurrent runs
  LOOP
    -- Insert a negative 'expiry' row; bill_id holds the source point-row id
    INSERT INTO public.card_points (customer_id, points, transaction_type, bill_id)
    VALUES (r.customer_id, -r.points, 'expiry', r.id);

    UPDATE public.card_points SET is_expired = TRUE WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ============================================================
-- 6. STANDALONE: award anniversary bonus points
--    Returns rows credited. Called by Step-4 cron job daily.
-- ============================================================
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
      -- Same calendar day as enrollment, but in a later year
      AND EXTRACT(MONTH FROM ec.card_enrollment_date) = EXTRACT(MONTH FROM v_today)
      AND EXTRACT(DAY   FROM ec.card_enrollment_date) = EXTRACT(DAY   FROM v_today)
      AND EXTRACT(YEAR  FROM ec.card_enrollment_date) < EXTRACT(YEAR  FROM v_today)
      -- Idempotency: no anniversary_bonus credited today yet
      AND NOT EXISTS (
        SELECT 1 FROM public.card_points cp
        WHERE cp.customer_id = ec.id
          AND cp.transaction_type = 'anniversary_bonus'
          AND cp.created_at::date = v_today
      )
  LOOP
    v_bonus := CASE rec.card_tier WHEN 'super_elite' THEN 25 ELSE 50 END;
    INSERT INTO public.card_points (customer_id, points, transaction_type, expires_at)
    VALUES (rec.id, v_bonus, 'anniversary_bonus', NOW() + INTERVAL '12 months');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ============================================================
-- 7. RLS: add accounts update right on redemption_requests
--    (accounts approves / rejects customer redemption requests)
-- ============================================================
CREATE POLICY "redemption_accounts_update" ON public.redemption_requests
  FOR UPDATE TO authenticated
  USING   (public.has_role(auth.uid(), 'accounts'::app_role) OR
           public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'accounts'::app_role) OR
              public.has_role(auth.uid(), 'admin'::app_role));
