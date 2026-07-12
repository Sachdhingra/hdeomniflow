-- Insider PWA: device + 4-digit PIN authentication
--
-- Self-contained on purpose: the earlier 20260710_device_credentials.sql
-- migration was never applied to the live project (the PWA reported
-- "complete_device_setup not found in schema cache"), so every object is
-- created idempotently here. Setup and login now run through the
-- insider-device-auth edge function (service role), which validates the
-- one-time setup token, stores the device credential + PIN hash, and signs
-- the customer in via a magic-link hashed token — no OTP involved.

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

-- 4-digit PIN (hashed server-side) + brute-force protection
ALTER TABLE public.device_credentials
  ADD COLUMN IF NOT EXISTS pin_hash text,
  ADD COLUMN IF NOT EXISTS pin_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until timestamptz;

-- ============================================================
-- 2. setup_tokens table — one-time tokens from QR code / link
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
-- 3. generate_setup_token — staff (any user_roles entry) or service role
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_setup_token(_customer_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  -- Customers must not be able to mint setup tokens for other customers:
  -- an authenticated caller needs a staff role; service role has no uid.
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.elite_customers WHERE id = _customer_id AND status = 'active') THEN
    RAISE EXCEPTION 'customer_not_found';
  END IF;

  v_token := 'setup_' || encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.setup_tokens (customer_id, token)
  VALUES (_customer_id, v_token);

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_setup_token(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.generate_setup_token(uuid) TO authenticated, service_role;

-- ============================================================
-- 4. revoke_device_token — logout / forget device / admin revoke
-- ============================================================
CREATE OR REPLACE FUNCTION public.revoke_device_token(_device_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.device_credentials SET revoked_at = now()
  WHERE device_token = _device_token AND revoked_at IS NULL;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_device_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.revoke_device_token(text) TO anon, authenticated, service_role;

-- ============================================================
-- 5. Retire the old RPC-based setup path (never worked in production:
--    required an authenticated session the scanning customer doesn't have).
--    Setup is handled by the insider-device-auth edge function instead.
-- ============================================================
DROP FUNCTION IF EXISTS public.complete_device_setup(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.verify_device_token(text);
