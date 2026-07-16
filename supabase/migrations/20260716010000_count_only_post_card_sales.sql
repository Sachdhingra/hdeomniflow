-- Elite Card Loyalty — only sales made ON/AFTER the card issue date count
--
-- Existing customers may have old won leads in the database from before
-- their card was issued. Those must not create bill entries or count
-- toward points (including the "first purchase earns zero" counter).
--
-- 1. fn_lead_won_create_bill_entry: fires only on a genuine transition
--    to won/converted (editing an already-won lead no longer creates an
--    entry), and only when the card is already issued.
-- 2. fn_credit_or_reverse_points: earns points only when the entry's
--    bill_date is on/after card_issue_date, and the prior-purchase count
--    ignores entries dated before the card. Covers backdated admin
--    manual entries and legacy data.

-- ============================================================
-- 1. AUTO-ENTRY TRIGGER: transition-only + card-date guard
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_lead_won_create_bill_entry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_entered_by UUID;
  v_issue_date DATE;
BEGIN
  -- Only a fresh transition into won/converted counts as a sale event.
  -- Editing a lead that was already won (e.g. legacy records from before
  -- the card was issued) must not create an entry.
  IF TG_OP = 'UPDATE' AND OLD.status IN ('won', 'converted') THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('won', 'converted')
     OR NEW.elite_card_id IS NULL
     OR COALESCE(NEW.value_in_rupees, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  -- Sale must fall on/after the card issue date
  SELECT card_issue_date INTO v_issue_date
  FROM public.elite_customers WHERE id = NEW.elite_card_id;
  IF v_issue_date IS NULL OR CURRENT_DATE < v_issue_date THEN
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

-- ============================================================
-- 2. POINTS ENGINE: ignore pre-card entries entirely
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
  -- Only entries billed on/after the card issue date participate.
  IF v_customer.card_tier IN ('super_elite', 'prestige_elite')
     AND v_customer.app_activated
     AND (v_customer.card_issue_date IS NULL OR NEW.bill_date >= v_customer.card_issue_date) THEN
    -- First post-card purchase earns zero — count prior approved
    -- non-return entries dated on/after the card issue date
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
