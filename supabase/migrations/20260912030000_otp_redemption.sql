-- ============================================================
-- OTP-gated point redemption: backend
--
-- See REDEMPTION_OTP_SPEC.md. Replaces accounts pre-approval with a 4-digit code
-- the customer reads out at the counter.
--
--   1. sales taps Redeem on a pending bill entry     -> redemption_start
--   2. the customer's app shows only options that fit -> redemption_customer_session
--   3. the customer picks one; their app shows a code  -> redemption_choose
--   4. staff types the code; points move atomically    -> redemption_verify
--
-- WHY THE CODE CANNOT LEAK: it is stored only as a salted hash in
-- redemption_otps, a table with RLS on, no policies, and every client privilege
-- revoked. The only function that ever returns the plaintext is
-- redemption_choose, and only to the customer the session belongs to. Staff see
-- the session row (status, chosen amount) but never the code.
--
-- WHY WRONG CODES RETURN A RESULT INSTEAD OF RAISING: an exception rolls the
-- whole call back, including the attempt counter, so a raise would give staff
-- unlimited guesses. Expected business outcomes are returned as {ok:false}.
--
-- ROLLBACK: DROP the five redemption_* functions, fn_redemption_* helpers and
-- fn_spendable_points, then DROP TABLE redemption_otps, redemption_sessions,
-- redemption_options. Nothing else depends on them.
-- ============================================================

-- ── settings (read by the functions; change here, not in code) ────────────

