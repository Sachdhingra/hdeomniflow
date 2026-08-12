
-- 1) Tier lock: allow the FIRST real selection (from default 'silver'), lock afterwards
CREATE OR REPLACE FUNCTION public.fn_lock_card_tier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.card_tier IS NOT NULL
     AND OLD.card_tier <> 'silver'
     AND NEW.card_tier IS DISTINCT FROM OLD.card_tier
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'TIER_LOCKED: card tier can only be changed by an admin';
  END IF;
  RETURN NEW;
END;
$function$;

-- 2) Enrollment: never create a duplicate card for the same phone (last-10-digit match)
CREATE OR REPLACE FUNCTION public.handle_lead_elite_optin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new_id UUID;
  v_issue DATE;
  v_existing UUID;
  v_ten TEXT;
BEGIN
  IF NEW.elite_opted_in IS TRUE AND (OLD.elite_opted_in IS DISTINCT FROM TRUE) THEN
    IF NEW.elite_card_id IS NULL THEN
      v_issue := COALESCE(NEW.elite_opted_date, CURRENT_DATE);
      v_ten := right(regexp_replace(COALESCE(NEW.customer_phone,''), '\D', '', 'g'), 10);

      SELECT id INTO v_existing
      FROM public.elite_customers
      WHERE v_ten <> ''
        AND right(regexp_replace(phone_1, '\D', '', 'g'), 10) = v_ten
      ORDER BY created_at
      LIMIT 1;

      IF v_existing IS NOT NULL THEN
        UPDATE public.elite_customers
           SET status = 'active',
               lead_id = COALESCE(lead_id, NEW.id),
               updated_at = now()
         WHERE id = v_existing;
        NEW.elite_card_id := v_existing;
      ELSE
        INSERT INTO public.elite_customers (customer_name, phone_1, card_issue_date, status, lead_id, created_by, notes)
        VALUES (NEW.customer_name, NEW.customer_phone, v_issue, 'active', NEW.id,
                COALESCE(NEW.updated_by, NEW.created_by), 'Auto-enrolled from lead')
        RETURNING id INTO v_new_id;
        NEW.elite_card_id := v_new_id;
      END IF;
    ELSE
      UPDATE public.elite_customers
         SET status = 'active',
             lead_id = COALESCE(lead_id, NEW.id),
             updated_at = now()
       WHERE id = NEW.elite_card_id;
    END IF;
  END IF;

  IF NEW.elite_opted_in IS FALSE AND (OLD.elite_opted_in IS DISTINCT FROM FALSE) THEN
    IF NEW.elite_card_id IS NOT NULL THEN
      UPDATE public.elite_customers
         SET status = 'opted_out', updated_at = now()
       WHERE id = NEW.elite_card_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3) Points expiry driven by the configurable validity setting
CREATE OR REPLACE FUNCTION public.fn_credit_or_reverse_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_customer     public.elite_customers%ROWTYPE;
  v_prev_count   INTEGER;
  v_points       INTEGER;
  v_current_pts  INTEGER;
  v_rr_status    TEXT;
  v_rr_pts       INTEGER;
  v_window_days  INTEGER;
  v_window_start TIMESTAMPTZ;
  v_validity     INTEGER;
BEGIN
  IF NEW.approval_status <> 'approved' OR OLD.approval_status = 'approved' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_customer FROM public.elite_customers WHERE id = NEW.customer_id;

  v_validity := COALESCE(
    NULLIF((SELECT value #>> '{}' FROM public.card_settings
            WHERE key = 'points_validity_months'), '')::INTEGER, 6);

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

    v_window_days := COALESCE(
      NULLIF((SELECT value #>> '{}' FROM public.card_settings
              WHERE key = 'points_cooling_days'), '')::INTEGER, 30);
    v_window_start := public.fn_points_window_start(
      NEW.customer_id, v_customer.card_issue_date, NEW.id);

    IF v_window_start IS NOT NULL
       AND NEW.bill_date >= (v_window_start::date + v_window_days) THEN

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
          VALUES (NEW.customer_id, v_points, 'purchase',
                  NOW() + make_interval(months => v_validity),
                  'Earned from bill entry '||NEW.id::text);
        END IF;
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
$function$;
