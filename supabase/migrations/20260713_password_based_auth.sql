-- Password-based authentication with setup code validation
-- Replaces device-based auth with simple password login
-- Setup code is one-time, validates customer, then password login

-- ============================================================
-- 1. setup_tokens table (unchanged) - validates setup code
-- ============================================================
CREATE TABLE IF NOT EXISTS public.setup_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  token           text NOT NULL UNIQUE,
  setup_data      jsonb,
  used_at         timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.setup_tokens ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.setup_tokens TO service_role;

CREATE INDEX IF NOT EXISTS idx_setup_tokens_customer ON public.setup_tokens(customer_id);
CREATE INDEX IF NOT EXISTS idx_setup_tokens_token ON public.setup_tokens(token) WHERE used_at IS NULL;

-- ============================================================
-- 2. Generate setup token (admin/service role only)
-- Returns a setup token for QR code or link
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_setup_token(_customer_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
  v_customer public.elite_customers%ROWTYPE;
BEGIN
  -- Verify customer exists and is active
  SELECT * INTO v_customer FROM public.elite_customers WHERE id = _customer_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found';
  END IF;

  -- Generate secure random token
  v_token := 'setup_' || encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.setup_tokens (customer_id, token)
  VALUES (_customer_id, v_token);

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_setup_token(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.generate_setup_token(uuid) TO service_role;

-- ============================================================
-- 3. Validate setup token and get customer info
-- Called by PWA during setup, returns customer name (PUBLIC)
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_setup_token(_setup_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_setup_token public.setup_tokens%ROWTYPE;
  v_customer public.elite_customers%ROWTYPE;
  v_result jsonb;
BEGIN
  -- Verify setup token exists, not expired, and not already used
  SELECT * INTO v_setup_token FROM public.setup_tokens
  WHERE token = _setup_token
    AND used_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_or_expired_token';
  END IF;

  -- Get customer details
  SELECT * INTO v_customer FROM public.elite_customers WHERE id = v_setup_token.customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found';
  END IF;

  -- Return customer info for setup page
  v_result := jsonb_build_object(
    'customer_id', v_customer.id,
    'customer_name', v_customer.customer_name,
    'card_tier', v_customer.card_tier,
    'card_number', v_customer.card_number
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_setup_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.validate_setup_token(text) TO anon, authenticated;

-- ============================================================
-- 4. Authenticate customer with password and complete setup
-- Called after password validation, creates app_user link
-- ============================================================
CREATE OR REPLACE FUNCTION public.authenticate_customer_with_password(
  _setup_token text,
  _customer_id uuid,
  _password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_setup_token public.setup_tokens%ROWTYPE;
  v_customer public.elite_customers%ROWTYPE;
  v_existing_app_user public.app_users%ROWTYPE;
  v_result jsonb;
BEGIN
  -- Verify setup token exists and is valid
  SELECT * INTO v_setup_token FROM public.setup_tokens
  WHERE token = _setup_token
    AND customer_id = _customer_id
    AND used_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_or_expired_token';
  END IF;

  -- Get customer and verify password
  SELECT * INTO v_customer FROM public.elite_customers WHERE id = _customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found';
  END IF;

  -- Verify password (assumes password is stored in customer_password column, hashed with bcrypt)
  -- For security: password comparison should use constant-time comparison
  IF v_customer.customer_password IS NULL THEN
    RAISE EXCEPTION 'no_password_set';
  END IF;

  -- Using crypt() for bcrypt verification if password was hashed with bcrypt
  -- Otherwise, if password stored as plaintext for testing, use simple comparison
  IF crypt(_password, v_customer.customer_password) != v_customer.customer_password THEN
    RAISE EXCEPTION 'invalid_password';
  END IF;

  -- Create or update app_user link (requires auth session to track who is using the app)
  -- For PWA, we'll create a session-based user or use customer_id directly
  SELECT * INTO v_existing_app_user FROM public.app_users WHERE customer_id = _customer_id;

  IF v_existing_app_user IS NULL THEN
    INSERT INTO public.app_users (customer_id, push_enabled)
    VALUES (_customer_id, true);
  ELSE
    UPDATE public.app_users SET push_enabled = true WHERE customer_id = _customer_id;
  END IF;

  -- Mark setup token as used
  UPDATE public.setup_tokens SET used_at = now() WHERE id = v_setup_token.id;

  -- Activate customer if needed
  UPDATE public.elite_customers
  SET app_activated = true,
      referral_code = COALESCE(
        referral_code,
        'EC' || right(phone_1, 4) ||
        substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1) ||
        substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1) ||
        substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1) ||
        substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1)
      )
  WHERE id = _customer_id;

  -- Return success with customer info
  v_result := jsonb_build_object(
    'success', true,
    'customer_id', _customer_id,
    'customer_name', v_customer.customer_name,
    'card_tier', v_customer.card_tier,
    'message', 'Login successful'
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.authenticate_customer_with_password(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.authenticate_customer_with_password(text, uuid, text) TO anon, authenticated;
