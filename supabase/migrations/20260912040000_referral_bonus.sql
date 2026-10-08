-- ============================================================
-- Referral bonus, server-side
--
-- PROBLEM: the staff app credited the referrer by inserting +20 straight into
-- card_points from the browser. card_points is admin-write only, so for sales
-- the insert was refused, yet the screen still said "20 bonus pts credited".
-- Live had zero referral rows, so the bonus has never once been paid.
--
-- Points are written only by trusted server functions, so the credit moves here.
--
-- award_referral_bonus(new_member_id, code), sales or admin:
--   * the code must belong to an ACTIVE member (codes exist only after the
--     member activates the app);
--   * a member can be referred ONCE: referral_awards is keyed on the referred
--     member, so a retry, a double submit or a second staff member cannot pay
--     twice, even concurrently;
--   * the referred member must have been added by the caller (admin: anyone)
--     and within the last 24 hours, so a salesperson cannot attach referral
--     bonuses to old records;
--   * no self-referral.
--
-- Like every earned point it expires after points_validity_months (6). The old
-- client insert set no expiry, so those points would never have expired.
-- The amount comes from card_settings.referral_bonus_points (default 20).
--
-- ROLLBACK: DROP FUNCTION public.award_referral_bonus(uuid, text);
--           DROP TABLE public.referral_awards;
-- ============================================================

INSERT INTO public.card_settings (key, value, updated_at)
VALUES ('referral_bonus_points', '20'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.referral_awards (
  referred_customer_id UUID        PRIMARY KEY REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  referrer_customer_id UUID        NOT NULL    REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  points               INTEGER     NOT NULL CHECK (points > 0),
  card_points_id       UUID        REFERENCES public.card_points(id) ON DELETE SET NULL,
  awarded_by           UUID        NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_awards_referrer ON public.referral_awards (referrer_customer_id, created_at);

ALTER TABLE public.referral_awards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referral_awards FROM anon, authenticated;
GRANT SELECT ON public.referral_awards TO authenticated;
GRANT ALL ON public.referral_awards TO service_role;
DROP POLICY IF EXISTS "referral_awards_admin_read" ON public.referral_awards;
CREATE POLICY "referral_awards_admin_read" ON public.referral_awards
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.award_referral_bonus(p_referred_customer UUID, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_admin     BOOLEAN;
  v_referred  public.elite_customers%ROWTYPE;
  v_referrer  public.elite_customers%ROWTYPE;
  v_code      TEXT := upper(btrim(COALESCE(p_code, '')));
  v_points    INTEGER;
  v_validity  INTEGER;
  v_point_id  UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in first' USING ERRCODE = '28000';
  END IF;
  v_admin := public.has_role(v_uid, 'admin'::app_role);
  IF NOT (v_admin OR public.has_role(v_uid, 'sales'::app_role)) THEN
    RAISE EXCEPTION 'FORBIDDEN: only sales or admin can award a referral bonus' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_referred FROM public.elite_customers WHERE id = p_referred_customer;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'CUSTOMER_NOT_FOUND');
  END IF;
  IF NOT v_admin AND v_referred.created_by IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'NOT_YOUR_CUSTOMER: you can only award a bonus for members you added' USING ERRCODE = '42501';
  END IF;
  IF NOT v_admin AND v_referred.created_at < now() - interval '24 hours' THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'TOO_LATE');
  END IF;

  IF v_code = '' THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'NO_CODE');
  END IF;
  IF EXISTS (SELECT 1 FROM public.referral_awards WHERE referred_customer_id = v_referred.id) THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'ALREADY_AWARDED');
  END IF;

  SELECT * INTO v_referrer FROM public.elite_customers
   WHERE referral_code = v_code AND status = 'active' LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'CODE_NOT_FOUND');
  END IF;
  IF v_referrer.id = v_referred.id THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'SELF_REFERRAL');
  END IF;

  v_points   := public.fn_redemption_setting('referral_bonus_points', 20)::int;
  v_validity := public.fn_redemption_setting('points_validity_months', 6)::int;

  -- reserve first: the primary key makes a concurrent second award fail here, before any points move
  BEGIN
    INSERT INTO public.referral_awards (referred_customer_id, referrer_customer_id, points, awarded_by)
    VALUES (v_referred.id, v_referrer.id, v_points, v_uid);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'ALREADY_AWARDED');
  END;

  INSERT INTO public.card_points (customer_id, points, transaction_type, expires_at, notes, created_by)
  VALUES (v_referrer.id, v_points, 'referral', now() + make_interval(months => v_validity),
          'Referral bonus for new member ' || v_referred.customer_name, v_uid)
  RETURNING id INTO v_point_id;

  UPDATE public.referral_awards SET card_points_id = v_point_id WHERE referred_customer_id = v_referred.id;

  RETURN jsonb_build_object('ok', TRUE, 'points', v_points,
                            'referrer_name', v_referrer.customer_name, 'referrer_id', v_referrer.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.award_referral_bonus(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_referral_bonus(uuid, text) TO authenticated;
