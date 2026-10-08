-- Expired Elite cards must not be visible to sales (or any non-admin staff).
--
-- Why: a salesperson who can see an expired member may still quote member
-- discounts on a lapsed card. Only admin sees every card and only admin can
-- bring an old member back (re-enrolment with payment).
--
-- Enforced in the database, not just the UI, so every page that reads
-- elite_customers (Elite list, bill entries, loyalty pages, lead dialog) is
-- covered at once.
--
-- Before: policy "elite_staff_all" (FOR ALL, admin/sales/accounts/service_head)
-- was never dropped, so it OR-ed with the narrower per-command policies
-- created in 20260819123347 and gave every staff role unrestricted access.
-- This migration replaces all of them. Non-admin staff keep exactly the
-- access they effectively had, limited to cards that have not expired.
--
-- Customer-app policies ("customer reads/updates own") are untouched: a
-- member always sees their own card in the Insider app.

-- ------------------------------------------------------------------
-- 1. Expiry predicate (IST calendar day; the expiry day itself is still valid,
--    matching the Elite list UI). Falls back to issue date + 3 years if the
--    stored expiry is null.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.elite_card_is_expired(c public.elite_customers)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(c.card_expiry_date::date, (c.card_issue_date + INTERVAL '3 years')::date)
         < (now() AT TIME ZONE 'Asia/Kolkata')::date
$$;

-- ------------------------------------------------------------------
-- 2. Replace every staff policy on elite_customers
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "elite_staff_all"    ON public.elite_customers;
DROP POLICY IF EXISTS "elite_select_staff" ON public.elite_customers;
DROP POLICY IF EXISTS "elite_insert_staff" ON public.elite_customers;
DROP POLICY IF EXISTS "elite_update_staff" ON public.elite_customers;
DROP POLICY IF EXISTS "elite_admin_all"    ON public.elite_customers;
DROP POLICY IF EXISTS "elite_staff_unexpired" ON public.elite_customers;

-- Admin: everything, expired included.
CREATE POLICY "elite_admin_all" ON public.elite_customers
  FOR ALL TO authenticated
  USING      (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Other staff: unexpired cards only.
CREATE POLICY "elite_staff_unexpired" ON public.elite_customers
  FOR ALL TO authenticated
  USING (
    (   public.has_role(auth.uid(), 'sales'::app_role)
     OR public.has_role(auth.uid(), 'accounts'::app_role)
     OR public.has_role(auth.uid(), 'service_head'::app_role))
    AND NOT public.elite_card_is_expired(elite_customers)
  )
  WITH CHECK (
    (   public.has_role(auth.uid(), 'sales'::app_role)
     OR public.has_role(auth.uid(), 'accounts'::app_role)
     OR public.has_role(auth.uid(), 'service_head'::app_role))
    AND NOT public.elite_card_is_expired(elite_customers)
  );

-- ------------------------------------------------------------------
-- 3. Lead opt-in must not silently revive an expired card.
--    The trigger is SECURITY DEFINER, so RLS does not stop it: a salesperson
--    opting in a lead whose phone matches an expired card would flip it back
--    to 'active'. Non-admins now get a clear error; admin renews the card
--    (new issue date => new 3-year term).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_lead_elite_optin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new_id UUID;
  v_issue DATE;
  v_existing UUID;
  v_ten TEXT;
  v_card public.elite_customers%ROWTYPE;
  v_is_admin BOOLEAN := auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin'::app_role);
BEGIN
  IF NEW.elite_opted_in IS TRUE AND (OLD.elite_opted_in IS DISTINCT FROM TRUE) THEN
    IF NEW.elite_card_id IS NULL THEN
      v_issue := COALESCE(NEW.elite_opted_date, CURRENT_DATE);
      v_ten := right(regexp_replace(COALESCE(NEW.customer_phone,''), '\D', '', 'g'), 10);

      SELECT id INTO v_existing
      FROM public.elite_customers
      WHERE v_ten <> ''
        AND right(regexp_replace(phone_1, '\D', '', 'g'), 10) = v_ten
      ORDER BY created_at
      LIMIT 1;

      IF v_existing IS NULL THEN
        INSERT INTO public.elite_customers (customer_name, phone_1, card_issue_date, status, lead_id, created_by, notes)
        VALUES (NEW.customer_name, NEW.customer_phone, v_issue, 'active', NEW.id,
                COALESCE(NEW.updated_by, NEW.created_by), 'Auto-enrolled from lead')
        RETURNING id INTO v_new_id;
        NEW.elite_card_id := v_new_id;
        RETURN NEW;
      END IF;
    ELSE
      v_existing := NEW.elite_card_id;
    END IF;

    SELECT * INTO v_card FROM public.elite_customers WHERE id = v_existing;
    IF FOUND AND public.elite_card_is_expired(v_card) THEN
      IF NOT v_is_admin THEN
        RAISE EXCEPTION 'ELITE_CARD_EXPIRED: this customer has an expired Elite card. Ask an admin to reactivate it.'
          USING ERRCODE = '42501';
      END IF;
      -- Admin re-enrolment: fresh 3-year term from today.
      UPDATE public.elite_customers
         SET status = 'active',
             card_issue_date = (now() AT TIME ZONE 'Asia/Kolkata')::date,
             lead_id = COALESCE(lead_id, NEW.id),
             updated_at = now()
       WHERE id = v_existing;
    ELSE
      UPDATE public.elite_customers
         SET status = 'active',
             lead_id = COALESCE(lead_id, NEW.id),
             updated_at = now()
       WHERE id = v_existing;
    END IF;
    NEW.elite_card_id := v_existing;
  END IF;

  IF NEW.elite_opted_in IS FALSE AND (OLD.elite_opted_in IS DISTINCT FROM FALSE) THEN
    IF NEW.elite_card_id IS NOT NULL THEN
      UPDATE public.elite_customers
         SET status = 'opted_out', updated_at = now()
       WHERE id = NEW.elite_card_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ------------------------------------------------------------------
-- 4. Admin-only reactivation (old member re-enrols with payment).
--    Starts a new 3-year term from today; optionally changes the tier.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reactivate_elite_card(
  p_customer_id UUID,
  p_tier        TEXT DEFAULT NULL
)
RETURNS public.elite_customers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_card public.elite_customers%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only an admin can reactivate an Elite card' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_card FROM public.elite_customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Elite card not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.elite_customers
     SET status = 'active',
         card_issue_date = (now() AT TIME ZONE 'Asia/Kolkata')::date,
         card_tier = COALESCE(p_tier, card_tier),
         updated_at = now()
   WHERE id = p_customer_id
   RETURNING * INTO v_card;

  RETURN v_card;
END;
$$;

REVOKE ALL ON FUNCTION public.reactivate_elite_card(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivate_elite_card(UUID, TEXT) TO authenticated;