INSERT INTO public.card_settings (key, value, updated_at) VALUES
  ('redemption_min_bill',           '30000'::jsonb, now()),
  ('redemption_otp_minutes',        '10'::jsonb,    now()),
  ('redemption_otp_max_attempts',   '3'::jsonb,     now()),
  ('redemption_sessions_per_hour',  '5'::jsonb,     now())
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_redemption_setting(p_key text, p_default numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF((SELECT value #>> '{}' FROM public.card_settings WHERE key = p_key), '')::numeric, p_default)
$$;

-- ── what a customer can redeem, per tier (authoritative; the apps only display it)

CREATE TABLE IF NOT EXISTS public.redemption_options (
  card_tier    TEXT    NOT NULL,
  points       INTEGER NOT NULL CHECK (points > 0),
  rupee_value  NUMERIC NOT NULL CHECK (rupee_value > 0),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (card_tier, points)
);

INSERT INTO public.redemption_options (card_tier, points, rupee_value) VALUES
  ('super_elite',    75,  500),
  ('super_elite',   100,  750),
  ('prestige_elite',100,  600),
  ('prestige_elite',250, 1500)
ON CONFLICT (card_tier, points) DO NOTHING;

ALTER TABLE public.redemption_options ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.redemption_options FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.redemption_options TO authenticated;
GRANT ALL ON public.redemption_options TO service_role;
DROP POLICY IF EXISTS "redemption_options_read" ON public.redemption_options;
CREATE POLICY "redemption_options_read" ON public.redemption_options
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "redemption_options_admin_write" ON public.redemption_options;
CREATE POLICY "redemption_options_admin_write" ON public.redemption_options
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- ── sessions: one per counter attempt ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.redemption_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID        NOT NULL REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  bill_entry_id   UUID        NOT NULL REFERENCES public.card_bill_entries(id) ON DELETE CASCADE,
  initiated_by    UUID        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'awaiting_choice'
    CHECK (status IN ('awaiting_choice','awaiting_otp','verified','expired','cancelled','failed')),
  gross_amount    NUMERIC     NOT NULL,
  chosen_points   INTEGER,
  chosen_rupees   NUMERIC,
  redemption_id   UUID        REFERENCES public.redemption_requests(id) ON DELETE SET NULL,
  failed_attempts INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  verified_at     TIMESTAMPTZ
);

-- one live session per customer: nothing can get stuck in an "active request" state
CREATE UNIQUE INDEX IF NOT EXISTS uq_redemption_open_session
  ON public.redemption_sessions (customer_id)
  WHERE status IN ('awaiting_choice','awaiting_otp');
CREATE INDEX IF NOT EXISTS idx_redemption_sessions_bill ON public.redemption_sessions (bill_entry_id);
CREATE INDEX IF NOT EXISTS idx_redemption_sessions_recent ON public.redemption_sessions (customer_id, created_at);

ALTER TABLE public.redemption_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.redemption_sessions FROM anon, authenticated;
GRANT SELECT ON public.redemption_sessions TO authenticated;
GRANT ALL ON public.redemption_sessions TO service_role;

-- reads only; every write goes through the functions below
DROP POLICY IF EXISTS "redemption_sessions_admin_read" ON public.redemption_sessions;
CREATE POLICY "redemption_sessions_admin_read" ON public.redemption_sessions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "redemption_sessions_sales_read_own" ON public.redemption_sessions;
CREATE POLICY "redemption_sessions_sales_read_own" ON public.redemption_sessions
  FOR SELECT TO authenticated
  USING (initiated_by = auth.uid() AND public.has_role(auth.uid(), 'sales'::app_role));
DROP POLICY IF EXISTS "redemption_sessions_customer_read_own" ON public.redemption_sessions;
CREATE POLICY "redemption_sessions_customer_read_own" ON public.redemption_sessions
  FOR SELECT TO authenticated
  USING (customer_id = public.get_loyalty_customer_id(auth.uid()));

-- ── the code itself: no policies, no client privileges ────────────────────

CREATE TABLE IF NOT EXISTS public.redemption_otps (
  session_id  UUID        PRIMARY KEY REFERENCES public.redemption_sessions(id) ON DELETE CASCADE,
  code_hash   TEXT        NOT NULL,
  salt        TEXT        NOT NULL,
  attempts    INTEGER     NOT NULL DEFAULT 0,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.redemption_otps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.redemption_otps FROM anon, authenticated;
GRANT ALL ON public.redemption_otps TO service_role;

-- ── helpers (internal: not callable by clients) ───────────────────────────

-- Points a customer can actually spend right now: unconsumed, unexpired lots.
CREATE OR REPLACE FUNCTION public.fn_spendable_points(p_customer UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(points - consumed_points), 0)::int
  FROM public.card_points
  WHERE customer_id = p_customer
    AND points > 0
    AND transaction_type NOT IN ('redemption_reversal','reversal','redemption','expiry')
    AND COALESCE(is_expired, FALSE) = FALSE
    AND consumed_points < points
    AND (expires_at IS NULL OR expires_at > now())
$$;

-- Same rule as fn_guard_redemption_eligibility (the waiting period), exposed as a
-- yes/no so a session can be refused up front instead of failing after the
-- customer has already entered a code.
CREATE OR REPLACE FUNCTION public.fn_redemption_eligible(p_customer UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer     public.elite_customers%ROWTYPE;
  v_window_days  INTEGER;
  v_window_start TIMESTAMPTZ;
  v_ok           BOOLEAN;
BEGIN
  SELECT * INTO v_customer FROM public.elite_customers WHERE id = p_customer;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  v_window_days := COALESCE(
    NULLIF((SELECT value #>> '{}' FROM public.card_settings WHERE key = 'points_cooling_days'), '')::INTEGER, 30);
  v_window_start := public.fn_points_window_start(p_customer, v_customer.card_issue_date, NULL);

  SELECT EXISTS (
    SELECT 1 FROM public.card_bill_entries
    WHERE customer_id = p_customer
      AND approval_status = 'approved'
      AND is_return = FALSE
      AND (v_customer.card_issue_date IS NULL OR bill_date >= v_customer.card_issue_date)
      AND (v_window_start IS NULL OR bill_date >= (v_window_start::date + v_window_days))
  ) INTO v_ok;
  RETURN v_ok;
END;
$$;

-- Rupees still redeemable on a bill: cap (a % of gross) minus what is already used on it.
CREATE OR REPLACE FUNCTION public.fn_redemption_headroom(p_bill UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT round(b.gross_bill_amount * public.fn_redemption_setting('redemption_cap_pct_of_bill', 5) / 100, 2)
       - COALESCE((SELECT SUM(r.rupee_value) FROM public.redemption_requests r
                    WHERE r.used_in_bill_id = b.id AND r.status = 'used'), 0)
  FROM public.card_bill_entries b WHERE b.id = p_bill
$$;

REVOKE EXECUTE ON FUNCTION public.fn_redemption_setting(text, numeric),
  public.fn_spendable_points(uuid), public.fn_redemption_eligible(uuid), public.fn_redemption_headroom(uuid)
  FROM PUBLIC, anon, authenticated;

-- ── 1. STAFF: start a redemption on a pending bill entry ──────────────────

CREATE OR REPLACE FUNCTION public.redemption_start(p_bill_entry_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_admin      BOOLEAN;
  v_bill       public.card_bill_entries%ROWTYPE;
  v_cust       public.elite_customers%ROWTYPE;
  v_min_bill   NUMERIC;
  v_cap        NUMERIC;
  v_headroom   NUMERIC;
  v_min_rupees NUMERIC;
  v_min_points INTEGER;
  v_spendable  INTEGER;
  v_open       public.redemption_sessions%ROWTYPE;
  v_recent     INTEGER;
  v_session    UUID;
  v_expires    TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in first' USING ERRCODE = '28000';
  END IF;
  v_admin := public.has_role(v_uid, 'admin'::app_role);
  IF NOT (v_admin OR public.has_role(v_uid, 'sales'::app_role)) THEN
    RAISE EXCEPTION 'FORBIDDEN: only sales or admin can start a redemption' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_bill FROM public.card_bill_entries WHERE id = p_bill_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BILL_NOT_FOUND: no such bill entry';
  END IF;
  IF NOT v_admin AND v_bill.entered_by IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'BILL_NOT_YOURS: you can only redeem on your own bill entries' USING ERRCODE = '42501';
  END IF;
  IF v_bill.is_return THEN
    RAISE EXCEPTION 'BILL_IS_RETURN: points cannot be redeemed on a return';
  END IF;
  IF v_bill.approval_status <> 'pending' THEN
    RAISE EXCEPTION 'BILL_ALREADY_DECIDED: this bill entry is already %', v_bill.approval_status;
  END IF;

  SELECT * INTO v_cust FROM public.elite_customers WHERE id = v_bill.customer_id;
  IF v_cust.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'CUSTOMER_INACTIVE: this card is not active';
  END IF;
  IF NOT COALESCE(v_cust.app_activated, FALSE) THEN
    RAISE EXCEPTION 'CUSTOMER_APP_NOT_ACTIVATED: the customer has not activated the app, so no code can be shown to them';
  END IF;
  SELECT min(rupee_value), min(points) INTO v_min_rupees, v_min_points
  FROM public.redemption_options WHERE card_tier = v_cust.card_tier AND active;
  IF v_min_rupees IS NULL THEN
    RAISE EXCEPTION 'TIER_NOT_ELIGIBLE: this card tier cannot redeem points';
  END IF;
  IF NOT public.fn_redemption_eligible(v_cust.id) THEN
    RAISE EXCEPTION 'WAITING_PERIOD: points can be redeemed from the next purchase after the waiting period from the card purchase';
  END IF;

  v_min_bill := public.fn_redemption_setting('redemption_min_bill', 30000);
  IF v_bill.gross_bill_amount < v_min_bill THEN
    RAISE EXCEPTION 'BILL_BELOW_MINIMUM: redemption needs a bill of at least Rs %, this bill is Rs %', v_min_bill, v_bill.gross_bill_amount;
  END IF;

  v_cap      := round(v_bill.gross_bill_amount * public.fn_redemption_setting('redemption_cap_pct_of_bill', 5) / 100, 2);
  v_headroom := public.fn_redemption_headroom(v_bill.id);
  IF v_headroom < v_min_rupees THEN
    RAISE EXCEPTION 'CAP_REACHED: this bill allows Rs % in total and only Rs % is left', v_cap, v_headroom;
  END IF;

  v_spendable := public.fn_spendable_points(v_cust.id);
  IF v_spendable < v_min_points THEN
    RAISE EXCEPTION 'INSUFFICIENT_POINTS: the customer has % usable points, the smallest redemption needs %', v_spendable, v_min_points;
  END IF;

  -- tidy: anything left open past its time is no longer open
  UPDATE public.redemption_sessions SET status = 'expired'
   WHERE customer_id = v_cust.id AND status IN ('awaiting_choice','awaiting_otp') AND expires_at < now();

  SELECT * INTO v_open FROM public.redemption_sessions
   WHERE customer_id = v_cust.id AND status IN ('awaiting_choice','awaiting_otp') LIMIT 1;
  IF FOUND THEN
    IF v_open.bill_entry_id = v_bill.id AND (v_admin OR v_open.initiated_by = v_uid) THEN
      RETURN jsonb_build_object('session_id', v_open.id, 'status', v_open.status, 'expires_at', v_open.expires_at,
        'resumed', TRUE, 'customer_name', v_cust.customer_name, 'cap', v_cap, 'headroom', v_headroom);
    END IF;
    RAISE EXCEPTION 'SESSION_IN_PROGRESS: this customer already has a redemption in progress';
  END IF;

  SELECT count(*) INTO v_recent FROM public.redemption_sessions
   WHERE customer_id = v_cust.id AND created_at > now() - interval '1 hour';
  IF v_recent >= public.fn_redemption_setting('redemption_sessions_per_hour', 5) THEN
    RAISE EXCEPTION 'RATE_LIMITED: too many redemption attempts for this customer in the last hour';
  END IF;

  v_expires := now() + make_interval(mins => public.fn_redemption_setting('redemption_otp_minutes', 10)::int);
  BEGIN
    INSERT INTO public.redemption_sessions (customer_id, bill_entry_id, initiated_by, gross_amount, expires_at)
    VALUES (v_cust.id, v_bill.id, v_uid, v_bill.gross_bill_amount, v_expires)
    RETURNING id INTO v_session;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'SESSION_IN_PROGRESS: this customer already has a redemption in progress';
  END;

  RETURN jsonb_build_object('session_id', v_session, 'status', 'awaiting_choice', 'expires_at', v_expires,
    'resumed', FALSE, 'customer_name', v_cust.customer_name, 'customer_id', v_cust.id,
    'cap', v_cap, 'headroom', v_headroom);
END;
$$;

-- ── 2. CUSTOMER: what can I choose right now? ─────────────────────────────

CREATE OR REPLACE FUNCTION public.redemption_customer_session()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer UUID := public.get_loyalty_customer_id(auth.uid());
  v_cust     public.elite_customers%ROWTYPE;
  v_s        public.redemption_sessions%ROWTYPE;
  v_headroom NUMERIC;
  v_spend    INTEGER;
  v_opts     JSONB;
BEGIN
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'NOT_A_CUSTOMER: this login is not linked to a card' USING ERRCODE = '42501';
  END IF;

  UPDATE public.redemption_sessions SET status = 'expired'
   WHERE customer_id = v_customer AND status IN ('awaiting_choice','awaiting_otp') AND expires_at < now();

  SELECT * INTO v_s FROM public.redemption_sessions
   WHERE customer_id = v_customer AND status IN ('awaiting_choice','awaiting_otp')
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('session', NULL);
  END IF;

  SELECT * INTO v_cust FROM public.elite_customers WHERE id = v_customer;
  v_headroom := public.fn_redemption_headroom(v_s.bill_entry_id);
  v_spend    := public.fn_spendable_points(v_customer);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'points', o.points, 'rupees', o.rupee_value,
           'fits', o.rupee_value <= v_headroom,
           'affordable', v_spend >= o.points,
           'short_by', GREATEST(o.points - v_spend, 0)) ORDER BY o.points), '[]'::jsonb)
    INTO v_opts
  FROM public.redemption_options o WHERE o.card_tier = v_cust.card_tier AND o.active;

  RETURN jsonb_build_object('session', jsonb_build_object(
    'session_id', v_s.id, 'status', v_s.status, 'expires_at', v_s.expires_at,
    'max_rupees', v_headroom, 'spendable_points', v_spend, 'options', v_opts,
    'chosen_points', v_s.chosen_points, 'chosen_rupees', v_s.chosen_rupees));
END;
$$;

-- ── 3. CUSTOMER: pick an option; this is the only place the code is revealed ─

CREATE OR REPLACE FUNCTION public.redemption_choose(p_session_id UUID, p_points INTEGER)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer UUID := public.get_loyalty_customer_id(auth.uid());
  v_cust     public.elite_customers%ROWTYPE;
  v_s        public.redemption_sessions%ROWTYPE;
  v_opt      public.redemption_options%ROWTYPE;
  v_bill     public.card_bill_entries%ROWTYPE;
  v_code     TEXT;
  v_salt     TEXT;
  v_expires  TIMESTAMPTZ;
BEGIN
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'NOT_A_CUSTOMER: this login is not linked to a card' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_s FROM public.redemption_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_s.customer_id <> v_customer THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND: no such redemption' USING ERRCODE = '42501';
  END IF;
  IF v_s.status NOT IN ('awaiting_choice','awaiting_otp') THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'SESSION_CLOSED', 'status', v_s.status);
  END IF;
  IF v_s.expires_at < now() THEN
    UPDATE public.redemption_sessions SET status = 'expired' WHERE id = v_s.id;
    DELETE FROM public.redemption_otps WHERE session_id = v_s.id;
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'SESSION_EXPIRED');
  END IF;

  SELECT * INTO v_cust FROM public.elite_customers WHERE id = v_customer;
  SELECT * INTO v_opt FROM public.redemption_options
   WHERE card_tier = v_cust.card_tier AND points = p_points AND active;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'OPTION_INVALID');
  END IF;

  SELECT * INTO v_bill FROM public.card_bill_entries WHERE id = v_s.bill_entry_id;
  IF v_bill.approval_status <> 'pending' OR v_bill.is_return THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'BILL_CHANGED');
  END IF;
  IF v_opt.rupee_value > public.fn_redemption_headroom(v_s.bill_entry_id) THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'EXCEEDS_CAP');
  END IF;
  IF public.fn_spendable_points(v_customer) < v_opt.points THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'INSUFFICIENT_POINTS');
  END IF;

  -- 4 random digits from the CSPRNG behind gen_random_uuid(); leading zeros kept
  v_code := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint) % 10000)::text, 4, '0');
  v_salt := gen_random_uuid()::text;
  v_expires := now() + make_interval(mins => public.fn_redemption_setting('redemption_otp_minutes', 10)::int);

  INSERT INTO public.redemption_otps (session_id, code_hash, salt, attempts, issued_at)
  VALUES (v_s.id, encode(sha256(convert_to(v_salt || ':' || v_code, 'UTF8')), 'hex'), v_salt, 0, now())
  ON CONFLICT (session_id) DO UPDATE
    SET code_hash = EXCLUDED.code_hash, salt = EXCLUDED.salt, attempts = 0, issued_at = now();

  UPDATE public.redemption_sessions
     SET status = 'awaiting_otp', chosen_points = v_opt.points, chosen_rupees = v_opt.rupee_value, expires_at = v_expires
   WHERE id = v_s.id;

  RETURN jsonb_build_object('ok', TRUE, 'code', v_code, 'points', v_opt.points,
                            'rupees', v_opt.rupee_value, 'expires_at', v_expires);
