-- PWA (Home Decor Insider) now uses this Supabase project directly.
-- 1. invite_tokens — one-time links for passwordless QR/WhatsApp login
-- 2. app_users compatibility — push_enabled column, phone made nullable
-- 3. link_loyalty_app_user RPC — email-OTP self-linking (RLS blocks the
--    pre-link client from reading elite_customers, so this runs as definer)

-- ============================================================
-- 1. invite_tokens (service-role only; no user policies)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.invite_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token       text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  phone       text NOT NULL,
  used_at     timestamptz,
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '30 days',
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invite_tokens ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.invite_tokens TO service_role;

CREATE INDEX IF NOT EXISTS idx_invite_tokens_customer ON public.invite_tokens(customer_id);

-- ============================================================
-- 2. app_users: PWA writes push_enabled and inserts without phone
-- ============================================================
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS push_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.app_users
  ALTER COLUMN phone DROP NOT NULL;

-- ============================================================
-- 3. Self-link RPC for the email-OTP fallback flow
-- Returns the customer_id on success, NULL when no active elite
-- customer matches the phone. Raises 'already_linked' when the
-- customer is claimed by a different auth user.
-- ============================================================
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
  i          int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Already linked?
  SELECT customer_id INTO v_existing FROM public.app_users WHERE user_id = auth.uid();
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT * INTO v_customer
  FROM public.elite_customers
  WHERE phone_1 = _phone AND status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO public.app_users (user_id, customer_id, phone, push_enabled)
    VALUES (auth.uid(), v_customer.id, _phone, true);
  EXCEPTION WHEN unique_violation THEN
    -- Customer already claimed by a different auth user
    RAISE EXCEPTION 'already_linked';
  END;

  IF NOT v_customer.app_activated OR v_customer.referral_code IS NULL THEN
    IF v_customer.referral_code IS NULL THEN
      FOR i IN 1..4 LOOP
        v_suffix := v_suffix || substr(v_alpha, 1 + floor(random() * 32)::int, 1);
      END LOOP;
    END IF;
    UPDATE public.elite_customers
    SET app_activated = true,
        referral_code = COALESCE(referral_code, 'EC' || right(_phone, 4) || v_suffix)
    WHERE id = v_customer.id;
  END IF;

  RETURN v_customer.id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_loyalty_app_user(text) FROM public;
GRANT EXECUTE ON FUNCTION public.link_loyalty_app_user(text) TO authenticated;
