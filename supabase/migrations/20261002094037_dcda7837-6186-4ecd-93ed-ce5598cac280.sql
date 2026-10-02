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
SECURITY INVOKER
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

REVOKE SELECT (id) ON public.customer_feedback FROM anon, authenticated;
NOTIFY pgrst, 'reload schema';