END;
$$;

-- ── 4. STAFF: type the code; everything happens in this one transaction ───

CREATE OR REPLACE FUNCTION public.redemption_verify(p_session_id UUID, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_admin     BOOLEAN;
  v_s         public.redemption_sessions%ROWTYPE;
  v_otp       public.redemption_otps%ROWTYPE;
  v_bill      public.card_bill_entries%ROWTYPE;
  v_max       INTEGER := public.fn_redemption_setting('redemption_otp_max_attempts', 3)::int;
  v_left      INTEGER;
  v_rid       UUID;
  v_headroom  NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in first' USING ERRCODE = '28000';
  END IF;
  v_admin := public.has_role(v_uid, 'admin'::app_role);
  IF NOT (v_admin OR public.has_role(v_uid, 'sales'::app_role)) THEN
    RAISE EXCEPTION 'FORBIDDEN: only sales or admin can complete a redemption' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_s FROM public.redemption_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND: no such redemption' USING ERRCODE = '42501';
  END IF;
  IF NOT v_admin AND v_s.initiated_by <> v_uid THEN
    RAISE EXCEPTION 'FORBIDDEN: only the person who started this redemption can complete it' USING ERRCODE = '42501';
  END IF;

  IF v_s.status <> 'awaiting_otp' THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'NOT_AWAITING_CODE', 'status', v_s.status);
  END IF;
  IF v_s.expires_at < now() THEN
    UPDATE public.redemption_sessions SET status = 'expired' WHERE id = v_s.id;
    DELETE FROM public.redemption_otps WHERE session_id = v_s.id;
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'SESSION_EXPIRED');
  END IF;
  IF p_code IS NULL OR btrim(p_code) !~ '^[0-9]{4}$' THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'BAD_FORMAT');   -- a typo is not a guess
  END IF;

  SELECT * INTO v_otp FROM public.redemption_otps WHERE session_id = v_s.id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'NO_CODE_ISSUED');
  END IF;

  IF v_otp.code_hash <> encode(sha256(convert_to(v_otp.salt || ':' || btrim(p_code), 'UTF8')), 'hex') THEN
    UPDATE public.redemption_otps SET attempts = attempts + 1 WHERE session_id = v_s.id;
    UPDATE public.redemption_sessions SET failed_attempts = failed_attempts + 1 WHERE id = v_s.id;
    v_left := v_max - (v_otp.attempts + 1);
    IF v_left <= 0 THEN
      UPDATE public.redemption_sessions SET status = 'failed' WHERE id = v_s.id;
      DELETE FROM public.redemption_otps WHERE session_id = v_s.id;
      RETURN jsonb_build_object('ok', FALSE, 'reason', 'TOO_MANY_ATTEMPTS', 'attempts_left', 0);
    END IF;
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'WRONG_CODE', 'attempts_left', v_left);
  END IF;

  -- correct code: re-validate the bill as it is NOW, not as it was at the start
  SELECT * INTO v_bill FROM public.card_bill_entries WHERE id = v_s.bill_entry_id FOR UPDATE;
  IF v_bill.approval_status <> 'pending' OR v_bill.is_return
     OR v_bill.gross_bill_amount < public.fn_redemption_setting('redemption_min_bill', 30000) THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'BILL_CHANGED');
  END IF;
  v_headroom := public.fn_redemption_headroom(v_bill.id);
  IF v_s.chosen_rupees > v_headroom THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'EXCEEDS_CAP', 'headroom', v_headroom);
  END IF;

  INSERT INTO public.redemption_requests
    (customer_id, points_requested, rupee_value, status, requested_at, processed_at, processed_by, used_in_bill_id, notes)
  VALUES
    (v_s.customer_id, v_s.chosen_points, v_s.chosen_rupees, 'used', v_s.created_at, now(), v_uid, v_bill.id,
     'OTP redemption, session ' || v_s.id::text)
  RETURNING id INTO v_rid;

  PERFORM public.fn_consume_points(v_s.customer_id, v_s.chosen_points, v_rid);

  UPDATE public.card_bill_entries
     SET redemption_amount = redemption_amount + v_s.chosen_rupees,
         net_bill_amount   = GREATEST(net_bill_amount - v_s.chosen_rupees, 0)
   WHERE id = v_bill.id;

  UPDATE public.redemption_sessions
     SET status = 'verified', redemption_id = v_rid, verified_at = now()
   WHERE id = v_s.id;
  DELETE FROM public.redemption_otps WHERE session_id = v_s.id;

  RETURN jsonb_build_object('ok', TRUE, 'redemption_id', v_rid, 'points', v_s.chosen_points,
    'rupees', v_s.chosen_rupees, 'headroom_left', v_headroom - v_s.chosen_rupees,
    'customer_id', v_s.customer_id);
