-- ============================================================
-- Insider PWA password auth — PRODUCTION install
-- Target: the omni runtime project (cdrgbhnntonyofqkhzpm), which holds the
-- real elite_customers data. Additive on elite_customers; only setup_tokens
-- (our own ephemeral table) is dropped and recreated.
--
-- Flow: salesperson generates QR/link from Elite Customers dashboard ->
-- customer scans -> name shown -> first time: creates own password ->
-- later: enters password -> logged in. No OTP.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1. Additive columns on the real customer table
ALTER TABLE public.elite_customers ADD COLUMN IF NOT EXISTS customer_password text;
ALTER TABLE public.elite_customers ADD COLUMN IF NOT EXISTS app_activated boolean DEFAULT false;

-- 2. setup_tokens (ephemeral one-time codes; safe to recreate)
DROP TABLE IF EXISTS public.setup_tokens CASCADE;

CREATE TABLE public.setup_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  token           text NOT NULL UNIQUE,
  used_at         timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.setup_tokens ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.setup_tokens TO service_role;

CREATE INDEX idx_setup_tokens_customer ON public.setup_tokens(customer_id);
CREATE INDEX idx_setup_tokens_token ON public.setup_tokens(token) WHERE used_at IS NULL;

-- 3. generate_setup_token — called by omni dashboard (logged-in staff)
CREATE OR REPLACE FUNCTION public.generate_setup_token(_customer_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token text;
BEGIN
  PERFORM 1 FROM public.elite_customers WHERE id = _customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found';
  END IF;

  v_token := 'setup_' || md5(random()::text || clock_timestamp()::text) || md5(random()::text || _customer_id::text);

  INSERT INTO public.setup_tokens (customer_id, token) VALUES (_customer_id, v_token);
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_setup_token(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.generate_setup_token(uuid) TO authenticated, service_role;

-- 4. validate_setup_token — PWA validates scanned code, returns name + has_password
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

-- 5. setup_customer_password — first-time password creation + login
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

-- 6. authenticate_customer_with_password — returning customer login
CREATE OR REPLACE FUNCTION public.authenticate_customer_with_password(
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

  IF v_customer.customer_password IS NULL THEN
    RAISE EXCEPTION 'no_password_set';
  END IF;

  IF crypt(_password, v_customer.customer_password) != v_customer.customer_password THEN
    RAISE EXCEPTION 'invalid_password';
  END IF;

  UPDATE public.setup_tokens SET used_at = now() WHERE id = v_setup_token.id;
  UPDATE public.elite_customers SET app_activated = true WHERE id = _customer_id;

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', _customer_id,
    'customer_name', v_customer.customer_name,
    'card_tier', v_customer.card_tier
  );
END;
$$;

REVOKE ALL ON FUNCTION public.authenticate_customer_with_password(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.authenticate_customer_with_password(text, uuid, text) TO anon, authenticated;

-- 7. get_customer_home — PWA home page data (card + points)
CREATE OR REPLACE FUNCTION public.get_customer_home(_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_customer public.elite_customers%ROWTYPE;
  v_next_expiry jsonb := NULL;
BEGIN
  SELECT * INTO v_customer FROM public.elite_customers
  WHERE id = _customer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found';
  END IF;

  IF to_regclass('public.card_points') IS NOT NULL THEN
    SELECT jsonb_build_object('points', points, 'expires_at', expires_at)
    INTO v_next_expiry
    FROM public.card_points
    WHERE customer_id = _customer_id
      AND transaction_type = 'purchase'
      AND is_expired = false
      AND expires_at > now()
    ORDER BY expires_at ASC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'id', v_customer.id,
    'customer_name', v_customer.customer_name,
    'card_tier', v_customer.card_tier,
    'card_number', v_customer.card_number,
    'card_expiry_date', v_customer.card_expiry_date,
    'current_points', COALESCE(v_customer.current_points, 0),
    'lifetime_points', COALESCE(v_customer.lifetime_points, 0),
    'next_expiry', v_next_expiry
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_home(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_customer_home(uuid) TO anon, authenticated;

-- 8. Make the API layer see the new functions immediately
NOTIFY pgrst, 'reload schema';
