-- Ledger tests for point lot consumption (see REDEMPTION_OTP_SPEC.md).
--
-- Run after 00_prereq_stub.sql and the 20260912000000 migration. Every check
-- raises on mismatch, so a clean run means all assertions held.
--
-- T0 deliberately exercises the PRE-FIX expiry function and asserts the -100
-- double-deduction, so the suite proves the fix changed the outcome rather
-- than merely agreeing with itself.

\set ON_ERROR_STOP on
\pset pager off

CREATE OR REPLACE FUNCTION chk(label TEXT, got ANYELEMENT, want ANYELEMENT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL % : got %, want %', label, got, want;
  END IF;
  RAISE NOTICE 'pass  %  (%)', label, got;
END $$;

-- ────────────────────────────────────────────────────────────────
-- T0  Reproduce the ORIGINAL bug with the pre-fix expiry function
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE c UUID; r UUID;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T0') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 100, 'purchase', now() - interval '1 day');
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value)
    VALUES (c, 100, 750) RETURNING id INTO r;
  -- redemption ledger row, as the fixed flow will write it
  INSERT INTO card_points (customer_id, points, transaction_type) VALUES (c, -100, 'redemption');
  PERFORM chk('T0 balance after redeem', bal(c), 0);
  PERFORM fn_expire_points_OLD();
  PERFORM chk('T0 OLD expiry double-deducts -> balance', bal(c), -100);
END $$;

-- ────────────────────────────────────────────────────────────────
-- T1  Same scenario, new code path: consume lots, then expire
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE c UUID; r UUID;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T1') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 100, 'purchase', now() + interval '1 day');
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value)
    VALUES (c, 100, 750) RETURNING id INTO r;

  PERFORM fn_consume_points(c, 100, r);
  INSERT INTO card_points (customer_id, points, transaction_type) VALUES (c, -100, 'redemption');
  PERFORM chk('T1 balance after redeem', bal(c), 0);

  -- lot now falls past its expiry
  UPDATE card_points SET expires_at = now() - interval '1 day'
    WHERE customer_id = c AND transaction_type = 'purchase';
  PERFORM fn_expire_points();
  PERFORM chk('T1 balance after expiry (was -100)', bal(c), 0);
  PERFORM chk('T1 no expiry ledger row written',
    (SELECT count(*)::int FROM card_points WHERE customer_id=c AND transaction_type='expiry'), 0);
END $$;

-- ────────────────────────────────────────────────────────────────
-- T2  Regression: unredeemed points still expire exactly as before
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE c UUID;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T2') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 100, 'purchase', now() - interval '1 day');
  PERFORM fn_expire_points();
  PERFORM chk('T2 unspent points fully expire', bal(c), 0);
  PERFORM chk('T2 expiry row is -100',
    (SELECT points FROM card_points WHERE customer_id=c AND transaction_type='expiry'), -100);
END $$;

-- ────────────────────────────────────────────────────────────────
-- T3  Partial consumption: only the remainder expires
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE c UUID; r UUID;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T3') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 100, 'purchase', now() + interval '1 day');
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value)
    VALUES (c, 40, 300) RETURNING id INTO r;
  PERFORM fn_consume_points(c, 40, r);
  INSERT INTO card_points (customer_id, points, transaction_type) VALUES (c, -40, 'redemption');

  UPDATE card_points SET expires_at = now() - interval '1 day'
    WHERE customer_id = c AND transaction_type='purchase';
  PERFORM fn_expire_points();
  PERFORM chk('T3 expiry row is -60 not -100',
    (SELECT points FROM card_points WHERE customer_id=c AND transaction_type='expiry'), -60);
  PERFORM chk('T3 balance', bal(c), 0);
END $$;

-- ────────────────────────────────────────────────────────────────
-- T4  FIFO: soonest-expiring lot is spent first
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE c UUID; r UUID; soon UUID; later UUID;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T4') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 60, 'purchase', now() + interval '30 days') RETURNING id INTO soon;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 60, 'purchase', now() + interval '300 days') RETURNING id INTO later;
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value)
    VALUES (c, 75, 500) RETURNING id INTO r;
  PERFORM fn_consume_points(c, 75, r);

  PERFORM chk('T4 soonest lot fully consumed',
    (SELECT consumed_points FROM card_points WHERE id=soon), 60);
  PERFORM chk('T4 later lot takes remainder',
    (SELECT consumed_points FROM card_points WHERE id=later), 15);
  PERFORM chk('T4 two lot rows recorded',
    (SELECT count(*)::int FROM redemption_lots WHERE redemption_id=r), 2);
END $$;

