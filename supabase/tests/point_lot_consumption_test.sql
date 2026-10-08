-- Ledger tests for point lot consumption (see REDEMPTION_OTP_SPEC.md).
--
-- Run after 00_prereq_stub.sql and the 20260912000000 migration. Every check
-- raises on mismatch, so a clean run means every assertion held.
--
-- T0 deliberately runs the PRE-FIX live expiry function and asserts the
-- double-deduction, so the suite proves the fix changed the outcome rather
-- than merely agreeing with itself.
\set ON_ERROR_STOP on
\pset pager off

-- T0  The original bug, reproduced with the pre-fix live expiry function.
--     The ledger goes to -100, but the DISPLAYED balance is clamped at 0, so
--     the customer sees nothing wrong -- and the next points they earn vanish.
DO $$
DECLARE c UUID; r UUID;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T0') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 100, 'purchase', now() + interval '1 day');
  INSERT INTO card_points (customer_id, points, transaction_type) VALUES (c, -100, 'redemption');
  UPDATE card_points SET expires_at = now() - interval '1 day' WHERE customer_id = c AND points > 0;
  PERFORM fn_expire_points_OLD();
  PERFORM chk('T0 OLD expiry: ledger balance', bal(c), -100);
  PERFORM chk('T0 OLD expiry: displayed balance is clamped, hiding it',
    (SELECT current_points FROM elite_customers WHERE id=c), 0);
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 50, 'purchase', now() + interval '10 days');
  PERFORM chk('T0 OLD expiry: 50 freshly earned points are swallowed',
    (SELECT current_points FROM elite_customers WHERE id=c), 0);
END $$;

-- T1  Same scenario through the new path: consume, then expire.
DO $$
DECLARE c UUID; r UUID;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T1') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 100, 'purchase', now() + interval '1 day');
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value)
    VALUES (c, 100, 750) RETURNING id INTO r;

  PERFORM fn_consume_points(c, 100, r);
  PERFORM chk('T1 balance after redeem', bal(c), 0);
  PERFORM chk('T1 consume wrote the ledger row itself',
    (SELECT count(*)::int FROM card_points WHERE customer_id=c AND transaction_type='redemption'), 1);

  UPDATE card_points SET expires_at = now() - interval '1 day'
    WHERE customer_id = c AND transaction_type = 'purchase';
  PERFORM fn_expire_points();
  PERFORM chk('T1 balance after expiry (was -100)', bal(c), 0);
  PERFORM chk('T1 no expiry ledger row written',
    (SELECT count(*)::int FROM card_points WHERE customer_id=c AND transaction_type='expiry'), 0);
  PERFORM chk('T1 lot marked expired',
    (SELECT is_expired FROM card_points WHERE customer_id=c AND transaction_type='purchase'), true);
END $$;

-- T2  Regression: unredeemed points still expire exactly as before.
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
  PERFORM chk('T2 expiry note matches the live wording',
    (SELECT notes LIKE 'Auto-expiry of points from %' FROM card_points WHERE customer_id=c AND transaction_type='expiry'), true);
END $$;

-- T3  Partial consumption: only the remainder expires.
DO $$
DECLARE c UUID; r UUID;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T3') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 100, 'purchase', now() + interval '1 day');
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value)
    VALUES (c, 40, 300) RETURNING id INTO r;
  PERFORM fn_consume_points(c, 40, r);
  UPDATE card_points SET expires_at = now() - interval '1 day'
    WHERE customer_id = c AND transaction_type='purchase';
  PERFORM fn_expire_points();
  PERFORM chk('T3 expiry row is -60 not -100',
    (SELECT points FROM card_points WHERE customer_id=c AND transaction_type='expiry'), -60);
  PERFORM chk('T3 balance', bal(c), 0);
END $$;

-- T4  FIFO: soonest-expiring lot is spent first.
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
  PERFORM chk('T4 soonest lot fully consumed', (SELECT consumed_points FROM card_points WHERE id=soon), 60);
  PERFORM chk('T4 later lot takes remainder',  (SELECT consumed_points FROM card_points WHERE id=later), 15);
  PERFORM chk('T4 two lot rows recorded', (SELECT count(*)::int FROM redemption_lots WHERE redemption_id=r), 2);
  PERFORM chk('T4 balance', bal(c), 45);
END $$;

