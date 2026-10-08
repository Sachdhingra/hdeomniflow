-- ============================================================
-- Point lot consumption tracking
--
-- Prerequisite for OTP-gated redemption (see REDEMPTION_OTP_SPEC.md).
--
-- PROBLEM: fn_expire_points writes off the full `points` of every expiring
-- lot, with no knowledge of whether those points were already spent. Harmless
-- today only because redemption never writes a ledger row. The moment it does:
--
--   1 Jan  +100 purchase (expires 1 Jul)   balance 100
--   1 Mar  -100 redemption                 balance 0
--   1 Jul  -100 expiry (full lot)          balance -100
--
-- fn_sync_customer_points clamps the DISPLAYED balance with GREATEST(0, ..), so
-- the screen would show 0 while the ledger sits at -100 and silently swallows
-- the next 100 points the customer earns.
--
-- FIX: record how much of each credit lot has been consumed. Expiry then writes
-- off only the unconsumed remainder, and a reversal un-consumes the lots, so
-- returned points land back in their original lot and keep their original
-- expiry with no date-copying logic.
--
-- Written against the LIVE schema, which has drifted from earlier migrations:
-- card_points has no bill_id and no transaction_type check constraint, and the
-- live fn_expire_points covers purchase / anniversary_bonus / referral.
--
-- SAFE TO APPLY ON ITS OWN: consumed_points defaults to 0, so
-- points - consumed_points = points and expiry behaves exactly as it does
-- today. Nothing calls fn_consume_points / fn_release_points yet.
--
-- ROLLBACK: restore fn_expire_points from the definition in the comment at the
-- bottom, then DROP TABLE redemption_lots, DROP FUNCTION fn_consume_points,
-- fn_release_points, and ALTER TABLE card_points DROP COLUMN consumed_points.
-- ============================================================

-- ── 1. Per-lot consumption counter ────────────────────────────────────────

ALTER TABLE public.card_points
  ADD COLUMN IF NOT EXISTS consumed_points INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.card_points.consumed_points IS
  'Points of this credit lot already spent by a redemption. Meaningful on '
  'positive earning rows only. Expiry writes off points - consumed_points.';

ALTER TABLE public.card_points
  DROP CONSTRAINT IF EXISTS card_points_consumed_valid;
ALTER TABLE public.card_points
  ADD CONSTRAINT card_points_consumed_valid CHECK (
    consumed_points >= 0
    AND (consumed_points = 0 OR (points > 0 AND consumed_points <= points))
  );

-- Spendable lots, soonest-expiring first.
CREATE INDEX IF NOT EXISTS idx_card_points_spendable
  ON public.card_points (customer_id, expires_at, created_at)
  WHERE points > 0 AND is_expired = FALSE;

-- ── 2. Which lots each redemption consumed ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.redemption_lots (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  redemption_id  UUID        NOT NULL REFERENCES public.redemption_requests(id) ON DELETE CASCADE,
  -- CASCADE: deleting a customer cascades to both card_points and
  -- redemption_requests in one statement, and Postgres does not order those
  -- cascades, so a non-cascading key here makes customer deletion fail.
  card_point_id  UUID        NOT NULL REFERENCES public.card_points(id) ON DELETE CASCADE,
  points         INTEGER     NOT NULL CHECK (points > 0),
  released_at    TIMESTAMPTZ,          -- set when a return/rejection un-consumes it
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (redemption_id, card_point_id)
);

COMMENT ON TABLE public.redemption_lots IS
  'Which credit lots a redemption drew from, so a reversal can return the '
  'points to their original lot and original expiry date.';

CREATE INDEX IF NOT EXISTS idx_redemption_lots_redemption
  ON public.redemption_lots (redemption_id);

ALTER TABLE public.redemption_lots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.redemption_lots FROM anon, authenticated;
GRANT SELECT ON public.redemption_lots TO authenticated;
GRANT ALL ON public.redemption_lots TO service_role;

-- Read-only to staff; written only by the SECURITY DEFINER functions below.
DROP POLICY IF EXISTS "redemption_lots_staff_read" ON public.redemption_lots;
CREATE POLICY "redemption_lots_staff_read" ON public.redemption_lots
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role) OR
    public.has_role(auth.uid(), 'sales'::app_role)
  );

-- ── 3. Spend points FIFO for a redemption ─────────────────────────────────
--
-- Draws from the soonest-expiring lots first, so points nearest expiry are
-- spent before points with life left in them, and writes the matching negative
-- 'redemption' ledger row in the same call so lots and balance cannot drift.
-- Locks every lot it touches, which also serialises concurrent redemptions for
-- one customer: a double-tap at the counter cannot spend the same points twice.
--
-- A lot is any positive row that is not itself a reversal credit. Reversal
-- credits restore points to a lot that was already un-consumed, so counting
-- them as lots would let a customer spend the same points twice.