-- ────────────────────────────────────────────────────────────────
-- T5  Reversal returns points to the original lot and expiry date
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE c UUID; r UUID; lot UUID; exp_before TIMESTAMPTZ; restored INTEGER;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T5') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 100, 'purchase', now() + interval '10 days') RETURNING id INTO lot;
  SELECT expires_at INTO exp_before FROM card_points WHERE id=lot;
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value)
    VALUES (c, 100, 750) RETURNING id INTO r;
  PERFORM fn_consume_points(c, 100, r);
  INSERT INTO card_points (customer_id, points, transaction_type) VALUES (c, -100, 'redemption');

  SELECT fn_release_points(r) INTO restored;
  INSERT INTO card_points (customer_id, points, transaction_type) VALUES (c, restored, 'reversal');

  PERFORM chk('T5 restored count', restored, 100);
  PERFORM chk('T5 lot un-consumed', (SELECT consumed_points FROM card_points WHERE id=lot), 0);
  PERFORM chk('T5 original expiry preserved',
    (SELECT expires_at FROM card_points WHERE id=lot), exp_before);
  PERFORM chk('T5 balance back to 100', bal(c), 100);
  PERFORM chk('T5 lot row marked released',
    (SELECT count(*)::int FROM redemption_lots WHERE redemption_id=r AND released_at IS NOT NULL), 1);
END $$;

-- ────────────────────────────────────────────────────────────────
-- T6  Reversal does NOT resurrect points whose lot expired meanwhile
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE c UUID; r UUID; restored INTEGER;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T6') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 100, 'purchase', now() + interval '1 day');
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value)
    VALUES (c, 100, 750) RETURNING id INTO r;
  PERFORM fn_consume_points(c, 100, r);
  INSERT INTO card_points (customer_id, points, transaction_type) VALUES (c, -100, 'redemption');

  UPDATE card_points SET expires_at = now() - interval '1 day'
    WHERE customer_id=c AND transaction_type='purchase';
  PERFORM fn_expire_points();

  SELECT fn_release_points(r) INTO restored;
  PERFORM chk('T6 expired lot restores nothing', restored, 0);
  PERFORM chk('T6 balance stays 0', bal(c), 0);
END $$;

-- ────────────────────────────────────────────────────────────────
-- T7  Insufficient balance raises and consumes nothing
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE c UUID; r UUID; raised BOOLEAN := false;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T7') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 50, 'purchase', now() + interval '10 days');
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value)
    VALUES (c, 100, 750) RETURNING id INTO r;
  BEGIN
    PERFORM fn_consume_points(c, 100, r);
  EXCEPTION WHEN check_violation THEN raised := true;
  END;
  PERFORM chk('T7 raised on insufficient points', raised, true);
END $$;

-- T7b  the partial consumption must have been rolled back
DO $$
DECLARE c UUID;
BEGIN
  SELECT id INTO c FROM elite_customers WHERE customer_name='T7';
  PERFORM chk('T7b nothing consumed after rollback',
    (SELECT COALESCE(SUM(consumed_points),0)::int FROM card_points WHERE customer_id=c), 0);
  PERFORM chk('T7b no orphan lot rows',
    (SELECT count(*)::int FROM redemption_lots rl
      JOIN redemption_requests rr ON rr.id=rl.redemption_id WHERE rr.customer_id=c), 0);
END $$;

-- ────────────────────────────────────────────────────────────────
-- T8  Expired / expiring-now lots are not consumable
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE c UUID; r UUID; raised BOOLEAN := false;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T8') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 100, 'purchase', now() - interval '1 second');
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value)
    VALUES (c, 100, 750) RETURNING id INTO r;
  BEGIN PERFORM fn_consume_points(c, 100, r);
  EXCEPTION WHEN check_violation THEN raised := true; END;
  PERFORM chk('T8 past-expiry lot not spendable', raised, true);
END $$;

-- ────────────────────────────────────────────────────────────────
-- T9  Constraint blocks over-consumption
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE c UUID; lot UUID; raised BOOLEAN := false;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T9') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 10, 'purchase', now() + interval '10 days') RETURNING id INTO lot;
  BEGIN UPDATE card_points SET consumed_points = 11 WHERE id = lot;
  EXCEPTION WHEN check_violation THEN raised := true; END;
  PERFORM chk('T9 consumed > points rejected', raised, true);
END $$;

-- ────────────────────────────────────────────────────────────────
-- T10  Stacking: two redemptions on one bill draw down correctly
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE c UUID; r1 UUID; r2 UUID;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T10') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 200, 'purchase', now() + interval '10 days');
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value)
    VALUES (c, 100, 750) RETURNING id INTO r1;
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value)
    VALUES (c, 100, 750) RETURNING id INTO r2;
  PERFORM fn_consume_points(c, 100, r1);
  INSERT INTO card_points (customer_id, points, transaction_type) VALUES (c, -100, 'redemption');
  PERFORM fn_consume_points(c, 100, r2);
  INSERT INTO card_points (customer_id, points, transaction_type) VALUES (c, -100, 'redemption');
  PERFORM chk('T10 balance after stacked redemptions', bal(c), 0);
  PERFORM chk('T10 lot fully consumed',
    (SELECT consumed_points FROM card_points WHERE customer_id=c AND transaction_type='purchase'), 200);

  -- reversing only the second leaves the first intact
  PERFORM fn_release_points(r2);
  INSERT INTO card_points (customer_id, points, transaction_type) VALUES (c, 100, 'reversal');
  PERFORM chk('T10 after reversing one of two', bal(c), 100);
  PERFORM chk('T10 lot consumption back to 100',
    (SELECT consumed_points FROM card_points WHERE customer_id=c AND transaction_type='purchase'), 100);
END $$;
