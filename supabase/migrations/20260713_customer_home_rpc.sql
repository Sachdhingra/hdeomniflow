-- Home-page data for the Insider PWA (custom password session, no Supabase Auth).
-- Adds columns the PWA displays and a SECURITY DEFINER RPC to fetch them,
-- since elite_customers is RLS-locked to service_role.

ALTER TABLE public.elite_customers ADD COLUMN IF NOT EXISTS card_expiry_date date;
ALTER TABLE public.elite_customers ADD COLUMN IF NOT EXISTS card_enrollment_date date;
ALTER TABLE public.elite_customers ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE public.elite_customers ADD COLUMN IF NOT EXISTS current_points integer DEFAULT 0;
ALTER TABLE public.elite_customers ADD COLUMN IF NOT EXISTS lifetime_points integer DEFAULT 0;

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
  WHERE id = _customer_id AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found';
  END IF;

  -- card_points may not exist yet in this project; skip expiry if missing
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
