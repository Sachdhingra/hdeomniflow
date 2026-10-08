-- Tests for 20260912010000_lock_customer_self_writes.sql.
-- Run from the repo root (it \ir-includes the migration by relative path), after
-- 00_prereq_stub.sql and the point-lot migration.
--
-- PHASE A reverts to the pre-hardening LIVE state and asserts each exploit
-- WORKS, so the suite proves the gaps were real rather than assumed. PHASE B
-- re-applies the migration and asserts the same actions are refused, while
-- staff, service_role and SECURITY DEFINER paths still go through.
\set ON_ERROR_STOP on
\pset pager off

-- Run one statement as a given role / JWT subject; returns 'ok' or the SQLSTATE.
CREATE OR REPLACE FUNCTION public.test_as(p_role text, p_uid uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  BEGIN
    EXECUTE p_sql;
    r := 'ok';
  EXCEPTION WHEN OTHERS THEN r := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $$;

-- a SECURITY DEFINER function shaped like the live link_loyalty_app_user
CREATE OR REPLACE FUNCTION public.test_link(p_customer uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE elite_customers SET app_activated = true, referral_code = 'EC1234ABCD' WHERE id = p_customer;
END $$;
GRANT EXECUTE ON FUNCTION public.test_link(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.t_ids (k text PRIMARY KEY, v uuid);
GRANT ALL ON public.t_ids TO authenticated, anon, service_role;

-- ── fixtures ──────────────────────────────────────────────────────────────
DO $$
DECLARE c uuid; d uuid; uc uuid := gen_random_uuid(); ud uuid := gen_random_uuid();
BEGIN
  INSERT INTO elite_customers (customer_name, current_points, lifetime_points, status)
    VALUES ('G-cust', 10, 10, 'active') RETURNING id INTO c;
  INSERT INTO elite_customers (customer_name, current_points, lifetime_points, status)
    VALUES ('G-other', 10, 10, 'active') RETURNING id INTO d;
  INSERT INTO app_users VALUES (uc, c), (ud, d);
  INSERT INTO user_roles VALUES
    (gen_random_uuid(), 'sales');   -- placeholder so the table is never empty
  INSERT INTO t_ids VALUES ('c', c), ('d', d), ('uc', uc), ('ud', ud),
    ('sales', gen_random_uuid()), ('accounts', gen_random_uuid()),
    ('admin', gen_random_uuid()), ('head', gen_random_uuid());
  INSERT INTO user_roles
    SELECT v, 'sales'::app_role    FROM t_ids WHERE k='sales'    UNION ALL
    SELECT v, 'accounts'::app_role FROM t_ids WHERE k='accounts' UNION ALL
    SELECT v, 'admin'::app_role    FROM t_ids WHERE k='admin'    UNION ALL
    SELECT v, 'service_head'::app_role FROM t_ids WHERE k='head';
END $$;

-- ═══ PHASE A: the pre-hardening live state ═══════════════════════════════
DROP TRIGGER IF EXISTS trg_guard_customer_self_update ON public.elite_customers;
DROP POLICY IF EXISTS "redemption: customer insert own" ON public.redemption_requests;
CREATE POLICY "redemption: customer insert own" ON public.redemption_requests
  FOR INSERT TO public WITH CHECK (customer_id = public.get_loyalty_customer_id(auth.uid()));

DO $$
DECLARE c uuid; uc uuid;
BEGIN
  SELECT v INTO c  FROM t_ids WHERE k='c';
  SELECT v INTO uc FROM t_ids WHERE k='uc';

  PERFORM chk('A1 BEFORE: customer sets own current_points',
    test_as('authenticated', uc, format('UPDATE elite_customers SET current_points = 99999 WHERE id=%L', c)), 'ok');
  PERFORM chk('A1 ...and it stuck', (SELECT current_points FROM elite_customers WHERE id=c), 99999);
  PERFORM chk('A2 BEFORE: customer sets own status',
    test_as('authenticated', uc, format('UPDATE elite_customers SET status = ''vip'' WHERE id=%L', c)), 'ok');
  PERFORM chk('A3 BEFORE: customer moves own card_issue_date (cooling-window anchor)',
    test_as('authenticated', uc, format('UPDATE elite_customers SET card_issue_date = ''2020-01-01'' WHERE id=%L', c)), 'ok');
  PERFORM chk('A4 BEFORE: customer files an already-APPROVED redemption of Rs 50,000',
    test_as('authenticated', uc, format(
      'INSERT INTO redemption_requests (customer_id, points_requested, rupee_value, status) VALUES (%L, 1, 50000, ''approved'')', c)), 'ok');
  PERFORM chk('A4 ...and it is stored as approved',
    (SELECT count(*)::int FROM redemption_requests WHERE customer_id=c AND status='approved' AND rupee_value=50000), 1);
END $$;

-- ═══ PHASE B: apply the hardening migration ══════════════════════════════
\ir ../migrations/20260912010000_lock_customer_self_writes.sql

DO $$
DECLARE c uuid; d uuid; uc uuid; ud uuid; s uuid; a uuid; ad uuid; h uuid;
BEGIN
  SELECT v INTO c  FROM t_ids WHERE k='c';   SELECT v INTO d  FROM t_ids WHERE k='d';
  SELECT v INTO uc FROM t_ids WHERE k='uc';  SELECT v INTO ud FROM t_ids WHERE k='ud';
  SELECT v INTO s  FROM t_ids WHERE k='sales'; SELECT v INTO a FROM t_ids WHERE k='accounts';
  SELECT v INTO ad FROM t_ids WHERE k='admin'; SELECT v INTO h FROM t_ids WHERE k='head';
  UPDATE elite_customers SET current_points = 10, status = 'active', card_issue_date = NULL WHERE id IN (c, d);

  -- what customers legitimately do
  PERFORM chk('B1 customer edits date_of_birth + anniversary_date',
    test_as('authenticated', uc, format(
      'UPDATE elite_customers SET date_of_birth = ''1990-05-01'', anniversary_date = ''2015-02-14'' WHERE id=%L', c)), 'ok');
  PERFORM chk('B1 ...and the values saved',
    (SELECT date_of_birth::text FROM elite_customers WHERE id=c), '1990-05-01');
  PERFORM chk('B15 no-op update is allowed',
    test_as('authenticated', uc, format('UPDATE elite_customers SET current_points = current_points WHERE id=%L', c)), 'ok');

  -- what they must not
  PERFORM chk('B2 customer cannot set current_points',
    test_as('authenticated', uc, format('UPDATE elite_customers SET current_points = 99999 WHERE id=%L', c)), '42501');
  PERFORM chk('B3 customer cannot set lifetime_points',
    test_as('authenticated', uc, format('UPDATE elite_customers SET lifetime_points = 99999 WHERE id=%L', c)), '42501');
  PERFORM chk('B4 customer cannot set status',
    test_as('authenticated', uc, format('UPDATE elite_customers SET status = ''vip'' WHERE id=%L', c)), '42501');
  PERFORM chk('B5 customer cannot move card_issue_date',
    test_as('authenticated', uc, format('UPDATE elite_customers SET card_issue_date = ''2020-01-01'' WHERE id=%L', c)), '42501');
  PERFORM chk('B6 customer cannot flip app_activated directly',
    test_as('authenticated', uc, format('UPDATE elite_customers SET app_activated = true WHERE id=%L', c)), '42501');
  PERFORM chk('B7 customer cannot change card_tier',
    test_as('authenticated', uc, format('UPDATE elite_customers SET card_tier = ''prestige_elite'' WHERE id=%L', c)), '42501');
  PERFORM chk('B8 mixing an allowed and a forbidden column is refused',
    test_as('authenticated', uc, format(
      'UPDATE elite_customers SET anniversary_date = ''2001-01-01'', current_points = 5 WHERE id=%L', c)), '42501');
  PERFORM chk('B8 ...and nothing was applied',
    (SELECT anniversary_date::text FROM elite_customers WHERE id=c), '2015-02-14');
  PERFORM chk('B9 no points were changed by any refused attempt',
    (SELECT current_points FROM elite_customers WHERE id=c), 10);
  PERFORM chk('B10 anon (no login) cannot update',
    test_as('anon', NULL, format('UPDATE elite_customers SET current_points = 99999 WHERE id=%L', c)), '42501');

  -- who must keep working
  PERFORM chk('B11 sales can still edit points',    test_as('authenticated', s,  format('UPDATE elite_customers SET current_points = 20 WHERE id=%L', c)), 'ok');
  PERFORM chk('B11 accounts can still edit',        test_as('authenticated', a,  format('UPDATE elite_customers SET status = ''active'' WHERE id=%L', c)), 'ok');
  PERFORM chk('B11 admin can still edit',           test_as('authenticated', ad, format('UPDATE elite_customers SET current_points = 10 WHERE id=%L', c)), 'ok');
  PERFORM chk('B11 service_head is NOT staff for writes',
    test_as('authenticated', h, format('UPDATE elite_customers SET current_points = 7 WHERE id=%L', c)), '42501');
  PERFORM chk('B12 service_role (edge functions) unaffected',
    test_as('service_role', NULL, format('UPDATE elite_customers SET current_points = 10 WHERE id=%L', c)), 'ok');
  PERFORM chk('B13 SECURITY DEFINER RPC (link_loyalty_app_user) still activates',
    test_as('authenticated', uc, format('SELECT test_link(%L)', c)), 'ok');
  PERFORM chk('B13 ...app_activated + referral_code set',
    (SELECT app_activated AND referral_code = 'EC1234ABCD' FROM elite_customers WHERE id=c), true);
  PERFORM chk('B14 points-sync trigger path still updates the balance',
    test_as('authenticated', uc, format(
      'INSERT INTO card_points (customer_id, points, transaction_type) VALUES (%L, 40, ''purchase'')', c)), 'ok');
  PERFORM chk('B14 ...current_points reflects the new ledger sum',
    (SELECT current_points FROM elite_customers WHERE id=c), 40);

  -- redemption_requests insert policy
  PERFORM chk('R1 customer cannot file an APPROVED redemption',
    test_as('authenticated', uc, format(
      'INSERT INTO redemption_requests (customer_id, points_requested, rupee_value, status) VALUES (%L, 1, 50000, ''approved'')', c)), '42501');
  PERFORM chk('R3 customer cannot file with status NULL',
    test_as('authenticated', uc, format(
      'INSERT INTO redemption_requests (customer_id, points_requested, rupee_value, status) VALUES (%L, 1, 1, NULL)', c)), '42501');
  PERFORM chk('R4 customer cannot file a pending request for someone else',
    test_as('authenticated', uc, format(
      'INSERT INTO redemption_requests (customer_id, points_requested, rupee_value, status) VALUES (%L, 100, 750, ''pending'')', d)), '42501');
  PERFORM chk('R2 customer CAN still file a normal pending request (today''s redeem screen keeps working)',
    test_as('authenticated', uc, format(
      'INSERT INTO redemption_requests (customer_id, points_requested, rupee_value, status) VALUES (%L, 100, 750, ''pending'')', c)), 'ok');
  PERFORM chk('R5 no new approved rows after hardening',
    (SELECT count(*)::int FROM redemption_requests WHERE customer_id=c AND status='approved' AND requested_at > now() - interval '1 minute' AND rupee_value=1), 0);
END $$;
