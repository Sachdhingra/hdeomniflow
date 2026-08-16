ALTER TABLE public.elite_customers
  ADD COLUMN IF NOT EXISTS anniversary_date DATE;

COMMENT ON COLUMN public.elite_customers.anniversary_date IS
  'Customer-supplied card-anniversary date used for annual bonus and push reminder. Falls back to card_enrollment_date if null.';

CREATE OR REPLACE FUNCTION public.rpc_set_anniversary_date(p_date DATE)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id UUID;
BEGIN
  v_customer_id := public.get_loyalty_customer_id(auth.uid());
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Not linked to an Elite Card account';
  END IF;
  IF p_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Anniversary date cannot be in the future';
  END IF;
  IF p_date < CURRENT_DATE - INTERVAL '10 years' THEN
    RAISE EXCEPTION 'Anniversary date seems too far in the past';
  END IF;
  UPDATE public.elite_customers
    SET anniversary_date = p_date
  WHERE id = v_customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_set_anniversary_date(DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_award_anniversary_bonus()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec        RECORD;
  v_bonus    INTEGER;
  v_count    INTEGER := 0;
  v_today    DATE    := CURRENT_DATE;
  v_ann_date DATE;
BEGIN
  FOR rec IN
    SELECT ec.id, ec.card_tier,
           COALESCE(ec.anniversary_date, ec.card_enrollment_date::DATE) AS eff_ann_date
    FROM public.elite_customers ec
    WHERE ec.card_tier IN ('super_elite', 'prestige_elite')
      AND ec.app_activated = TRUE
      AND ec.status = 'active'
      AND (ec.anniversary_date IS NOT NULL OR ec.card_enrollment_date IS NOT NULL)
  LOOP
    v_ann_date := rec.eff_ann_date;

    IF EXTRACT(MONTH FROM v_ann_date) <> EXTRACT(MONTH FROM v_today) THEN CONTINUE; END IF;
    IF EXTRACT(DAY   FROM v_ann_date) <> EXTRACT(DAY   FROM v_today) THEN CONTINUE; END IF;
    IF EXTRACT(YEAR  FROM v_ann_date) >= EXTRACT(YEAR  FROM v_today) THEN CONTINUE; END IF;

    IF EXISTS (
      SELECT 1 FROM public.card_points
      WHERE customer_id      = rec.id
        AND transaction_type = 'anniversary_bonus'
        AND created_at::date  = v_today
    ) THEN CONTINUE; END IF;

    v_bonus := CASE rec.card_tier WHEN 'super_elite' THEN 25 ELSE 50 END;
    INSERT INTO public.card_points (customer_id, points, transaction_type, expires_at)
    VALUES (rec.id, v_bonus, 'anniversary_bonus', NOW() + INTERVAL '12 months');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;