END;
$$;

-- ── cancel (staff who started it, admin, or the customer it belongs to) ───

CREATE OR REPLACE FUNCTION public.redemption_cancel(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_s    public.redemption_sessions%ROWTYPE;
  v_cust UUID := public.get_loyalty_customer_id(auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in first' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_s FROM public.redemption_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND: no such redemption' USING ERRCODE = '42501';
  END IF;
  -- v_cust is NULL for anyone who is not a customer; "x = NULL" is NULL, and NOT (.. OR NULL)
  -- would be NULL (treated as false), silently letting them through. Guard it explicitly.
  IF NOT (public.has_role(v_uid, 'admin'::app_role)
          OR (v_s.initiated_by = v_uid AND public.has_role(v_uid, 'sales'::app_role))
          OR (v_cust IS NOT NULL AND v_s.customer_id = v_cust)) THEN
    RAISE EXCEPTION 'FORBIDDEN: not your redemption' USING ERRCODE = '42501';
  END IF;
  IF v_s.status NOT IN ('awaiting_choice','awaiting_otp') THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'SESSION_CLOSED', 'status', v_s.status);
  END IF;
  UPDATE public.redemption_sessions SET status = 'cancelled' WHERE id = v_s.id;
  DELETE FROM public.redemption_otps WHERE session_id = v_s.id;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

-- housekeeping for a cron job: close sessions nobody finished (service_role only)
CREATE OR REPLACE FUNCTION public.redemption_expire_stale()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INTEGER;
BEGIN
  -- count the SESSIONS closed, not the code rows deleted (a session that never reached the
  -- code step has none); the DELETE runs regardless because data-modifying CTEs always execute
  WITH s AS (
    UPDATE public.redemption_sessions SET status = 'expired'
     WHERE status IN ('awaiting_choice','awaiting_otp') AND expires_at < now()
     RETURNING id),
  d AS (
    DELETE FROM public.redemption_otps WHERE session_id IN (SELECT id FROM s))
  SELECT count(*)::int INTO n FROM s;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redemption_start(uuid), public.redemption_customer_session(),
  public.redemption_choose(uuid, integer), public.redemption_verify(uuid, text),
  public.redemption_cancel(uuid), public.redemption_expire_stale() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redemption_start(uuid), public.redemption_customer_session(),
  public.redemption_choose(uuid, integer), public.redemption_verify(uuid, text),
  public.redemption_cancel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redemption_expire_stale() TO service_role;
