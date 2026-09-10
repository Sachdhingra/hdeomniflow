
INSERT INTO public.card_settings (key, value)
VALUES ('welcome_points_super_elite', '50'::jsonb), ('welcome_points_prestige_elite', '75'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_award_welcome_points(_customer_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer  public.elite_customers%ROWTYPE;
  v_points    INTEGER := 0;
  v_validity  INTEGER;
BEGIN
  SELECT * INTO v_customer FROM public.elite_customers WHERE id = _customer_id;
  IF NOT FOUND OR v_customer.card_tier NOT IN ('super_elite','prestige_elite') THEN
    RETURN 0;
  END IF;

  IF EXISTS (SELECT 1 FROM public.card_points
             WHERE customer_id = _customer_id AND transaction_type = 'welcome_bonus') THEN
    RETURN 0;
  END IF;

  v_points := COALESCE(NULLIF((SELECT value #>> '{}' FROM public.card_settings
    WHERE key = CASE WHEN v_customer.card_tier = 'super_elite'
                     THEN 'welcome_points_super_elite'
                     ELSE 'welcome_points_prestige_elite' END), '')::INTEGER,
    CASE WHEN v_customer.card_tier = 'super_elite' THEN 50 ELSE 75 END);

  IF v_points <= 0 THEN RETURN 0; END IF;

  v_validity := COALESCE(
    NULLIF((SELECT value #>> '{}' FROM public.card_settings
            WHERE key = 'points_validity_months'), '')::INTEGER, 6);

  INSERT INTO public.card_points (customer_id, points, transaction_type, expires_at, notes)
  VALUES (_customer_id, v_points, 'welcome_bonus',
          NOW() + make_interval(months => v_validity),
          'Welcome bonus on app activation');

  RETURN v_points;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_award_welcome_points(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_welcome_points_on_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.app_activated IS TRUE AND COALESCE(OLD.app_activated, false) IS FALSE THEN
    PERFORM public.fn_award_welcome_points(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_welcome_points_on_activation ON public.elite_customers;
CREATE TRIGGER trg_welcome_points_on_activation
AFTER UPDATE OF app_activated ON public.elite_customers
FOR EACH ROW EXECUTE FUNCTION public.fn_welcome_points_on_activation();

CREATE OR REPLACE FUNCTION public.fn_guard_redemption_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer     public.elite_customers%ROWTYPE;
  v_window_days  INTEGER;
  v_window_start TIMESTAMPTZ;
  v_ok           BOOLEAN;
BEGIN
  SELECT * INTO v_customer FROM public.elite_customers WHERE id = NEW.customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  v_window_days := COALESCE(
    NULLIF((SELECT value #>> '{}' FROM public.card_settings
            WHERE key = 'points_cooling_days'), '')::INTEGER, 30);
  v_window_start := public.fn_points_window_start(NEW.customer_id, v_customer.card_issue_date, NULL);

  SELECT EXISTS (
    SELECT 1 FROM public.card_bill_entries
    WHERE customer_id = NEW.customer_id
      AND approval_status = 'approved'
      AND is_return = FALSE
      AND (v_customer.card_issue_date IS NULL OR bill_date >= v_customer.card_issue_date)
      AND (v_window_start IS NULL OR bill_date >= (v_window_start::date + v_window_days))
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Points can be redeemed from your next purchase, after the % day waiting period from your card purchase.', v_window_days
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_redemption_eligibility ON public.redemption_requests;
CREATE TRIGGER trg_guard_redemption_eligibility
BEFORE INSERT ON public.redemption_requests
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_redemption_eligibility();
