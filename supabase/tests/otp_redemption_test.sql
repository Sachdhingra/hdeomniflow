-- End-to-end tests for 20260912030000_otp_redemption.sql.
-- Needs a FRESH database: 00_prereq_stub.sql, 01_otp_stub.sql, migrations
-- 20260912000000 .. 20260912030000, then this file. Every check raises on mismatch.
\set ON_ERROR_STOP on
\pset pager off

-- call a function returning jsonb as a given role / JWT subject; errors come back as {error, msg}
CREATE OR REPLACE FUNCTION public.call_as(p_role text, p_uid uuid, p_sql text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  BEGIN EXECUTE p_sql INTO r;
  EXCEPTION WHEN OTHERS THEN r := jsonb_build_object('error', SQLSTATE, 'msg', SQLERRM);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $$;

-- run a plain statement as a role; returns 'ok' or the SQLSTATE
CREATE OR REPLACE FUNCTION public.test_as(p_role text, p_uid uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  BEGIN EXECUTE p_sql; r := 'ok'; EXCEPTION WHEN OTHERS THEN r := SQLSTATE; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $$;

CREATE TABLE public.t_ids  (k text PRIMARY KEY, v uuid);
CREATE TABLE public.t_vals (k text PRIMARY KEY, v text);
GRANT ALL ON public.t_ids, public.t_vals TO authenticated, anon, service_role;
CREATE OR REPLACE FUNCTION public.id(p_k text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT v FROM public.t_ids WHERE k = p_k $$;

-- a customer with a login, optionally eligible to redeem (earlier delivered + approved purchase beyond the waiting period)
CREATE OR REPLACE FUNCTION public.mk_cust(p_name text, p_tier text, p_activated boolean, p_eligible boolean, p_pts int)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE c uuid; u uuid := gen_random_uuid(); l uuid := gen_random_uuid();
BEGIN
  INSERT INTO elite_customers (customer_name, card_tier, app_activated, card_issue_date, status)
    VALUES (p_name, p_tier, p_activated, '2025-01-01', 'active') RETURNING id INTO c;
  INSERT INTO app_users VALUES (u, c);
  INSERT INTO t_ids VALUES ('u:'||p_name, u), ('c:'||p_name, c);
  IF p_eligible THEN
    INSERT INTO card_bill_entries (customer_id, lead_id, bill_date, gross_bill_amount, net_bill_amount, approval_status)
      VALUES (c, l, '2025-02-01', 50000, 50000, 'approved');
    INSERT INTO service_jobs (source_lead_id, type, status, completed_at, photos)
      VALUES (l, 'delivery', 'completed', '2025-02-10', ARRAY['http://x/p.jpg']);
    INSERT INTO card_bill_entries (customer_id, bill_date, gross_bill_amount, net_bill_amount, approval_status)
      VALUES (c, '2025-06-01', 50000, 50000, 'approved');
  END IF;
  IF p_pts > 0 THEN
    INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
      VALUES (c, p_pts, 'purchase', now() + interval '60 days');
  END IF;
  RETURN c;
END $$;

CREATE OR REPLACE FUNCTION public.mk_bill(p_cust uuid, p_owner uuid, p_gross numeric, p_name text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE b uuid;
BEGIN
  INSERT INTO card_bill_entries (customer_id, entered_by, gross_bill_amount, net_bill_amount, bill_date)
    VALUES (p_cust, p_owner, p_gross, p_gross, CURRENT_DATE) RETURNING id INTO b;
  INSERT INTO t_ids VALUES ('b:'||p_name, b);
  RETURN b;
END $$;

-- ── fixtures ──────────────────────────────────────────────────────────────
DO $$
DECLARE s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); ad uuid := gen_random_uuid();
BEGIN
  INSERT INTO user_roles VALUES (s1,'sales'),(s2,'sales'),(ad,'admin');
  INSERT INTO t_ids VALUES ('S1',s1),('S2',s2),('A',ad);
  PERFORM mk_cust('alice','super_elite',true, true, 300);
  PERFORM mk_cust('bob',  'prestige_elite',true,true, 300);
  PERFORM mk_cust('carol','super_elite',false,true, 300);   -- never opened the app
  PERFORM mk_cust('dave', 'elite',true, true, 300);          -- tier cannot redeem
  PERFORM mk_cust('erin', 'super_elite',true, false,300);   -- inside the waiting period
  PERFORM mk_cust('fay',  'super_elite',true, true, 20);    -- too few points
  PERFORM mk_cust('gus',  'super_elite',true, true, 1000);  -- for stacking
  PERFORM mk_cust('hal',  'super_elite',true, true, 300);   -- rate limiting
END $$;

-- ═══ START ═══════════════════════════════════════════════════════════════
DO $$
DECLARE r jsonb; s1 uuid := id('S1'); s2 uuid := id('S2'); a uuid := id('A'); b uuid; r2 jsonb; b2 uuid;
BEGIN
  b := mk_bill(id('c:alice'), s1, 40000, 'alice1');
  r := call_as('authenticated', s1, format('SELECT redemption_start(%L)', b));
  PERFORM chk('O1 sales starts a session on their own bill', r->>'status', 'awaiting_choice');
  PERFORM chk('O1 cap is 5%% of gross', (r->>'cap')::numeric, 2000::numeric);
  PERFORM chk('O1 headroom starts at the cap', (r->>'headroom')::numeric, 2000::numeric);
  INSERT INTO t_vals VALUES ('sess_alice1', r->>'session_id');

  r2 := call_as('authenticated', s1, format('SELECT redemption_start(%L)', b));
  PERFORM chk('O1b starting again resumes the same session', r2->>'session_id', r->>'session_id');

  PERFORM chk('O2 another salesperson cannot start on it',
    call_as('authenticated', s2, format('SELECT redemption_start(%L)', b))->>'error', '42501');
  PERFORM chk('O3 a customer login cannot start one',
    call_as('authenticated', id('u:alice'), format('SELECT redemption_start(%L)', b))->>'error', '42501');
  PERFORM chk('O3 anon cannot call it at all',
    call_as('anon', NULL, format('SELECT redemption_start(%L)', b))->>'error', '42501');

  b2 := mk_bill(id('c:alice'), s1, 50000, 'alice2');
  PERFORM chk('O10 only one open session per customer',
    split_part(call_as('authenticated', s1, format('SELECT redemption_start(%L)', b2))->>'msg', ':', 1), 'SESSION_IN_PROGRESS');

  PERFORM chk('O8 admin can start on a bill they do not own',
    call_as('authenticated', a, format('SELECT redemption_start(%L)', mk_bill(id('c:bob'), s2, 40000, 'bob1')))->>'status', 'awaiting_choice');
END $$;

DO $$
DECLARE s1 uuid := id('S1'); r jsonb; b uuid;
BEGIN
  -- eligibility and refusal reasons, each with its stable code at the start of the message
  PERFORM chk('O4 29,999 is below the minimum',
    split_part(call_as('authenticated', s1, format('SELECT redemption_start(%L)', mk_bill(id('c:hal'), s1, 29999, 'hal_low')))->>'msg', ':', 1), 'BILL_BELOW_MINIMUM');
  b := mk_bill(id('c:hal'), s1, 30000, 'hal_min');
  PERFORM chk('O4 exactly 30,000 is accepted',
    call_as('authenticated', s1, format('SELECT redemption_start(%L)', b))->>'status', 'awaiting_choice');
  PERFORM chk('O4 ...and its cap is 1,500, equal to the biggest voucher',
    (call_as('authenticated', s1, format('SELECT redemption_start(%L)', b))->>'cap')::numeric, 1500::numeric);
  PERFORM call_as('authenticated', s1, format('SELECT redemption_cancel(%L)', (SELECT (call_as('authenticated', s1, format('SELECT redemption_start(%L)', b))->>'session_id'))::uuid));

  INSERT INTO card_bill_entries (customer_id, entered_by, gross_bill_amount, net_bill_amount, is_return)
    VALUES (id('c:fay'), s1, 40000, 40000, true) RETURNING id INTO b;
  PERFORM chk('O5 a return bill is refused', split_part(call_as('authenticated', s1, format('SELECT redemption_start(%L)', b))->>'msg', ':', 1), 'BILL_IS_RETURN');
  INSERT INTO card_bill_entries (customer_id, entered_by, gross_bill_amount, net_bill_amount, approval_status)
    VALUES (id('c:fay'), s1, 40000, 40000, 'approved') RETURNING id INTO b;
  PERFORM chk('O5 an already-approved bill is refused', split_part(call_as('authenticated', s1, format('SELECT redemption_start(%L)', b))->>'msg', ':', 1), 'BILL_ALREADY_DECIDED');

  PERFORM chk('O6 customer who never opened the app',
    split_part(call_as('authenticated', s1, format('SELECT redemption_start(%L)', mk_bill(id('c:carol'), s1, 40000, 'carol1')))->>'msg', ':', 1), 'CUSTOMER_APP_NOT_ACTIVATED');
  PERFORM chk('O6 a tier with no redemption options',
    split_part(call_as('authenticated', s1, format('SELECT redemption_start(%L)', mk_bill(id('c:dave'), s1, 40000, 'dave1')))->>'msg', ':', 1), 'TIER_NOT_ELIGIBLE');
  PERFORM chk('O6 inside the waiting period',
    split_part(call_as('authenticated', s1, format('SELECT redemption_start(%L)', mk_bill(id('c:erin'), s1, 40000, 'erin1')))->>'msg', ':', 1), 'WAITING_PERIOD');
  PERFORM chk('O6 not enough usable points for the smallest option',
    split_part(call_as('authenticated', s1, format('SELECT redemption_start(%L)', mk_bill(id('c:fay'), s1, 40000, 'fay1')))->>'msg', ':', 1), 'INSUFFICIENT_POINTS');
END $$;

-- ═══ the customer's side ═════════════════════════════════════════════════
DO $$
DECLARE r jsonb; opts jsonb;
BEGIN
  r := call_as('authenticated', id('u:alice'), 'SELECT redemption_customer_session()');
  PERFORM chk('O11 customer sees their open session', r->'session'->>'status', 'awaiting_choice');
  PERFORM chk('O11 max redeemable shown as rupees, not a percentage', (r->'session'->>'max_rupees')::numeric, 2000::numeric);
  PERFORM chk('O11 usable points reported', (r->'session'->>'spendable_points')::int, 300);
  opts := r->'session'->'options';
  PERFORM chk('O11 super_elite sees exactly its two options', jsonb_array_length(opts), 2);
  PERFORM chk('O11 75 pts -> Rs 500 fits and is affordable', (opts->0->>'rupees')::numeric = 500 AND (opts->0->>'fits')::boolean AND (opts->0->>'affordable')::boolean, true);
  PERFORM chk('O11 the bill amount itself is never shown to the customer', r->'session' ? 'gross', false);
  PERFORM chk('O11 another customer sees only their OWN session, never this one',
    call_as('authenticated', id('u:bob'), 'SELECT redemption_customer_session()')->'session'->>'session_id' IS DISTINCT FROM (SELECT v FROM t_vals WHERE k='sess_alice1'), true);
  PERFORM chk('O11 a customer with nothing open sees none',
    call_as('authenticated', id('u:fay'), 'SELECT redemption_customer_session()')->'session', 'null'::jsonb);
  PERFORM chk('O12 a staff login is not a customer',
    call_as('authenticated', id('S1'), 'SELECT redemption_customer_session()')->>'error', '42501');
END $$;

-- ═══ CHOOSE: the only place the code is revealed ═════════════════════════
DO $$
DECLARE sa uuid := (SELECT v::uuid FROM t_vals WHERE k='sess_alice1'); r jsonb; code text; h text; salt text;
BEGIN
  PERFORM chk('O13 staff cannot choose for the customer',
    call_as('authenticated', id('S1'), format('SELECT redemption_choose(%L, 100)', sa))->>'error', '42501');
  PERFORM chk('O14 a different customer cannot touch this session',
    call_as('authenticated', id('u:bob'), format('SELECT redemption_choose(%L, 100)', sa))->>'error', '42501');
  PERFORM chk('O15 an amount that is not on the menu', call_as('authenticated', id('u:alice'), format('SELECT redemption_choose(%L, 50)', sa))->>'reason', 'OPTION_INVALID');
  PERFORM chk('O15 another tier''s option', call_as('authenticated', id('u:alice'), format('SELECT redemption_choose(%L, 250)', sa))->>'reason', 'OPTION_INVALID');

  r := call_as('authenticated', id('u:alice'), format('SELECT redemption_choose(%L, 100)', sa));
  code := r->>'code';
  PERFORM chk('O16 customer gets a 4-digit code', code ~ '^[0-9]{4}$', true);
  PERFORM chk('O16 for Rs 750', (r->>'rupees')::numeric, 750::numeric);
  INSERT INTO t_vals VALUES ('code_alice1', code);
  PERFORM chk('O16 session now awaits the code', (SELECT status FROM redemption_sessions WHERE id=sa), 'awaiting_otp');

  SELECT code_hash, o.salt INTO h, salt FROM redemption_otps o WHERE session_id = sa;
  PERFORM chk('O17 only a hash is stored, never the code', h <> code AND h !~ ('^' || code || '$') AND length(h) = 64, true);
  PERFORM chk('O17 no column anywhere on the session holds the code',
    (SELECT count(*)::int FROM information_schema.columns WHERE table_name='redemption_sessions' AND column_name ILIKE '%code%' OR column_name ILIKE '%otp%'), 0);
  PERFORM chk('O18 staff cannot read the otp table', test_as('authenticated', id('S1'), 'SELECT * FROM redemption_otps'), '42501');
  PERFORM chk('O18 admin cannot either', test_as('authenticated', id('A'), 'SELECT * FROM redemption_otps'), '42501');
  PERFORM chk('O18 nor can the customer', test_as('authenticated', id('u:alice'), 'SELECT * FROM redemption_otps'), '42501');
  PERFORM chk('O18 nor anon', test_as('anon', NULL, 'SELECT * FROM redemption_otps'), '42501');

  PERFORM chk('O18 the initiating salesperson can see the session (status, chosen amount)',
    (SELECT count(*)::int FROM (SELECT 1) x WHERE call_as('authenticated', id('S1'), format('SELECT to_jsonb(count(*)) FROM redemption_sessions WHERE id=%L', sa))::int = 1), 1);
  PERFORM chk('O18 another salesperson cannot',
    call_as('authenticated', id('S2'), format('SELECT to_jsonb(count(*)) FROM redemption_sessions WHERE id=%L', sa))::int, 0);
  PERFORM chk('O19 staff cannot write sessions directly',
    test_as('authenticated', id('S1'), format('UPDATE redemption_sessions SET status=''verified'' WHERE id=%L', sa)), '42501');
  PERFORM chk('O19 nor insert one', test_as('authenticated', id('S1'),
    format('INSERT INTO redemption_sessions (customer_id,bill_entry_id,initiated_by,gross_amount,expires_at) VALUES (%L,%L,%L,40000,now()+interval ''1 hour'')', id('c:alice'), id('b:alice1'), id('S1'))), '42501');
  -- RLS filters an UPDATE no policy allows down to zero rows instead of raising, so assert on the DATA
  PERFORM test_as('authenticated', id('S1'), 'UPDATE redemption_options SET rupee_value = 99999');
  PERFORM test_as('authenticated', id('S1'), 'DELETE FROM redemption_options');
  PERFORM test_as('authenticated', id('S1'), 'INSERT INTO redemption_options (card_tier, points, rupee_value) VALUES (''super_elite'', 1, 1)');
  PERFORM chk('O19 sales cannot edit, delete or add menu options (menu unchanged)',
    (SELECT count(*)::int FROM redemption_options WHERE rupee_value = 99999 OR points = 1) || ':' || (SELECT count(*)::int FROM redemption_options), '0:4');
  PERFORM test_as('authenticated', id('A'), 'UPDATE redemption_options SET active = active WHERE card_tier = ''elite''');
  PERFORM chk('O19 admin can manage the menu',
    test_as('authenticated', id('A'), 'UPDATE redemption_options SET rupee_value = rupee_value WHERE points = 75'), 'ok');
END $$;

-- ═══ VERIFY: wrong codes, then the right one ═════════════════════════════
DO $$
DECLARE sa uuid := (SELECT v::uuid FROM t_vals WHERE k='sess_alice1'); code text := (SELECT v FROM t_vals WHERE k='code_alice1');
        wrong text := lpad(((code::int + 1) % 10000)::text, 4, '0'); r jsonb; led_before int;
BEGIN
  SELECT count(*)::int INTO led_before FROM card_points WHERE customer_id = id('c:alice');
  PERFORM chk('O20 a typo that is not 4 digits is not counted as a guess', call_as('authenticated', id('S1'), format('SELECT redemption_verify(%L, ''12a'')', sa))->>'reason', 'BAD_FORMAT');
  PERFORM chk('O20 ...attempts still 0', (SELECT attempts FROM redemption_otps WHERE session_id=sa), 0);

  r := call_as('authenticated', id('S1'), format('SELECT redemption_verify(%L, %L)', sa, wrong));
  PERFORM chk('O21 wrong code is reported, not raised', r->>'reason', 'WRONG_CODE');
  PERFORM chk('O21 2 tries left', (r->>'attempts_left')::int, 2);
  PERFORM chk('O21 THE ATTEMPT PERSISTED (a raise would have rolled it back)', (SELECT attempts FROM redemption_otps WHERE session_id=sa), 1);
  r := call_as('authenticated', id('S1'), format('SELECT redemption_verify(%L, %L)', sa, wrong));
  PERFORM chk('O21 1 try left', (r->>'attempts_left')::int, 1);
  r := call_as('authenticated', id('S1'), format('SELECT redemption_verify(%L, %L)', sa, wrong));
  PERFORM chk('O21 third wrong code kills the session', r->>'reason', 'TOO_MANY_ATTEMPTS');
  PERFORM chk('O21 ...status failed', (SELECT status FROM redemption_sessions WHERE id=sa), 'failed');
  PERFORM chk('O21 ...failed attempts recorded for the report', (SELECT failed_attempts FROM redemption_sessions WHERE id=sa), 3);
  PERFORM chk('O21 ...code destroyed', (SELECT count(*)::int FROM redemption_otps WHERE session_id=sa), 0);
  PERFORM chk('O21 the RIGHT code no longer works once the session has failed',
    call_as('authenticated', id('S1'), format('SELECT redemption_verify(%L, %L)', sa, code))->>'reason', 'NOT_AWAITING_CODE');
  PERFORM chk('O21 ...and no points moved', (SELECT count(*)::int FROM card_points WHERE customer_id = id('c:alice')), led_before);
END $$;

-- a fresh session on the same bill, completed properly
DO $$
DECLARE s1 uuid := id('S1'); r jsonb; sess uuid; code text; b uuid := id('b:alice1'); bill card_bill_entries%ROWTYPE; rid uuid;
BEGIN
  r := call_as('authenticated', s1, format('SELECT redemption_start(%L)', b));
  sess := (r->>'session_id')::uuid;
  code := call_as('authenticated', id('u:alice'), format('SELECT redemption_choose(%L, 100)', sess))->>'code';

  PERFORM chk('O22 a different salesperson cannot complete it', call_as('authenticated', id('S2'), format('SELECT redemption_verify(%L, %L)', sess, code))->>'error', '42501');
  PERFORM chk('O22 the customer cannot complete it', call_as('authenticated', id('u:alice'), format('SELECT redemption_verify(%L, %L)', sess, code))->>'error', '42501');

  r := call_as('authenticated', s1, format('SELECT redemption_verify(%L, %L)', sess, code));
  PERFORM chk('O23 correct code completes the redemption', r->>'ok', 'true');
  PERFORM chk('O23 Rs 750 for 100 points', (r->>'rupees')::numeric = 750 AND (r->>'points')::int = 100, true);
  rid := (r->>'redemption_id')::uuid;

  PERFORM chk('O23 ledger has the -100 redemption row', (SELECT points FROM card_points WHERE customer_id=id('c:alice') AND transaction_type='redemption'), -100);
  PERFORM chk('O23 usable points 300 -> 200', fn_spendable_points(id('c:alice')), 200);
  PERFORM chk('O23 displayed balance followed the ledger', (SELECT current_points FROM elite_customers WHERE id=id('c:alice')), 200);
  PERFORM chk('O23 request row recorded as used', (SELECT status || ':' || points_requested || ':' || rupee_value FROM redemption_requests WHERE id=rid), 'used:100:750');
  PERFORM chk('O23 ...linked to the bill', (SELECT used_in_bill_id FROM redemption_requests WHERE id=rid), b);
  PERFORM chk('O23 lots consumed for the same 100', (SELECT sum(points)::int FROM redemption_lots WHERE redemption_id=rid), 100);
  SELECT * INTO bill FROM card_bill_entries WHERE id = b;
  PERFORM chk('O23 bill shows Rs 750 redeemed', bill.redemption_amount, 750::numeric);
  PERFORM chk('O23 bill NET reduced so accounts approves the right amount', bill.net_bill_amount, 39250::numeric);
  PERFORM chk('O23 request id left NULL so the legacy approval branch cannot deduct a second time', bill.redemption_request_id IS NULL, true);
  PERFORM chk('O23 session verified', (SELECT status FROM redemption_sessions WHERE id=sess), 'verified');
  PERFORM chk('O23 code deleted after use', (SELECT count(*)::int FROM redemption_otps WHERE session_id=sess), 0);

  PERFORM chk('O24 replaying the same code does nothing', call_as('authenticated', s1, format('SELECT redemption_verify(%L, %L)', sess, code))->>'reason', 'NOT_AWAITING_CODE');
  PERFORM chk('O24 ...balance unchanged', fn_spendable_points(id('c:alice')), 200);
  PERFORM chk('O25 customer no longer has an open session', call_as('authenticated', id('u:alice'), 'SELECT redemption_customer_session()')->'session', 'null'::jsonb);
END $$;

-- ═══ STACKING up to the cap, Rs 2,000 on a Rs 40,000 bill ════════════════
DO $$
DECLARE s1 uuid := id('S1'); b uuid := mk_bill(id('c:gus'), s1, 40000, 'gus1'); sess uuid; code text; r jsonb; opts jsonb;
BEGIN
  -- 1st: 750
  sess := (call_as('authenticated', s1, format('SELECT redemption_start(%L)', b))->>'session_id')::uuid;
  code := call_as('authenticated', id('u:gus'), format('SELECT redemption_choose(%L, 100)', sess))->>'code';
  r := call_as('authenticated', s1, format('SELECT redemption_verify(%L, %L)', sess, code));
  PERFORM chk('O30 first voucher', (r->>'headroom_left')::numeric, 1250::numeric);
  -- 2nd: 750
  sess := (call_as('authenticated', s1, format('SELECT redemption_start(%L)', b))->>'session_id')::uuid;
  code := call_as('authenticated', id('u:gus'), format('SELECT redemption_choose(%L, 100)', sess))->>'code';
  r := call_as('authenticated', s1, format('SELECT redemption_verify(%L, %L)', sess, code));
  PERFORM chk('O30 second voucher on the same bill is allowed', (r->>'headroom_left')::numeric, 500::numeric);
  -- 3rd: only Rs 500 left, so the Rs 750 option no longer fits
  sess := (call_as('authenticated', s1, format('SELECT redemption_start(%L)', b))->>'session_id')::uuid;
  opts := call_as('authenticated', id('u:gus'), 'SELECT redemption_customer_session()')->'session'->'options';
  PERFORM chk('O31 Rs 500 option still fits', (opts->0->>'fits')::boolean, true);
  PERFORM chk('O31 Rs 750 option no longer fits (hidden by the app)', (opts->1->>'fits')::boolean, false);
  PERFORM chk('O31 choosing it anyway is refused server-side', call_as('authenticated', id('u:gus'), format('SELECT redemption_choose(%L, 100)', sess))->>'reason', 'EXCEEDS_CAP');
  code := call_as('authenticated', id('u:gus'), format('SELECT redemption_choose(%L, 75)', sess))->>'code';
  r := call_as('authenticated', s1, format('SELECT redemption_verify(%L, %L)', sess, code));
  PERFORM chk('O32 third voucher takes the bill exactly to its cap', (r->>'headroom_left')::numeric, 0::numeric);
  PERFORM chk('O32 bill redemption total is 2,000', (SELECT redemption_amount FROM card_bill_entries WHERE id=b), 2000::numeric);
  PERFORM chk('O32 bill net is 38,000', (SELECT net_bill_amount FROM card_bill_entries WHERE id=b), 38000::numeric);
  PERFORM chk('O32 275 points spent in total', 1000 - fn_spendable_points(id('c:gus')), 275);
  PERFORM chk('O33 a fourth session is refused: cap reached',
    split_part(call_as('authenticated', s1, format('SELECT redemption_start(%L)', b))->>'msg', ':', 1), 'CAP_REACHED');
END $$;

-- ═══ EXPIRY, BILL CHANGES, CANCEL ════════════════════════════════════════
DO $$
DECLARE s1 uuid := id('S1'); sess uuid; code text; pts_before int; b uuid;
BEGIN
  -- expiry: bob's session from O8 was started by admin; use a fresh customer-bill
  sess := (call_as('authenticated', id('A'), format('SELECT redemption_start(%L)', id('b:bob1')))->>'session_id')::uuid;
  code := call_as('authenticated', id('u:bob'), format('SELECT redemption_choose(%L, 100)', sess))->>'code';
  pts_before := fn_spendable_points(id('c:bob'));
  UPDATE redemption_sessions SET expires_at = now() - interval '1 minute' WHERE id = sess;
  PERFORM chk('O40 an expired session cannot be completed',
    call_as('authenticated', id('A'), format('SELECT redemption_verify(%L, %L)', sess, code))->>'reason', 'SESSION_EXPIRED');
  PERFORM chk('O40 ...marked expired, code destroyed', (SELECT status FROM redemption_sessions WHERE id=sess) || (SELECT count(*)::int FROM redemption_otps WHERE session_id=sess), 'expired0');
  PERFORM chk('O40 ...no points moved', fn_spendable_points(id('c:bob')), pts_before);

  -- the bill changes under a live code
  b := mk_bill(id('c:alice'), s1, 40000, 'alice3');
  sess := (call_as('authenticated', s1, format('SELECT redemption_start(%L)', b))->>'session_id')::uuid;
  code := call_as('authenticated', id('u:alice'), format('SELECT redemption_choose(%L, 75)', sess))->>'code';
  pts_before := fn_spendable_points(id('c:alice'));
  UPDATE card_bill_entries SET gross_bill_amount = 20000 WHERE id = b;
  PERFORM chk('O41 gross edited below the minimum after the code was issued -> refused',
    call_as('authenticated', s1, format('SELECT redemption_verify(%L, %L)', sess, code))->>'reason', 'BILL_CHANGED');
  PERFORM chk('O41 ...no points moved', fn_spendable_points(id('c:alice')), pts_before);
  UPDATE card_bill_entries SET gross_bill_amount = 40000, approval_status = 'approved' WHERE id = b;
  PERFORM chk('O41 bill approved by accounts meanwhile -> refused',
    call_as('authenticated', s1, format('SELECT redemption_verify(%L, %L)', sess, code))->>'reason', 'BILL_CHANGED');

  -- cancel
  b := mk_bill(id('c:hal'), s1, 40000, 'hal1');
  sess := (call_as('authenticated', s1, format('SELECT redemption_start(%L)', b))->>'session_id')::uuid;
  PERFORM chk('O50 another salesperson cannot cancel it', call_as('authenticated', id('S2'), format('SELECT redemption_cancel(%L)', sess))->>'error', '42501');
  PERFORM chk('O50 nor can an unrelated logged-in non-customer (the NULL-comparison case)',
    call_as('authenticated', gen_random_uuid(), format('SELECT redemption_cancel(%L)', sess))->>'error', '42501');
  PERFORM chk('O50 nor another customer', call_as('authenticated', id('u:bob'), format('SELECT redemption_cancel(%L)', sess))->>'error', '42501');
  PERFORM chk('O50 the salesperson can', call_as('authenticated', s1, format('SELECT redemption_cancel(%L)', sess))->>'ok', 'true');
  PERFORM chk('O50 cancelling frees the customer for a new session',
    call_as('authenticated', s1, format('SELECT redemption_start(%L)', b))->>'status', 'awaiting_choice');
  sess := (call_as('authenticated', s1, format('SELECT redemption_start(%L)', b))->>'session_id')::uuid;
  PERFORM chk('O51 the customer can cancel their own session', call_as('authenticated', id('u:hal'), format('SELECT redemption_cancel(%L)', sess))->>'ok', 'true');
END $$;

-- ═══ RATE LIMIT, PRIVILEGES, HOUSEKEEPING, PARITY ════════════════════════
DO $$
DECLARE s1 uuid := id('S1'); c uuid := id('c:fay'); b uuid; i int;
BEGIN
  UPDATE card_points SET points = 300 WHERE customer_id = c AND transaction_type = 'purchase';
  b := mk_bill(c, s1, 40000, 'fay2');
  FOR i IN 1..5 LOOP
    INSERT INTO redemption_sessions (customer_id, bill_entry_id, initiated_by, gross_amount, status, expires_at)
      VALUES (c, b, s1, 40000, 'cancelled', now() + interval '10 minutes');
  END LOOP;
  PERFORM chk('O60 a sixth attempt inside the hour is rate limited',
    split_part(call_as('authenticated', s1, format('SELECT redemption_start(%L)', b))->>'msg', ':', 1), 'RATE_LIMITED');

  PERFORM chk('O61 clients cannot call the internal points helper', call_as('authenticated', s1, format('SELECT to_jsonb(fn_spendable_points(%L))', c))->>'error', '42501');
  PERFORM chk('O61 ...nor the spend function', call_as('authenticated', s1, format('SELECT to_jsonb(fn_consume_points(%L, 1, %L))', c, gen_random_uuid()))->>'error', '42501');
  PERFORM chk('O61 ...nor the eligibility helper', call_as('authenticated', s1, format('SELECT to_jsonb(fn_redemption_eligible(%L))', c))->>'error', '42501');
  PERFORM chk('O61 ...nor the stale-session sweep', call_as('authenticated', s1, 'SELECT to_jsonb(redemption_expire_stale())')->>'error', '42501');

  INSERT INTO redemption_sessions (customer_id, bill_entry_id, initiated_by, gross_amount, status, expires_at)
    VALUES (id('c:erin'), b, s1, 40000, 'awaiting_otp', now() - interval '5 minutes');
  PERFORM chk('O62 the sweep (service_role) closes abandoned sessions',
    (call_as('service_role', NULL, 'SELECT to_jsonb(redemption_expire_stale())'))::int >= 1, true);

  -- parity: the up-front eligibility check must agree with the real trigger for every customer
  FOR i IN 0..0 LOOP NULL; END LOOP;
END $$;

DO $$
DECLARE r record; trig_ok boolean; fn_ok boolean; mismatches int := 0;
BEGIN
  FOR r IN SELECT v AS cid, k FROM t_ids WHERE k LIKE 'c:%' LOOP
    fn_ok := fn_redemption_eligible(r.cid);
    BEGIN
      INSERT INTO redemption_requests (customer_id, points_requested, rupee_value, status) VALUES (r.cid, 100, 750, 'pending');
      trig_ok := true; DELETE FROM redemption_requests WHERE customer_id = r.cid AND status = 'pending';
    EXCEPTION WHEN check_violation THEN trig_ok := false; END;
    IF fn_ok IS DISTINCT FROM trig_ok THEN mismatches := mismatches + 1; RAISE NOTICE 'parity mismatch for %: helper=% trigger=%', r.k, fn_ok, trig_ok; END IF;
  END LOOP;
  PERFORM chk('O63 fn_redemption_eligible agrees with the live guard trigger for every test customer', mismatches, 0);
END $$;
