-- Tests for 20260912040000_referral_bonus.sql.
-- Fresh database: 00_prereq_stub.sql, 01_otp_stub.sql, migrations 20260912000000 .. 20260912040000, then this file.
\set ON_ERROR_STOP on
\pset pager off

CREATE OR REPLACE FUNCTION public.call_as(p_role text, p_uid uuid, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  BEGIN EXECUTE p_sql INTO r; EXCEPTION WHEN OTHERS THEN r := jsonb_build_object('error', SQLSTATE, 'msg', SQLERRM); END;
  RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true); RETURN r;
END $$;
CREATE OR REPLACE FUNCTION public.test_as(p_role text, p_uid uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  BEGIN EXECUTE p_sql; r := 'ok'; EXCEPTION WHEN OTHERS THEN r := SQLSTATE; END;
  RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', true); RETURN r;
END $$;
CREATE TABLE public.t_ids (k text PRIMARY KEY, v uuid);
GRANT ALL ON public.t_ids TO authenticated, anon, service_role;
CREATE OR REPLACE FUNCTION public.id(p_k text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT v FROM public.t_ids WHERE k = p_k $$;

DO $$
DECLARE s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); ad uuid := gen_random_uuid(); uc uuid := gen_random_uuid(); c uuid;
BEGIN
  INSERT INTO user_roles VALUES (s1,'sales'),(s2,'sales'),(ad,'admin');
  INSERT INTO t_ids VALUES ('S1',s1),('S2',s2),('A',ad),('uc',uc);
  -- the referrer: active, already has a code
  INSERT INTO elite_customers (customer_name, status, referral_code, card_tier, app_activated) VALUES ('Referrer Rita','active','EC1234ABCD','super_elite',true) RETURNING id INTO c;
  INSERT INTO t_ids VALUES ('rita', c);
  INSERT INTO app_users VALUES (uc, c);
  INSERT INTO elite_customers (customer_name, status, referral_code) VALUES ('Quit Quentin','opted_out','EC9999ZZZZ') RETURNING id INTO c;
  INSERT INTO t_ids VALUES ('quentin', c);
  -- new members added by S1 just now, by S2 just now, and by S1 three days ago
  INSERT INTO elite_customers (customer_name, created_by) VALUES ('New Nina', s1) RETURNING id INTO c;   INSERT INTO t_ids VALUES ('nina', c);
  INSERT INTO elite_customers (customer_name, created_by) VALUES ('New Omar', s2) RETURNING id INTO c;   INSERT INTO t_ids VALUES ('omar', c);
  INSERT INTO elite_customers (customer_name, created_by, created_at) VALUES ('Old Olga', s1, now() - interval '3 days') RETURNING id INTO c; INSERT INTO t_ids VALUES ('olga', c);
  INSERT INTO elite_customers (customer_name, created_by) VALUES ('New Pia', s1) RETURNING id INTO c;    INSERT INTO t_ids VALUES ('pia', c);
  INSERT INTO elite_customers (customer_name, created_by) VALUES ('New Raj', s1) RETURNING id INTO c;    INSERT INTO t_ids VALUES ('raj', c);
  INSERT INTO elite_customers (customer_name, created_by) VALUES ('New Sam', s1) RETURNING id INTO c;    INSERT INTO t_ids VALUES ('sam', c);
END $$;

DO $$
DECLARE r jsonb; s1 uuid := id('S1'); rita uuid := id('rita'); pts_before int; n int;
BEGIN
  pts_before := (SELECT current_points FROM elite_customers WHERE id = rita);

  -- the happy path, with a lowercase, space-padded code (staff type it by hand)
  r := call_as('authenticated', s1, format('SELECT award_referral_bonus(%L, %L)', id('nina'), '  ec1234abcd '));
  PERFORM chk('R1 sales awards the bonus', r->>'ok', 'true');
  PERFORM chk('R1 20 points to Rita', (r->>'points')::int, 20);
  PERFORM chk('R1 referrer named so the screen can say who was credited', r->>'referrer_name', 'Referrer Rita');
  PERFORM chk('R1 a ledger row of type referral', (SELECT count(*)::int FROM card_points WHERE customer_id=rita AND transaction_type='referral' AND points=20), 1);
  PERFORM chk('R1 the displayed balance followed the ledger', (SELECT current_points FROM elite_customers WHERE id=rita), pts_before + 20);
  PERFORM chk('R1 it expires in ~6 months like every other earned point',
    (SELECT round(extract(epoch FROM expires_at - created_at)/86400) BETWEEN 180 AND 184 FROM card_points WHERE customer_id=rita AND transaction_type='referral'), true);
  PERFORM chk('R1 recorded in referral_awards', (SELECT count(*)::int FROM referral_awards WHERE referred_customer_id=id('nina') AND referrer_customer_id=rita AND points=20), 1);

  -- once only
  r := call_as('authenticated', s1, format('SELECT award_referral_bonus(%L, %L)', id('nina'), 'EC1234ABCD'));
  PERFORM chk('R2 a second attempt for the same new member is refused', r->>'reason', 'ALREADY_AWARDED');
  PERFORM chk('R2 ...and no extra points were paid', (SELECT count(*)::int FROM card_points WHERE customer_id=rita AND transaction_type='referral'), 1);

  -- who may call
  PERFORM chk('R3 another salesperson cannot award for a member they did not add',
    call_as('authenticated', id('S2'), format('SELECT award_referral_bonus(%L, %L)', id('pia'), 'EC1234ABCD'))->>'error', '42501');
  PERFORM chk('R3 a customer login cannot call it',
    call_as('authenticated', id('uc'), format('SELECT award_referral_bonus(%L, %L)', id('pia'), 'EC1234ABCD'))->>'error', '42501');
  PERFORM chk('R3 anon cannot call it', call_as('anon', NULL, format('SELECT award_referral_bonus(%L, %L)', id('pia'), 'EC1234ABCD'))->>'error', '42501');
  PERFORM chk('R3 nothing was paid by the refused calls', (SELECT count(*)::int FROM card_points WHERE customer_id=rita AND transaction_type='referral'), 1);

  -- bad input comes back as a result the screen can show, not a crash
  PERFORM chk('R4 unknown code', call_as('authenticated', s1, format('SELECT award_referral_bonus(%L, %L)', id('pia'), 'NOPE000000'))->>'reason', 'CODE_NOT_FOUND');
  PERFORM chk('R4 blank code', call_as('authenticated', s1, format('SELECT award_referral_bonus(%L, %L)', id('pia'), '   '))->>'reason', 'NO_CODE');
  PERFORM chk('R4 a code that belongs to a member who opted out', call_as('authenticated', s1, format('SELECT award_referral_bonus(%L, %L)', id('pia'), 'EC9999ZZZZ'))->>'reason', 'CODE_NOT_FOUND');
  PERFORM chk('R4 a made-up member id', call_as('authenticated', s1, format('SELECT award_referral_bonus(%L, %L)', gen_random_uuid(), 'EC1234ABCD'))->>'reason', 'CUSTOMER_NOT_FOUND');
  PERFORM chk('R4 a member added three days ago is too late', call_as('authenticated', s1, format('SELECT award_referral_bonus(%L, %L)', id('olga'), 'EC1234ABCD'))->>'reason', 'TOO_LATE');
  UPDATE elite_customers SET referral_code = 'EC0000SELF' WHERE id = id('raj');
  PERFORM chk('R4 a member cannot refer themselves', call_as('authenticated', s1, format('SELECT award_referral_bonus(%L, %L)', id('raj'), 'EC0000SELF'))->>'reason', 'SELF_REFERRAL');
  PERFORM chk('R4 refused attempts leave no award rows behind', (SELECT count(*)::int FROM referral_awards), 1);

  -- admin
  PERFORM chk('R5 admin can award for a member someone else added, even an old one',
    call_as('authenticated', id('A'), format('SELECT award_referral_bonus(%L, %L)', id('olga'), 'EC1234ABCD'))->>'ok', 'true');

  -- the points are real points: they expire, and can be spent
  PERFORM chk('R6 referral points can be spent',
    (SELECT fn_spendable_points(rita)) >= 40, true);
  UPDATE card_points SET expires_at = now() - interval '1 day' WHERE customer_id = rita AND transaction_type = 'referral';
  PERFORM fn_expire_points();
  PERFORM chk('R6 and they expire (the 40 referral points are written off)',
    (SELECT COALESCE(sum(points),0)::int FROM card_points WHERE customer_id=rita AND transaction_type='expiry'), -40);

  -- the table is read-only to clients
  PERFORM chk('R7 sales cannot write referral_awards directly',
    test_as('authenticated', s1, format('INSERT INTO referral_awards (referred_customer_id, referrer_customer_id, points, awarded_by) VALUES (%L,%L,20,%L)', id('sam'), rita, s1)), '42501');
  PERFORM chk('R7 ...and the table is still unchanged by that attempt', (SELECT count(*)::int FROM referral_awards WHERE referred_customer_id = id('sam')), 0);
  PERFORM chk('R7 nor read it', (call_as('authenticated', s1, 'SELECT to_jsonb(count(*)) FROM referral_awards'))::int, 0);
END $$;