CREATE OR REPLACE FUNCTION public.fn_consume_points(
  p_customer_id   UUID,
  p_points        INTEGER,
  p_redemption_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r            RECORD;
  v_remaining  INTEGER := p_points;
  v_take       INTEGER;
  v_owner      UUID;
  v_balance    INTEGER;
BEGIN
  IF p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'Points to consume must be positive (got %)', p_points
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT customer_id INTO v_owner
  FROM public.redemption_requests WHERE id = p_redemption_id;
  IF v_owner IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'Redemption % does not belong to customer %', p_redemption_id, p_customer_id
      USING ERRCODE = 'check_violation';
  END IF;

  FOR r IN
    SELECT id, points, consumed_points
    FROM public.card_points
    WHERE customer_id = p_customer_id
      AND points > 0
      AND transaction_type NOT IN ('redemption_reversal','reversal','redemption','expiry')
      AND COALESCE(is_expired, FALSE) = FALSE
      AND consumed_points < points
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY expires_at NULLS LAST, created_at, id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_take := LEAST(v_remaining, r.points - r.consumed_points);

    UPDATE public.card_points
      SET consumed_points = consumed_points + v_take
    WHERE id = r.id;

    INSERT INTO public.redemption_lots (redemption_id, card_point_id, points)
    VALUES (p_redemption_id, r.id, v_take);

    v_remaining := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Insufficient points: % short of %', v_remaining, p_points
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.card_points (customer_id, points, transaction_type, notes)
  VALUES (p_customer_id, -p_points, 'redemption', 'Redeemed via redemption '||p_redemption_id::text);

  -- Safety net: the ledger must never be driven negative by a redemption.
  SELECT COALESCE(SUM(points), 0) INTO v_balance
  FROM public.card_points WHERE customer_id = p_customer_id;
  IF v_balance < 0 THEN
    RAISE EXCEPTION 'Ledger would go negative (%) after redeeming % points', v_balance, p_points
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN p_points;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_consume_points(UUID, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated;

-- ── 4. Give points back on reversal ───────────────────────────────────────
--
-- Un-consumes the lots a redemption drew from, so points return to their
-- original lot and keep their original expiry, and writes the matching
-- 'redemption_reversal' ledger credit. A lot that expired in the meantime is
-- skipped: those points are genuinely gone and are not resurrected by the
-- timing of a return. Idempotent: a second call restores nothing.
-- Returns the points actually restored, for the message shown to the customer.

CREATE OR REPLACE FUNCTION public.fn_release_points(p_redemption_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r           RECORD;
  v_restored  INTEGER := 0;
  v_customer  UUID;
BEGIN
  SELECT customer_id INTO v_customer
  FROM public.redemption_requests WHERE id = p_redemption_id;
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'Redemption % not found', p_redemption_id USING ERRCODE = 'check_violation';
  END IF;

  FOR r IN
    SELECT rl.id AS lot_row_id, rl.card_point_id, rl.points, COALESCE(cp.is_expired, FALSE) AS is_expired
    FROM public.redemption_lots rl
    JOIN public.card_points cp ON cp.id = rl.card_point_id
    WHERE rl.redemption_id = p_redemption_id
      AND rl.released_at IS NULL
    FOR UPDATE OF cp, rl
  LOOP
    IF NOT r.is_expired THEN
      UPDATE public.card_points
        SET consumed_points = GREATEST(consumed_points - r.points, 0)
      WHERE id = r.card_point_id;

      v_restored := v_restored + r.points;
    END IF;

    UPDATE public.redemption_lots SET released_at = now() WHERE id = r.lot_row_id;
  END LOOP;

  IF v_restored > 0 THEN
    INSERT INTO public.card_points (customer_id, points, transaction_type, notes)
    VALUES (v_customer, v_restored, 'redemption_reversal',
            'Reversal of redemption '||p_redemption_id::text);
  END IF;

  RETURN v_restored;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_release_points(UUID)
  FROM PUBLIC, anon, authenticated;

-- ── 5. Expiry writes off only the unconsumed remainder ────────────────────
--
-- Same selection as the live function (purchase / anniversary_bonus /
-- referral, points > 0, expires_at <= now()), with two changes:
--   * writes off points - consumed_points rather than the whole lot; a fully
--     consumed lot is marked expired with no ledger row, since those points
--     already left the balance via the redemption;
--   * FOR UPDATE SKIP LOCKED, so a lot mid-redemption is left for the next run
--     instead of being expired from a stale consumed_points value.

CREATE OR REPLACE FUNCTION public.fn_expire_points()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  rec         RECORD;
  v_unspent   INTEGER;
  v_count     INTEGER := 0;
BEGIN
  FOR rec IN
    SELECT id, customer_id, points, consumed_points
    FROM public.card_points
    WHERE points > 0
      AND transaction_type IN ('purchase','anniversary_bonus','referral')
      AND expires_at IS NOT NULL
      AND expires_at <= now()
      AND COALESCE(is_expired,false) = false
    FOR UPDATE SKIP LOCKED
  LOOP
    v_unspent := rec.points - rec.consumed_points;

    IF v_unspent > 0 THEN
      INSERT INTO public.card_points (customer_id, points, transaction_type, notes)
      VALUES (rec.customer_id, -v_unspent, 'expiry',
              'Auto-expiry of points from '||rec.id::text);
    END IF;

    UPDATE public.card_points SET is_expired = true WHERE id = rec.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

-- Live definition before this migration, for rollback:
--
--   CREATE OR REPLACE FUNCTION public.fn_expire_points() RETURNS integer
--   LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
--   DECLARE rec RECORD; v_count INTEGER := 0;
--   BEGIN
--     FOR rec IN
--       SELECT id, customer_id, points FROM public.card_points
--       WHERE points > 0 AND transaction_type IN ('purchase','anniversary_bonus','referral')
--         AND expires_at IS NOT NULL AND expires_at <= now() AND COALESCE(is_expired,false) = false
--     LOOP
--       INSERT INTO public.card_points (customer_id, points, transaction_type, notes)
--       VALUES (rec.customer_id, -rec.points, 'expiry', 'Auto-expiry of points from '||rec.id::text);
--       UPDATE public.card_points SET is_expired = true WHERE id = rec.id;
--       v_count := v_count + 1;
--     END LOOP;
--     RETURN v_count;
--   END; $function$;
