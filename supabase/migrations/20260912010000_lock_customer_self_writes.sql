-- ============================================================
-- Close two customer-side write gaps found in the live database
--
-- 1. redemption_requests: the live "customer insert own" policy has no status
--    check (the 20260625000000 migration had `status = 'pending'`; it is not
--    what is live). A logged-in customer could insert a row that is already
--    `approved`, with any rupee_value.
--
-- 2. elite_customers: "customer updates own" allows UPDATE on every column.
--    Only trg_lock_card_tier guarded anything, and only card_tier. A logged-in
--    customer could set their own current_points, lifetime_points, status,
--    card_issue_date (the cooling-window anchor) or app_activated.
--
-- The customer app only ever updates date_of_birth and anniversary_date
-- (src/routes/profile.tsx). app_activated and referral_code are set through
-- the SECURITY DEFINER RPC link_loyalty_app_user, which runs as its owner.
--
-- Not tested against production by exploitation; derived from the policies
-- and grants, and exercised on a local Postgres and with a rolled-back probe.
--
-- ROLLBACK:
--   DROP TRIGGER trg_guard_customer_self_update ON public.elite_customers;
--   DROP FUNCTION public.fn_guard_customer_self_update();
--   DROP POLICY "redemption: customer insert own" ON public.redemption_requests;
--   CREATE POLICY "redemption: customer insert own" ON public.redemption_requests
--     FOR INSERT TO public
--     WITH CHECK (customer_id = get_loyalty_customer_id(auth.uid()));
-- ============================================================

-- ── 1. A customer may only file a PENDING request ─────────────────────────

DROP POLICY IF EXISTS "redemption: customer insert own" ON public.redemption_requests;
CREATE POLICY "redemption: customer insert own" ON public.redemption_requests
  FOR INSERT TO public
  WITH CHECK (
    customer_id = public.get_loyalty_customer_id(auth.uid())
    AND status = 'pending'
  );

-- ── 2. Customers may only change their own profile dates ──────────────────
--
-- SECURITY INVOKER on purpose: current_user must reflect who is executing the
-- statement. Direct client sessions run as `anon` / `authenticated`; SECURITY
-- DEFINER functions (fn_sync_customer_points, link_loyalty_app_user, ...) run
-- as their owner, and service_role edge functions as service_role, so both
-- pass straight through. Staff keep their existing access.

CREATE OR REPLACE FUNCTION public.fn_guard_customer_self_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_blocked text;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND (
       public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'sales'::app_role)
    OR public.has_role(auth.uid(), 'accounts'::app_role)
  ) THEN
    RETURN NEW;
  END IF;

  -- Generated columns (card_expiry_date = card_issue_date + 3 years) are
  -- computed AFTER BEFORE-triggers run, so inside this trigger NEW holds a stale
  -- value and always looks "changed". They cannot be written directly, so they
  -- are skipped; every other column is still compared (fail-closed).
  SELECT string_agg(n.key, ', ' ORDER BY n.key) INTO v_blocked
  FROM jsonb_each(to_jsonb(NEW)) AS n(key, value)
  WHERE n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key)
    AND n.key NOT IN ('date_of_birth', 'anniversary_date', 'updated_at')
    AND n.key NOT IN (
      SELECT a.attname::text FROM pg_attribute a
      WHERE a.attrelid = TG_RELID AND a.attgenerated <> '' AND NOT a.attisdropped
    );

  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'CUSTOMER_FIELD_LOCKED: customers cannot change %', v_blocked
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_customer_self_update ON public.elite_customers;
CREATE TRIGGER trg_guard_customer_self_update
  BEFORE UPDATE ON public.elite_customers
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_customer_self_update();
