CREATE OR REPLACE FUNCTION public.link_loyalty_app_user(_phone text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_customer public.elite_customers%ROWTYPE;
  v_suffix   text := '';
  v_alpha    text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_phone    text;
  i          int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_phone := CASE
    WHEN length(regexp_replace(COALESCE(_phone, ''), '\\D', '', 'g')) >= 10
      THEN '+91' || right(regexp_replace(COALESCE(_phone, ''), '\\D', '', 'g'), 10)
    ELSE COALESCE(_phone, '')
  END;

  -- Already linked?
  SELECT customer_id INTO v_existing FROM public.app_users WHERE user_id = auth.uid();
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT * INTO v_customer
  FROM public.elite_customers
  WHERE phone_1 = v_phone AND status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO public.app_users (user_id, customer_id, push_enabled)
    VALUES (auth.uid(), v_customer.id, true);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_linked';
  END;

  IF NOT v_customer.app_activated OR v_customer.referral_code IS NULL THEN
    IF v_customer.referral_code IS NULL THEN
      FOR i IN 1..4 LOOP
        v_suffix := v_suffix || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
      END LOOP;
    END IF;

    UPDATE public.elite_customers
    SET app_activated = true,
        referral_code = COALESCE(referral_code, 'EC' || right(v_phone, 4) || v_suffix)
    WHERE id = v_customer.id;
  END IF;

  RETURN v_customer.id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_loyalty_app_user(text) FROM public;
GRANT EXECUTE ON FUNCTION public.link_loyalty_app_user(text) TO authenticated;