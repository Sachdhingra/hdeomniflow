-- ============================================================
-- Points rules decided on 8 Oct 2026
--
-- 1. Welcome points expire 6 months after issue, like every other earned
--    point. fn_award_welcome_points already stamps expires_at at issue
--    (now() + points_validity_months, 181-182 days on all 35 live rows) but the
--    live fn_expire_points did not list 'welcome_bonus', so those points never
--    expired. No existing row is past its expiry (earliest is 2027-03-10), so
--    this changes nothing for any customer today.
--
-- 2. Staff can view points but not edit them. Points change only through the
--    ledger (card_points) and the sync trigger. Until now the staff UPDATE
--    policy on elite_customers let sales set current_points / lifetime_points
--    directly, which also desynchronised the displayed balance from the ledger
--    until the next ledger write. card_points itself is already admin-write
--    only, and every function that writes points is uncallable by client roles.
--
-- Applies to every direct client session (anon / authenticated), admin
-- included: an admin who needs to adjust points does it by inserting a ledger
-- row, which the sync trigger reflects. SECURITY DEFINER functions and
-- service_role edge functions run as other roles and are unaffected.
--
-- ROLLBACK:
--   DROP TRIGGER trg_lock_points_columns ON public.elite_customers;
--   DROP FUNCTION public.fn_lock_points_columns();
--   and restore fn_expire_points with the IN ('purchase','anniversary_bonus','referral') list.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_expire_points()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  rec         RECORD;
  v_unspent   INTEGER;
  v_count     INTEGER := 0;
BEGIN
  FOR rec IN
    SELECT id, customer_id, points, consumed_points
    FROM public.card_points
    WHERE points > 0
      AND transaction_type IN ('purchase','anniversary_bonus','referral','welcome_bonus')
      AND expires_at IS NOT NULL
      AND expires_at <= now()
      AND COALESCE(is_expired,false) = false
    FOR UPDATE SKIP LOCKED
  LOOP
    v_unspent := rec.points - rec.consumed_points;

    IF v_unspent > 0 THEN
      INSERT INTO public.card_points (customer_id, points, transaction_type, notes)
      VALUES (rec.customer_id, -v_unspent, 'expiry',
              'Auto-expiry of points from '||rec.id::text);
    END IF;

    UPDATE public.card_points SET is_expired = true WHERE id = rec.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

-- SECURITY INVOKER on purpose: current_user is the role executing the statement.
CREATE OR REPLACE FUNCTION public.fn_lock_points_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND (NEW.current_points  IS DISTINCT FROM OLD.current_points
       OR NEW.lifetime_points IS DISTINCT FROM OLD.lifetime_points) THEN
    RAISE EXCEPTION 'POINTS_LOCKED: points change only through the points ledger'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_points_columns ON public.elite_customers;
CREATE TRIGGER trg_lock_points_columns
  BEFORE UPDATE OF current_points, lifetime_points ON public.elite_customers
  FOR EACH ROW EXECUTE FUNCTION public.fn_lock_points_columns();
