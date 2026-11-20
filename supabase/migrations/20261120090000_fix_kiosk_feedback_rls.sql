-- Fix: the kiosk could not submit feedback.
--
-- "new row violates row-level security policy for table customer_feedback"
--
-- Root cause: drizzle/migrations/0001_tighten_staff_only_policies.sql narrowed
-- the "Anyone can submit feedback" policy to require
--
--     reviewed_on_google = false AND thank_you_sent = false
--     AND lead_created = false AND lead_id IS NULL
--
-- but trg_customer_feedback_before_insert always sets lead_id on the row, and
-- sets lead_created too when the customer is new. A WITH CHECK is evaluated
-- against the FINAL row, after BEFORE triggers have run, so the policy can
-- never be satisfied: every submission fails, at any rating, for new and
-- returning customers alike. The customer types everything in and the kiosk
-- rejects it at the last tap.
--
-- The policy also only mattered because 20261002094037 flipped
-- submit_kiosk_feedback from SECURITY DEFINER to SECURITY INVOKER, which moved
-- the INSERT under anon's own permissions. The kiosk runs signed out, so that
-- left the whole flow resting on a blanket anon INSERT policy.
--
-- Rather than restore a policy that both duplicates the function's validation
-- and fights its own triggers, put the function back in charge. It already
-- validates every field, so it is a far narrower opening than any
-- table-level policy for anon: anon may call this function and nothing else.

-- 1. The kiosk's only way in, validating and SECURITY DEFINER again.
CREATE OR REPLACE FUNCTION public.submit_kiosk_feedback(
  p_customer_name text,
  p_customer_phone text,
  p_overall_rating smallint,
  p_staff_rating smallint,
  p_salesperson_name text DEFAULT NULL,
  p_comments text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := NULLIF(btrim(COALESCE(p_customer_name, '')), '');
  v_phone text := regexp_replace(COALESCE(p_customer_phone, ''), '\D', '', 'g');
  v_salesperson text := NULLIF(btrim(COALESCE(p_salesperson_name, '')), '');
  v_comments text := NULLIF(btrim(COALESCE(p_comments, '')), '');
  v_id uuid := gen_random_uuid();
BEGIN
  IF v_name IS NULL OR char_length(v_name) > 100 THEN
    RAISE EXCEPTION 'Name is required and must be 100 characters or fewer';
  END IF;
  IF v_phone !~ '^[6-9][0-9]{9}$' THEN
    RAISE EXCEPTION 'WhatsApp number must be a valid 10-digit Indian mobile number';
  END IF;
  IF p_overall_rating IS NULL OR p_overall_rating NOT BETWEEN 1 AND 5
     OR p_staff_rating IS NULL OR p_staff_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Ratings must be between 1 and 5';
  END IF;
  IF v_salesperson IS NULL OR char_length(v_salesperson) > 100 THEN
    RAISE EXCEPTION 'Salesperson is required and must be 100 characters or fewer';
  END IF;
  IF v_comments IS NOT NULL AND char_length(v_comments) > 500 THEN
    RAISE EXCEPTION 'Comments must be 500 characters or fewer';
  END IF;

  INSERT INTO public.customer_feedback
    (id, customer_name, customer_phone, overall_rating, staff_rating, salesperson_name, comments)
  VALUES
    (v_id, v_name, v_phone, p_overall_rating, p_staff_rating, v_salesperson, v_comments);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_kiosk_feedback(text, text, smallint, smallint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_kiosk_feedback(text, text, smallint, smallint, text, text)
  TO anon, authenticated;

-- 2. Close the direct route. The function no longer needs anon to hold INSERT
--    on the table, and no other code path writes feedback as anon. This drops
--    the unsatisfiable policy above; anything that wants to re-tighten kiosk
--    submission should change the function, not re-add a table policy whose
--    WITH CHECK the insert triggers will contradict.
DROP POLICY IF EXISTS "Anyone can submit feedback" ON public.customer_feedback;
REVOKE INSERT ON public.customer_feedback FROM anon;

-- 3. Admins keep a direct insert for back-office corrections; every other
--    signed-in role has to go through the function like the kiosk does.
DROP POLICY IF EXISTS "Admins insert feedback" ON public.customer_feedback;
CREATE POLICY "Admins insert feedback" ON public.customer_feedback
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

NOTIFY pgrst, 'reload schema';
