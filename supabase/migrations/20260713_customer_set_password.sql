-- First-time password creation during app setup.
-- validate_setup_token now reports whether the customer has a password yet;
-- setup_customer_password lets the customer create one (guarded by a valid
-- one-time setup token) and logs them in.

CREATE OR REPLACE FUNCTION public.validate_setup_token(_setup_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_setup_token public.setup_tokens%ROWTYPE;
  v_customer public.elite_customers%ROWTYPE;
BEGIN
  SELECT * INTO v_setup_token FROM public.setup_tokens
  WHERE token = _setup_token AND used_at IS NULL AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_or_expired_token';
  END IF;

  SELECT * INTO v_customer FROM public.elite_customers WHERE id = v_setup_token.customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found';
  END IF;

  RETURN jsonb_build_object(
    'customer_id', v_customer.id,
    'customer_name', v_customer.customer_name,
    'card_tier', v_customer.card_tier,
    'card_number', v_customer.card_number,
    'has_password', v_customer.customer_password IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_setup_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.validate_setup_token(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.setup_customer_password(
  _setup_token text,
  _customer_id uuid,
  _password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_setup_token public.setup_tokens%ROWTYPE;
  v_customer public.elite_customers%ROWTYPE;
BEGIN
  SELECT * INTO v_setup_token FROM public.setup_tokens
  WHERE token = _setup_token AND customer_id = _customer_id
    AND used_at IS NULL AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_or_expired_token';
  END IF;

  SELECT * INTO v_customer FROM public.elite_customers WHERE id = _customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found';
  END IF;

  IF v_customer.customer_password IS NOT NULL THEN
    RAISE EXCEPTION 'password_already_set';
  END IF;

  IF _password IS NULL OR length(_password) < 6 THEN
    RAISE EXCEPTION 'password_too_short';
  END IF;

  UPDATE public.elite_customers
  SET customer_password = crypt(_password, gen_salt('bf')),
      app_activated = true
  WHERE id = _customer_id;

  UPDATE public.setup_tokens SET used_at = now() WHERE id = v_setup_token.id;

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', _customer_id,
    'customer_name', v_customer.customer_name,
    'card_tier', v_customer.card_tier
  );
END;
$$;

REVOKE ALL ON FUNCTION public.setup_customer_password(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.setup_customer_password(text, uuid, text) TO anon, authenticated;