-- T5  Reversal returns points to the original lot and original expiry date.
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

  SELECT fn_release_points(r) INTO restored;
  PERFORM chk('T5 restored count', restored, 100);
  PERFORM chk('T5 lot un-consumed', (SELECT consumed_points FROM card_points WHERE id=lot), 0);
  PERFORM chk('T5 original expiry preserved', (SELECT expires_at FROM card_points WHERE id=lot), exp_before);
  PERFORM chk('T5 balance back to 100', bal(c), 100);
  PERFORM chk('T5 lot row marked released',
    (SELECT count(*)::int FROM redemption_lots WHERE redemption_id=r AND released_at IS NOT NULL), 1);
END $$;

-- T6  Reversal does NOT resurrect points whose lot expired meanwhile.
DO $$
DECLARE c UUID; r UUID; restored INTEGER;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T6') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 100, 'purchase', now() + interval '1 day');
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value)
    VALUES (c, 100, 750) RETURNING id INTO r;
  PERFORM fn_consume_points(c, 100, r);
  UPDATE card_points SET expires_at = now() - interval '1 day' WHERE customer_id=c AND transaction_type='purchase';
  PERFORM fn_expire_points();
  SELECT fn_release_points(r) INTO restored;
  PERFORM chk('T6 expired lot restores nothing', restored, 0);
  PERFORM chk('T6 balance stays 0', bal(c), 0);
  PERFORM chk('T6 no reversal credit written',
    (SELECT count(*)::int FROM card_points WHERE customer_id=c AND transaction_type='redemption_reversal'), 0);
END $$;

-- T7  Insufficient balance raises and consumes nothing.
DO $$
DECLARE c UUID; r UUID; raised BOOLEAN := false;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T7') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 50, 'purchase', now() + interval '10 days');
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value)
    VALUES (c, 100, 750) RETURNING id INTO r;
  BEGIN PERFORM fn_consume_points(c, 100, r);
  EXCEPTION WHEN check_violation THEN raised := true; END;
  PERFORM chk('T7 raised on insufficient points', raised, true);
  PERFORM chk('T7 nothing consumed after rollback',
    (SELECT COALESCE(SUM(consumed_points),0)::int FROM card_points WHERE customer_id=c), 0);
  PERFORM chk('T7 no orphan lot rows', (SELECT count(*)::int FROM redemption_lots WHERE redemption_id=r), 0);
  PERFORM chk('T7 no ledger row written', (SELECT count(*)::int FROM card_points WHERE customer_id=c AND points<0), 0);
END $$;

-- T8  Past-expiry lots are not spendable.
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

-- T9  Constraint blocks over-consumption.
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

-- T10  Stacking: two redemptions on one bill; reversing one leaves the other.
DO $$
DECLARE c UUID; r1 UUID; r2 UUID;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T10') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 200, 'purchase', now() + interval '10 days');
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value) VALUES (c, 100, 750) RETURNING id INTO r1;
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value) VALUES (c, 100, 750) RETURNING id INTO r2;
  PERFORM fn_consume_points(c, 100, r1);
  PERFORM fn_consume_points(c, 100, r2);
  PERFORM chk('T10 balance after stacked redemptions', bal(c), 0);
  PERFORM fn_release_points(r2);
  PERFORM chk('T10 after reversing one of two', bal(c), 100);
  PERFORM chk('T10 lot consumption back to 100',
    (SELECT consumed_points FROM card_points WHERE customer_id=c AND transaction_type='purchase'), 100);
END $$;

-- T11  THE CASE THAT BROKE THE FIRST DESIGN: spend after a reversal.
--      A reversal credit must not itself become a spendable lot, or a customer
--      could spend more than their balance after a return.
DO $$
DECLARE c UUID; r1 UUID; r2 UUID; raised BOOLEAN := false;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T11') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 100, 'purchase', now() + interval '10 days');
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value) VALUES (c, 100, 750) RETURNING id INTO r1;
  PERFORM fn_consume_points(c, 100, r1);
  PERFORM fn_release_points(r1);
  PERFORM chk('T11 balance after reversal', bal(c), 100);

  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value) VALUES (c, 200, 1500) RETURNING id INTO r2;
  BEGIN PERFORM fn_consume_points(c, 200, r2);
  EXCEPTION WHEN check_violation THEN raised := true; END;
  PERFORM chk('T11 cannot spend 200 against a balance of 100', raised, true);
  PERFORM chk('T11 balance unchanged by the refused spend', bal(c), 100);

  PERFORM fn_consume_points(c, 100, (SELECT id FROM redemption_requests WHERE id=r2));
  PERFORM chk('T11 can still spend exactly the 100 owned', bal(c), 0);
END $$;

