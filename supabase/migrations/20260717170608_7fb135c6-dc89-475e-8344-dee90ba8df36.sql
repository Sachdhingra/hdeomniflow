
INSERT INTO public.card_settings (key, value)
VALUES ('points_cooling_days', '30'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_points_window_start(
  _customer UUID, _issue DATE, _exclude_entry UUID
)
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    AND EXISTS (
      SELECT 1 FROM unnest(COALESCE(sj.photos, ARRAY[]::text[])) p
      WHERE p LIKE 'http%'
    );
$$;

CREATE OR REPLACE FUNCTION public.fn_credit_or_reverse_points()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer     public.elite_customers%ROWTYPE;
  v_prev_count   INTEGER;
  v_points       INTEGER;
  v_current_pts  INTEGER;
  v_rr_status    TEXT;
  v_rr_pts       INTEGER;
  v_window_days  INTEGER;
  v_window_start TIMESTAMPTZ;
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
          VALUES (NEW.customer_id, v_points, 'purchase', NOW() + INTERVAL '6 months',
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
$$;
