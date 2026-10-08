CREATE TABLE public.review_draw_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_month date NOT NULL,
  feedback_id uuid REFERENCES public.customer_feedback(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  source text NOT NULL DEFAULT 'kiosk' CHECK (source IN ('kiosk', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_draw_entries TO authenticated;
GRANT ALL ON public.review_draw_entries TO service_role;

ALTER TABLE public.review_draw_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view review draw entries"
ON public.review_draw_entries
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins manage review draw entries"
ON public.review_draw_entries
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE UNIQUE INDEX uq_review_draw_entry_month_phone
ON public.review_draw_entries (draw_month, customer_phone);

CREATE INDEX idx_review_draw_entries_month
ON public.review_draw_entries (draw_month DESC);

CREATE OR REPLACE FUNCTION public.record_google_review(
  p_feedback_id uuid,
  p_source text DEFAULT 'kiosk'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fb public.customer_feedback%ROWTYPE;
  v_is_admin boolean := false;
  v_month date;
  v_min integer;
  v_count integer;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_is_admin := public.has_role(auth.uid(), 'admin'::public.app_role);
  END IF;

  SELECT * INTO v_fb
  FROM public.customer_feedback
  WHERE id = p_feedback_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Feedback not found';
  END IF;

  IF NOT v_is_admin AND v_fb.created_at < now() - interval '24 hours' THEN
    RAISE EXCEPTION 'This feedback is too old to confirm a review for';
  END IF;

  v_month := date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_min := COALESCE(
    NULLIF(regexp_replace(
      COALESCE((SELECT value FROM public.app_settings WHERE key = 'monthly_draw_min_entries'), ''),
      '\D', '', 'g'
    ), '')::integer,
    50
  );

  UPDATE public.customer_feedback
  SET reviewed_on_google = true
  WHERE id = p_feedback_id;

  INSERT INTO public.review_draw_entries
    (draw_month, feedback_id, customer_name, customer_phone, source)
  VALUES
    (v_month, p_feedback_id, v_fb.customer_name, v_fb.customer_phone,
     CASE WHEN v_is_admin AND p_source <> 'kiosk' THEN 'admin' ELSE 'kiosk' END)
  ON CONFLICT (draw_month, customer_phone) DO NOTHING;

  SELECT count(*) INTO v_count
  FROM public.review_draw_entries
  WHERE draw_month = v_month;

  RETURN jsonb_build_object(
    'draw_month', v_month,
    'entries', v_count,
    'min_entries', v_min,
    'draw_confirmed', v_count >= v_min
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_google_review(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_google_review(uuid, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';