-- T12  Expiry covers every earned type. welcome_bonus joined the list on
--      8 Oct 2026 (it carried an expires_at but was never expired).
DO $$
DECLARE c UUID;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T12') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at) VALUES
    (c, 10, 'anniversary_bonus', now() - interval '1 day'),
    (c, 20, 'referral',          now() - interval '1 day'),
    (c, 30, 'welcome_bonus',     now() - interval '1 day');
  PERFORM fn_expire_points();
  PERFORM chk('T12 anniversary_bonus expired',
    (SELECT is_expired FROM card_points WHERE customer_id=c AND transaction_type='anniversary_bonus'), true);
  PERFORM chk('T12 referral expired',
    (SELECT is_expired FROM card_points WHERE customer_id=c AND transaction_type='referral'), true);
  PERFORM chk('T12 welcome_bonus now expires',
    (SELECT is_expired FROM card_points WHERE customer_id=c AND transaction_type='welcome_bonus'), true);
  PERFORM chk('T12 balance is zero after all three expire', bal(c), 0);
END $$;

-- T12b  A welcome lot that was partly spent expires only its unspent remainder.
DO $$
DECLARE c UUID; r UUID;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T12b') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 50, 'welcome_bonus', now() + interval '1 day');
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value) VALUES (c, 30, 200) RETURNING id INTO r;
  PERFORM fn_consume_points(c, 30, r);
  UPDATE card_points SET expires_at = now() - interval '1 day' WHERE customer_id=c AND transaction_type='welcome_bonus';
  PERFORM fn_expire_points();
  PERFORM chk('T12b only the unspent 20 expire',
    (SELECT points FROM card_points WHERE customer_id=c AND transaction_type='expiry'), -20);
  PERFORM chk('T12b balance 0, not -30', bal(c), 0);
END $$;

-- T13  Non-purchase lots (welcome / anniversary) are spendable.
DO $$
DECLARE c UUID; r UUID;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T13') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at) VALUES
    (c, 50, 'welcome_bonus',     now() + interval '20 days'),
    (c, 50, 'anniversary_bonus', now() + interval '40 days');
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value) VALUES (c, 75, 500) RETURNING id INTO r;
  PERFORM fn_consume_points(c, 75, r);
  PERFORM chk('T13 welcome lot drained first (soonest expiry)',
    (SELECT consumed_points FROM card_points WHERE customer_id=c AND transaction_type='welcome_bonus'), 50);
  PERFORM chk('T13 anniversary lot takes remainder',
    (SELECT consumed_points FROM card_points WHERE customer_id=c AND transaction_type='anniversary_bonus'), 25);
END $$;

-- T14  A redemption can only spend its own customer's points.
DO $$
DECLARE a UUID; b UUID; r UUID; raised BOOLEAN := false;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T14a') RETURNING id INTO a;
  INSERT INTO elite_customers (customer_name) VALUES ('T14b') RETURNING id INTO b;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (b, 100, 'purchase', now() + interval '10 days');
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value) VALUES (a, 100, 750) RETURNING id INTO r;
  BEGIN PERFORM fn_consume_points(b, 100, r);
  EXCEPTION WHEN check_violation THEN raised := true; END;
  PERFORM chk('T14 cross-customer redemption refused', raised, true);
  PERFORM chk('T14 victim untouched', bal(b), 100);
END $$;

-- T15  Reversal is idempotent.
DO $$
DECLARE c UUID; r UUID;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T15') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 100, 'purchase', now() + interval '10 days');
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value) VALUES (c, 100, 750) RETURNING id INTO r;
  PERFORM fn_consume_points(c, 100, r);
  PERFORM chk('T15 first release restores', fn_release_points(r), 100);
  PERFORM chk('T15 second release restores nothing', fn_release_points(r), 0);
  PERFORM chk('T15 balance not double-credited', bal(c), 100);
END $$;

-- T16  Deleting a customer still works with lots recorded against them.
DO $$
DECLARE c UUID; r UUID;
BEGIN
  INSERT INTO elite_customers (customer_name) VALUES ('T16') RETURNING id INTO c;
  INSERT INTO card_points (customer_id, points, transaction_type, expires_at)
    VALUES (c, 100, 'purchase', now() + interval '10 days');
  INSERT INTO redemption_requests (customer_id, points_requested, rupee_value) VALUES (c, 100, 750) RETURNING id INTO r;
  PERFORM fn_consume_points(c, 100, r);
  DELETE FROM elite_customers WHERE id = c;
  PERFORM chk('T16 customer delete cascades cleanly',
    (SELECT count(*)::int FROM redemption_lots WHERE redemption_id = r), 0);
END $$;
