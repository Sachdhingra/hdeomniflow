-- Device-based passwordless authentication for PWA
-- Stores device credentials (tokens) to enable one-click login after initial setup

-- ============================================================
-- 1. device_credentials table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.device_credentials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid NOT NULL REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  device_token      text NOT NULL UNIQUE,
  device_name       text,
  device_id         text NOT NULL,
  user_agent        text,
  ip_address        text,
  public_key        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_used_at      timestamptz,
  expires_at        timestamptz,
  revoked_at        timestamptz
);

ALTER TABLE public.device_credentials ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.device_credentials TO service_role;

CREATE INDEX IF NOT EXISTS idx_device_credentials_customer ON public.device_credentials(customer_id);
CREATE INDEX IF NOT EXISTS idx_device_credentials_token ON public.device_credentials(device_token) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_device_credentials_device_id ON public.device_credentials(device_id);

-- ============================================================
-- 2. setup_tokens table for initial device setup flow
-- One-time tokens generated from QR code/link, exchanged for device_credentials
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
-- 3. Generate setup token (admin/service role only)
-- Returns a setup token that can be embedded in QR code or link
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
-- 4. Complete device setup (exchanging setup_token for device_credential)
-- Called by PWA during setup flow, requires auth session
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_device_setup(
  _setup_token text,
  _device_id text,
  _device_name text,
  _user_agent text,
  _ip_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_setup_token public.setup_tokens%ROWTYPE;
  v_existing_app_user public.app_users%ROWTYPE;
  v_customer_id uuid;
  v_device_token text;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Verify setup token exists, not expired, and not already used
  SELECT * INTO v_setup_token FROM public.setup_tokens
  WHERE token = _setup_token
    AND used_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_or_expired_token';
  END IF;

  v_customer_id := v_setup_token.customer_id;

  -- Check if customer already has an app_user record
  SELECT * INTO v_existing_app_user FROM public.app_users
  WHERE customer_id = v_customer_id;

  IF v_existing_app_user.user_id IS NOT NULL AND v_existing_app_user.user_id != auth.uid() THEN
    RAISE EXCEPTION 'customer_already_linked_to_different_user';
  END IF;

  -- Generate device token
  v_device_token := 'device_' || encode(gen_random_bytes(32), 'hex');

  -- Create or update device credential
  INSERT INTO public.device_credentials (
    customer_id,
    device_token,
    device_name,
    device_id,
    user_agent,
    ip_address,
    expires_at
  ) VALUES (
    v_customer_id,
    v_device_token,
    _device_name,
    _device_id,
    _user_agent,
    _ip_address,
    now() + interval '365 days'
  );

  -- Create or link app_user
  INSERT INTO public.app_users (user_id, customer_id, phone, push_enabled)
  VALUES (auth.uid(), v_customer_id, (SELECT phone_1 FROM public.elite_customers WHERE id = v_customer_id), true)
  ON CONFLICT (customer_id) DO UPDATE
  SET user_id = auth.uid(), push_enabled = true
  WHERE app_users.customer_id = v_customer_id;

  -- Mark setup token as used
  UPDATE public.setup_tokens SET used_at = now() WHERE id = v_setup_token.id;

  -- Activate customer if needed
  UPDATE public.elite_customers
  SET app_activated = true,
      referral_code = COALESCE(
        referral_code,
        'EC' || right((SELECT phone_1 FROM public.elite_customers WHERE id = v_customer_id), 4) ||
        substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1) ||
        substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1) ||
        substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1) ||
        substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1)
      )
  WHERE id = v_customer_id;

  v_result := jsonb_build_object(
    'success', true,
    'device_token', v_device_token,
    'customer_id', v_customer_id,
    'device_id', _device_id
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_device_setup(text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.complete_device_setup(text, text, text, text, text) TO authenticated;

-- ============================================================
-- 5. Verify device token (passwordless login)
-- Returns customer data if device token is valid
-- ============================================================
CREATE OR REPLACE FUNCTION public.verify_device_token(_device_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credential public.device_credentials%ROWTYPE;
  v_customer public.elite_customers%ROWTYPE;
  v_result jsonb;
BEGIN
  -- Find and validate device credential
  SELECT * INTO v_credential FROM public.device_credentials
  WHERE device_token = _device_token
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_device_token';
  END IF;

  -- Get customer details
  SELECT * INTO v_customer FROM public.elite_customers WHERE id = v_credential.customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found';
  END IF;

  -- Update last_used_at timestamp
  UPDATE public.device_credentials SET last_used_at = now() WHERE id = v_credential.id;

  v_result := jsonb_build_object(
    'customer_id', v_credential.customer_id,
    'device_id', v_credential.device_id,
    'customer_name', v_customer.customer_name,
    'card_number', v_customer.card_number,
    'card_tier', v_customer.card_tier
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_device_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.verify_device_token(text) TO anon, authenticated;

-- ============================================================
-- 6. Revoke device token (logout/forget device)
-- ============================================================
CREATE OR REPLACE FUNCTION public.revoke_device_token(_device_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credential public.device_credentials%ROWTYPE;
BEGIN
  SELECT * INTO v_credential FROM public.device_credentials
  WHERE device_token = _device_token;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.device_credentials SET revoked_at = now() WHERE id = v_credential.id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_device_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.revoke_device_token(text) TO anon, authenticated;
