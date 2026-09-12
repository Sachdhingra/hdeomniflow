-- ============================================================
-- Point lot consumption tracking
--
-- Prerequisite for OTP-gated redemption (see REDEMPTION_OTP_SPEC.md).
--
-- PROBLEM: fn_expire_points expires the full `points` of every purchase lot
-- past its expires_at, with no knowledge of whether those points were already
-- spent. Today that is harmless only because redemption never writes a ledger
-- row (redemption_request_id is never set by any app path, so the deduction
-- branch in fn_credit_or_reverse_points is unreachable). The moment redemption
-- starts working, every redeemed customer drifts negative:
--
--   1 Jan  +100 purchase (expires 1 Jul)   balance 100
--   1 Mar  -100 redemption                 balance 0
--   1 Jul  -100 expiry (full lot)          balance -100
--
-- FIX: record how much of each credit lot has been consumed. Expiry then
-- writes off only the unconsumed remainder, and a reversal simply un-consumes
-- the lots -- so returned points keep their original expiry date without any
-- date-copying logic.
--
-- SAFE TO APPLY ON ITS OWN: consumed_points defaults to 0 everywhere, so
-- points - consumed_points = points and expiry behaves exactly as it does
-- today. This migration adds capability and wires nothing up; the consume /
-- release functions are called by the redemption flow in a later change.
-- ============================================================

-- ── 1. Per-lot consumption counter ────────────────────────────────────────

ALTER TABLE public.card_points
  ADD COLUMN IF NOT EXISTS consumed_points INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.card_points.consumed_points IS
  'Points of this credit lot already spent by a redemption. Meaningful on '
  'positive rows only. Expiry writes off points - consumed_points.';

ALTER TABLE public.card_points
  DROP CONSTRAINT IF EXISTS card_points_consumed_valid;
ALTER TABLE public.card_points
  ADD CONSTRAINT card_points_consumed_valid CHECK (
    consumed_points >= 0
    AND (consumed_points = 0 OR (points > 0 AND consumed_points <= points))
  );

-- Lots with headroom, soonest-expiring first.
CREATE INDEX IF NOT EXISTS idx_card_points_available
  ON public.card_points (customer_id, expires_at, created_at)
  WHERE points > 0 AND is_expired = FALSE;

-- ── 2. Which lots each redemption consumed ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.redemption_lots (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  redemption_id  UUID        NOT NULL REFERENCES public.redemption_requests(id) ON DELETE CASCADE,
  card_point_id  UUID        NOT NULL REFERENCES public.card_points(id) ON DELETE RESTRICT,
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
GRANT ALL ON public.redemption_lots TO service_role;

-- Read-only to staff; written only by the SECURITY DEFINER functions below.
DROP POLICY IF EXISTS "redemption_lots_staff_read" ON public.redemption_lots;
CREATE POLICY "redemption_lots_staff_read" ON public.redemption_lots
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role) OR
    public.has_role(auth.uid(), 'sales'::app_role)
  );
GRANT SELECT ON public.redemption_lots TO authenticated;

-- ── 3. Consume points FIFO for a redemption ───────────────────────────────
--
-- Draws from the soonest-expiring lots first, so points closest to expiry are
-- spent before points with life left in them. Locks each lot it touches, which
-- also serialises concurrent redemptions for the same customer -- a double-tap
-- at the counter cannot spend the same points twice.
--
-- Raises on insufficient balance rather than partially consuming.

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
BEGIN
  IF p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'Points to consume must be positive (got %)', p_points
      USING ERRCODE = 'check_violation';
  END IF;

  FOR r IN
    SELECT id, points, consumed_points
    FROM public.card_points
    WHERE customer_id = p_customer_id
      AND points > 0
      AND is_expired = FALSE
      AND consumed_points < points
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY expires_at NULLS LAST, created_at
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

  RETURN p_points;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_consume_points(UUID, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated;

-- ── 4. Release points back on reversal ────────────────────────────────────
--
-- Un-consumes the lots a redemption drew from. Points land back in their
-- original lot and therefore keep their original expiry date. A lot that has
-- expired in the meantime is skipped: those points are genuinely gone and are
-- not resurrected by the timing of a return. Returns the number of points
-- actually restored, which the caller uses for the ledger row and for the
-- message shown to the customer.

CREATE OR REPLACE FUNCTION public.fn_release_points(p_redemption_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r           RECORD;
  v_restored  INTEGER := 0;
BEGIN
  FOR r IN
    SELECT rl.id AS lot_row_id, rl.card_point_id, rl.points, cp.is_expired
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

    UPDATE public.redemption_lots
      SET released_at = now()
    WHERE id = r.lot_row_id;
  END LOOP;

  RETURN v_restored;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_release_points(UUID)
  FROM PUBLIC, anon, authenticated;

-- ── 5. Expiry writes off only the unconsumed remainder ────────────────────
--
-- Was: expire the full lot. Now: expire points - consumed_points. A fully
-- consumed lot is marked expired without a ledger row, since those points
-- already left the balance via the redemption.

CREATE OR REPLACE FUNCTION public.fn_expire_points()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r           RECORD;
  v_unspent   INTEGER;
  v_count     INTEGER := 0;
BEGIN
  FOR r IN
    SELECT id, customer_id, points, consumed_points
    FROM public.card_points
    WHERE transaction_type = 'purchase'
      AND is_expired = FALSE
      AND expires_at IS NOT NULL
      AND expires_at < NOW()
    FOR UPDATE SKIP LOCKED          -- safe for concurrent runs
  LOOP
    v_unspent := r.points - r.consumed_points;

    IF v_unspent > 0 THEN
      -- Insert a negative 'expiry' row; bill_id holds the source point-row id
      INSERT INTO public.card_points (customer_id, points, transaction_type, bill_id)
      VALUES (r.customer_id, -v_unspent, 'expiry', r.id);
    END IF;

    UPDATE public.card_points SET is_expired = TRUE WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
