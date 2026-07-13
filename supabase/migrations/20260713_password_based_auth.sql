-- Password-based authentication with setup code validation (v2, self-healing)
-- Flow: admin generates setup code -> customer opens PWA -> code validated ->
--       customer enters password -> logged in. No OTP, no device credentials.
--
-- NOTE: functions use "SET search_path = public, extensions" because Supabase
-- installs pgcrypto (crypt, gen_salt, gen_random_bytes) in the extensions schema.

-- ============================================================
-- 0. Clean up old device-based auth objects
-- ============================================================
DROP FUNCTION IF EXISTS public.complete_device_setup(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.verify_device_token(text);
DROP FUNCTION IF EXISTS public.revoke_device_token(text);
DROP FUNCTION IF EXISTS public.generate_setup_token(uuid);
DROP FUNCTION IF EXISTS public.validate_setup_token(text);
DROP FUNCTION IF EXISTS public.authenticate_customer_with_password(text, uuid, text);
DROP TABLE IF EXISTS public.device_credentials CASCADE;
DROP TABLE IF EXISTS public.setup_tokens CASCADE;

-- ============================================================
-- 1. elite_customers table (created if missing)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.elite_customers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name     text NOT NULL,
  customer_password text,
  card_number       text UNIQUE,
  card_tier         text DEFAULT 'standard',
  phone_1           text UNIQUE,
  status            text DEFAULT 'active',
  app_activated     boolean DEFAULT false,
  referral_code     text UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.elite_customers ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.elite_customers TO service_role;

-- ============================================================
-- 2. setup_tokens table
-- ============================================================
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

-- ============================================================
-- 3. generate_setup_token (service role / SQL editor)
-- ============================================================
CREATE FUNCTION public.generate_setup_token(_customer_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token text;
BEGIN
  PERFORM 1 FROM public.elite_customers WHERE id = _customer_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found';
  END IF;

  v_token := 'setup_' || md5(random()::text || clock_timestamp()::text) || md5(random()::text || _customer_id::text);

  INSERT INTO public.setup_tokens (customer_id, token) VALUES (_customer_id, v_token);
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_setup_token(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.generate_setup_token(uuid) TO service_role;

-- ============================================================
-- 4. validate_setup_token (PWA, public)
-- ============================================================
CREATE FUNCTION public.validate_setup_token(_setup_token text)
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
    'card_number', v_customer.card_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_setup_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.validate_setup_token(text) TO anon, authenticated;

-- ============================================================
-- 5. authenticate_customer_with_password (PWA, public)
-- ============================================================
CREATE FUNCTION public.authenticate_customer_with_password(
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
