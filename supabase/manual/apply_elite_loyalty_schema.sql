-- ============================================================================
-- ELITE CARD LOYALTY — CONSOLIDATED SCHEMA HOTFIX
-- ============================================================================
-- WHY THIS FILE EXISTS
--   The four loyalty migrations (20260625000000 … 20260625030000) were
--   committed to git but never executed against the live Supabase project,
--   so saving a Card Bill Entry fails with:
--     "Could not find the table 'public.card_bill_entries' in the schema cache"
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste this whole file → Run.
--   (Or: `supabase db push` from a machine linked to the project.)
--
--   The script is fully idempotent — every statement is guarded, so it is
--   safe to run even if parts of the loyalty schema already exist, and safe
--   to re-run if it was interrupted.
-- ============================================================================


-- ============================================================
-- A. EXPAND elite_customers  (Step 1)
-- ============================================================

-- card_expiry_date was GENERATED ALWAYS AS (card_issue_date + 3 years); it
-- must become a plain TIMESTAMPTZ the app can set independently. Only drop
-- it when it is still the generated variant, so re-runs never destroy data.
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'elite_customers'
      AND column_name = 'card_expiry_date' AND is_generated = 'ALWAYS'
  ) THEN
    ALTER TABLE public.elite_customers DROP COLUMN card_expiry_date;
  END IF;
END $do$;

ALTER TABLE public.elite_customers
  ADD COLUMN IF NOT EXISTS card_tier            TEXT
    CHECK (card_tier IN ('elite','super_elite','prestige_elite')),
  ADD COLUMN IF NOT EXISTS card_number          TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS card_enrollment_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS card_expiry_date     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_points       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_points      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS app_activated        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS date_of_birth        DATE,
  ADD COLUMN IF NOT EXISTS last_purchase_date   DATE;

COMMENT ON COLUMN public.elite_customers.date_of_birth      IS 'Used for birthday push notification';
COMMENT ON COLUMN public.elite_customers.last_purchase_date IS 'Updated by trigger on bill approval; used for dormancy check';

-- Backfill existing rows: default tier = elite, derive dates from card_issue_date
UPDATE public.elite_customers
SET
  card_tier            = COALESCE(card_tier, 'elite'),
  card_enrollment_date = COALESCE(card_enrollment_date, card_issue_date::TIMESTAMPTZ),
  card_expiry_date     = COALESCE(card_expiry_date, (card_issue_date + INTERVAL '3 years')::TIMESTAMPTZ)
WHERE card_enrollment_date IS NULL OR card_expiry_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_elite_customers_tier    ON public.elite_customers(card_tier);
CREATE INDEX IF NOT EXISTS idx_elite_customers_card_no ON public.elite_customers(card_number);
CREATE INDEX IF NOT EXISTS idx_elite_elite_expiry      ON public.elite_customers(card_expiry_date);
CREATE INDEX IF NOT EXISTS idx_elite_app_activated     ON public.elite_customers(app_activated);


-- ============================================================
-- B. LOYALTY TABLES  (Step 1)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.card_points (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID        NOT NULL REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  points           INTEGER     NOT NULL,
  transaction_type TEXT        NOT NULL
    CHECK (transaction_type IN ('purchase','redemption','anniversary_bonus','referral','reversal','expiry')),
  bill_id          UUID,           -- references hde_orders; no FK to stay decoupled
  expires_at       TIMESTAMPTZ,
  is_expired       BOOLEAN     NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.card_points
  ADD COLUMN IF NOT EXISTS is_expired BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.card_points ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_points TO authenticated;
GRANT ALL ON public.card_points TO service_role;

CREATE INDEX IF NOT EXISTS idx_card_points_customer ON public.card_points(customer_id);
CREATE INDEX IF NOT EXISTS idx_card_points_expires  ON public.card_points(expires_at)
  WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_card_points_bill     ON public.card_points(bill_id)
  WHERE bill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_card_points_expiry_pending
  ON public.card_points(expires_at)
  WHERE transaction_type = 'purchase' AND is_expired = FALSE AND expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.card_commissions (
  id                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  salesperson_id    UUID           REFERENCES auth.users(id),
  customer_id       UUID           REFERENCES public.elite_customers(id),
  card_tier         TEXT           NOT NULL
    CHECK (card_tier IN ('elite','super_elite','prestige_elite')),
  commission_amount DECIMAL(10,2)  NOT NULL,
  payment_status    TEXT           NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','paid')),
  payout_month      DATE,
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

ALTER TABLE public.card_commissions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_commissions TO authenticated;
GRANT ALL ON public.card_commissions TO service_role;

CREATE INDEX IF NOT EXISTS idx_card_comm_salesperson ON public.card_commissions(salesperson_id);
CREATE INDEX IF NOT EXISTS idx_card_comm_payout      ON public.card_commissions(payout_month);
CREATE INDEX IF NOT EXISTS idx_card_comm_status      ON public.card_commissions(payment_status);

CREATE TABLE IF NOT EXISTS public.redemption_requests (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID           NOT NULL REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  points_requested INTEGER        NOT NULL CHECK (points_requested > 0),
  rupee_value      DECIMAL(10,2)  NOT NULL CHECK (rupee_value > 0),
  status           TEXT           NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','used')),
  approved_by      UUID           REFERENCES auth.users(id),
  used_in_bill_id  UUID,
  requested_at     TIMESTAMPTZ    NOT NULL DEFAULT now()
);

ALTER TABLE public.redemption_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.redemption_requests TO authenticated;
GRANT ALL ON public.redemption_requests TO service_role;

CREATE INDEX IF NOT EXISTS idx_redemption_customer ON public.redemption_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_redemption_status   ON public.redemption_requests(status);

CREATE TABLE IF NOT EXISTS public.app_users (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id         UUID        UNIQUE REFERENCES public.elite_customers(id),
  phone               TEXT        NOT NULL,
  onesignal_player_id TEXT,
  app_installed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at      TIMESTAMPTZ
);

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_users TO authenticated;
GRANT ALL ON public.app_users TO service_role;

CREATE INDEX IF NOT EXISTS idx_app_users_customer ON public.app_users(customer_id);
CREATE INDEX IF NOT EXISTS idx_app_users_phone    ON public.app_users(phone);

CREATE TABLE IF NOT EXISTS public.push_notifications_log (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID        REFERENCES public.elite_customers(id),
  notification_type TEXT        NOT NULL,
  title             TEXT,
  message           TEXT,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened            BOOLEAN     NOT NULL DEFAULT false
);

ALTER TABLE public.push_notifications_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.push_notifications_log TO authenticated;
GRANT ALL ON public.push_notifications_log TO service_role;

CREATE INDEX IF NOT EXISTS idx_push_log_customer ON public.push_notifications_log(customer_id);
CREATE INDEX IF NOT EXISTS idx_push_log_sent     ON public.push_notifications_log(sent_at DESC);

CREATE TABLE IF NOT EXISTS public.card_settings (
  key        TEXT        PRIMARY KEY,
  value      JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.card_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.card_settings TO authenticated;
GRANT ALL ON public.card_settings TO service_role;

DROP TRIGGER IF EXISTS trg_card_settings_updated_at ON public.card_settings;
CREATE TRIGGER trg_card_settings_updated_at
  BEFORE UPDATE ON public.card_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.card_settings (key, value) VALUES
  ('discount_ceiling_pct',        '"15.5"'),
  ('prestige_min_bill_amount',    '"200000"'),
  ('card_extra_discount_pct',     '{"elite": 5, "super_elite": 5, "prestige_elite": 6}'),
  ('service_charge_discount_pct', '{"elite": 0, "super_elite": 10, "prestige_elite": 20}'),
  ('extended_warranty_months',    '{"elite": 0, "super_elite": 6, "prestige_elite": 12}'),
  ('points_per_rupees',           '{"super_elite": {"points": 1, "per_rupees": 250}, "prestige_elite": {"points": 1, "per_rupees": 200}}'),
  ('redemption_tiers',            '{"super_elite": [{"points": 75, "value": 500}, {"points": 100, "value": 750}], "prestige_elite": [{"points": 100, "value": 600}, {"points": 250, "value": 1500}]}'),
  ('anniversary_bonus_pts',       '{"super_elite": 25, "prestige_elite": 50}'),
  ('points_expiry_months',        '"12"'),
  ('per_bill_redemption_cap_pct', '"5"'),
  ('card_prices_incl_gst',        '{"elite": 1200, "super_elite": 2100, "prestige_elite": 4100}'),
  ('card_commissions_flat',       '{"elite": 100, "super_elite": 150, "prestige_elite": 200}'),
  ('cost_base_pct_of_mrp',        '"64.5"'),
  ('hard_margin_floor_pct',       '"20"'),
  ('card_validity_years',         '"3"')
ON CONFLICT (key) DO NOTHING;


-- ============================================================
-- C. card_bill_entries  (Step 2 — the table the form writes to)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.card_bill_entries (
  id                        UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id               UUID           NOT NULL REFERENCES public.elite_customers(id),
  entered_by                UUID           NOT NULL REFERENCES auth.users(id),
  bill_reference            TEXT,
  bill_date                 DATE           NOT NULL DEFAULT CURRENT_DATE,
  gross_bill_amount         DECIMAL(12,2)  NOT NULL CHECK (gross_bill_amount > 0),
  base_scheme_discount_pct  DECIMAL(5,2)   NOT NULL DEFAULT 0 CHECK (base_scheme_discount_pct >= 0),
  card_discount_pct         DECIMAL(5,2)   NOT NULL DEFAULT 0 CHECK (card_discount_pct >= 0),
  redemption_amount         DECIMAL(10,2)  NOT NULL DEFAULT 0 CHECK (redemption_amount >= 0),
  redemption_request_id     UUID           REFERENCES public.redemption_requests(id),
  net_bill_amount           DECIMAL(12,2)  NOT NULL,   -- negative for returns
  is_card_sale              BOOLEAN        NOT NULL DEFAULT false,
  is_return                 BOOLEAN        NOT NULL DEFAULT false,
  approval_status           TEXT           NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending','approved','rejected')),
  approved_by               UUID           REFERENCES auth.users(id),
  approved_at               TIMESTAMPTZ,
  notes                     TEXT,
  created_at                TIMESTAMPTZ    NOT NULL DEFAULT now()
);

ALTER TABLE public.card_bill_entries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_bill_entries TO authenticated;
GRANT ALL ON public.card_bill_entries TO service_role;

CREATE INDEX IF NOT EXISTS idx_cbe_customer    ON public.card_bill_entries(customer_id);
CREATE INDEX IF NOT EXISTS idx_cbe_entered_by  ON public.card_bill_entries(entered_by);
CREATE INDEX IF NOT EXISTS idx_cbe_status      ON public.card_bill_entries(approval_status);
CREATE INDEX IF NOT EXISTS idx_cbe_bill_date   ON public.card_bill_entries(bill_date DESC);


-- ============================================================
-- D. RLS HELPER FUNCTIONS  (Step 1)
-- ============================================================

-- Returns elite_customers.id for a Supabase auth uid (via app_users link)
CREATE OR REPLACE FUNCTION public.get_loyalty_customer_id(_uid UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT customer_id FROM public.app_users WHERE user_id = _uid LIMIT 1
$$;

-- True if this uid is a customer app session (not a staff login)
CREATE OR REPLACE FUNCTION public.is_loyalty_app_user(_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users WHERE user_id = _uid)
$$;


-- ============================================================
-- E. RLS POLICIES  (Steps 1–3; DROP + CREATE so re-runs are safe)
-- ============================================================

-- ---- elite_customers: replace overly-permissive policies ----
DROP POLICY IF EXISTS "elite_select_auth"   ON public.elite_customers;
DROP POLICY IF EXISTS "elite_insert_auth"   ON public.elite_customers;
DROP POLICY IF EXISTS "elite_update_auth"   ON public.elite_customers;
DROP POLICY IF EXISTS "elite_delete_admin"  ON public.elite_customers;
DROP POLICY IF EXISTS "elite_delete_owner"  ON public.elite_customers;

DROP POLICY IF EXISTS "elite_staff_all" ON public.elite_customers;
CREATE POLICY "elite_staff_all" ON public.elite_customers
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)        OR
    public.has_role(auth.uid(), 'sales'::app_role)        OR
    public.has_role(auth.uid(), 'accounts'::app_role)     OR
    public.has_role(auth.uid(), 'service_head'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)        OR
    public.has_role(auth.uid(), 'sales'::app_role)        OR
    public.has_role(auth.uid(), 'accounts'::app_role)     OR
    public.has_role(auth.uid(), 'service_head'::app_role)
  );

DROP POLICY IF EXISTS "elite_customer_app_select_own" ON public.elite_customers;
CREATE POLICY "elite_customer_app_select_own" ON public.elite_customers
  FOR SELECT TO authenticated
  USING (id = public.get_loyalty_customer_id(auth.uid()));

-- ---- card_points ----
DROP POLICY IF EXISTS "card_points_staff_write" ON public.card_points;
CREATE POLICY "card_points_staff_write" ON public.card_points
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)    OR
    public.has_role(auth.uid(), 'accounts'::app_role) OR
    public.has_role(auth.uid(), 'sales'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)    OR
    public.has_role(auth.uid(), 'accounts'::app_role) OR
    public.has_role(auth.uid(), 'sales'::app_role)
  );

DROP POLICY IF EXISTS "card_points_customer_select_own" ON public.card_points;
CREATE POLICY "card_points_customer_select_own" ON public.card_points
  FOR SELECT TO authenticated
  USING (customer_id = public.get_loyalty_customer_id(auth.uid()));

-- ---- card_commissions ----
DROP POLICY IF EXISTS "card_commissions_admin_accounts_all" ON public.card_commissions;
CREATE POLICY "card_commissions_admin_accounts_all" ON public.card_commissions
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)    OR
    public.has_role(auth.uid(), 'accounts'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)    OR
    public.has_role(auth.uid(), 'accounts'::app_role)
  );

DROP POLICY IF EXISTS "card_commissions_salesperson_select_own" ON public.card_commissions;
CREATE POLICY "card_commissions_salesperson_select_own" ON public.card_commissions
  FOR SELECT TO authenticated
  USING (salesperson_id = auth.uid());

-- Salesperson logs own commission on card-enrollment sales (form insert path)
DROP POLICY IF EXISTS "card_commissions_salesperson_insert_own" ON public.card_commissions;
CREATE POLICY "card_commissions_salesperson_insert_own" ON public.card_commissions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'sales'::app_role)
    AND salesperson_id = auth.uid()
  );

-- ---- redemption_requests ----
DROP POLICY IF EXISTS "redemption_staff_all" ON public.redemption_requests;
CREATE POLICY "redemption_staff_all" ON public.redemption_requests
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)    OR
    public.has_role(auth.uid(), 'accounts'::app_role) OR
    public.has_role(auth.uid(), 'sales'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)    OR
    public.has_role(auth.uid(), 'accounts'::app_role) OR
    public.has_role(auth.uid(), 'sales'::app_role)
  );

DROP POLICY IF EXISTS "redemption_customer_select_own" ON public.redemption_requests;
CREATE POLICY "redemption_customer_select_own" ON public.redemption_requests
  FOR SELECT TO authenticated
  USING (customer_id = public.get_loyalty_customer_id(auth.uid()));

DROP POLICY IF EXISTS "redemption_customer_insert_own" ON public.redemption_requests;
CREATE POLICY "redemption_customer_insert_own" ON public.redemption_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    customer_id = public.get_loyalty_customer_id(auth.uid())
    AND status = 'pending'
  );

DROP POLICY IF EXISTS "redemption_accounts_update" ON public.redemption_requests;
CREATE POLICY "redemption_accounts_update" ON public.redemption_requests
  FOR UPDATE TO authenticated
  USING   (public.has_role(auth.uid(), 'accounts'::app_role) OR
           public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'accounts'::app_role) OR
              public.has_role(auth.uid(), 'admin'::app_role));

-- ---- app_users ----
DROP POLICY IF EXISTS "app_users_staff_all" ON public.app_users;
CREATE POLICY "app_users_staff_all" ON public.app_users
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)    OR
    public.has_role(auth.uid(), 'accounts'::app_role) OR
    public.has_role(auth.uid(), 'sales'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)    OR
    public.has_role(auth.uid(), 'accounts'::app_role) OR
    public.has_role(auth.uid(), 'sales'::app_role)
  );

DROP POLICY IF EXISTS "app_users_customer_own" ON public.app_users;
CREATE POLICY "app_users_customer_own" ON public.app_users
  FOR ALL TO authenticated
  USING   (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---- push_notifications_log ----
DROP POLICY IF EXISTS "push_log_staff_all" ON public.push_notifications_log;
CREATE POLICY "push_log_staff_all" ON public.push_notifications_log
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)    OR
    public.has_role(auth.uid(), 'accounts'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)    OR
    public.has_role(auth.uid(), 'accounts'::app_role)
  );

DROP POLICY IF EXISTS "push_log_customer_select_own" ON public.push_notifications_log;
CREATE POLICY "push_log_customer_select_own" ON public.push_notifications_log
  FOR SELECT TO authenticated
  USING (customer_id = public.get_loyalty_customer_id(auth.uid()));

DROP POLICY IF EXISTS "push_log_customer_update_opened" ON public.push_notifications_log;
CREATE POLICY "push_log_customer_update_opened" ON public.push_notifications_log
  FOR UPDATE TO authenticated
  USING   (customer_id = public.get_loyalty_customer_id(auth.uid()))
  WITH CHECK (customer_id = public.get_loyalty_customer_id(auth.uid()));

-- ---- card_settings ----
DROP POLICY IF EXISTS "card_settings_admin_all" ON public.card_settings;
CREATE POLICY "card_settings_admin_all" ON public.card_settings
  FOR ALL TO authenticated
  USING   (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "card_settings_staff_select" ON public.card_settings;
CREATE POLICY "card_settings_staff_select" ON public.card_settings
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)        OR
    public.has_role(auth.uid(), 'accounts'::app_role)     OR
    public.has_role(auth.uid(), 'sales'::app_role)        OR
    public.has_role(auth.uid(), 'service_head'::app_role)
  );

-- ---- card_bill_entries ----
DROP POLICY IF EXISTS "cbe_admin_all" ON public.card_bill_entries;
CREATE POLICY "cbe_admin_all" ON public.card_bill_entries
  FOR ALL TO authenticated
  USING   (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "cbe_accounts_select" ON public.card_bill_entries;
CREATE POLICY "cbe_accounts_select" ON public.card_bill_entries
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'accounts'::app_role));

DROP POLICY IF EXISTS "cbe_accounts_update" ON public.card_bill_entries;
CREATE POLICY "cbe_accounts_update" ON public.card_bill_entries
  FOR UPDATE TO authenticated
  USING   (public.has_role(auth.uid(), 'accounts'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'accounts'::app_role));

DROP POLICY IF EXISTS "cbe_sales_insert" ON public.card_bill_entries;
CREATE POLICY "cbe_sales_insert" ON public.card_bill_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'sales'::app_role)
    AND entered_by = auth.uid()
  );

DROP POLICY IF EXISTS "cbe_sales_select_own" ON public.card_bill_entries;
CREATE POLICY "cbe_sales_select_own" ON public.card_bill_entries
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'sales'::app_role)
    AND entered_by = auth.uid()
  );


-- ============================================================
-- F. POINTS ENGINE  (Step 3)
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_calc_points(p_tier TEXT, p_net_amount DECIMAL)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_per_rupees INT;
BEGIN
  CASE p_tier
    WHEN 'super_elite'    THEN v_per_rupees := 250;
    WHEN 'prestige_elite' THEN v_per_rupees := 200;
    ELSE RETURN 0;
  END CASE;
  RETURN FLOOR(GREATEST(p_net_amount, 0) / v_per_rupees)::INTEGER;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_sync_current_points()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cid UUID;
BEGIN
  v_cid := COALESCE(NEW.customer_id, OLD.customer_id);
  UPDATE public.elite_customers SET
    current_points  = (
      SELECT COALESCE(SUM(points), 0)
      FROM public.card_points
      WHERE customer_id = v_cid
    ),
    lifetime_points = (
      SELECT COALESCE(SUM(points), 0)
      FROM public.card_points
      WHERE customer_id = v_cid AND points > 0
    )
  WHERE id = v_cid;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_current_points ON public.card_points;
CREATE TRIGGER trg_sync_current_points
  AFTER INSERT OR UPDATE OR DELETE ON public.card_points
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_current_points();

CREATE OR REPLACE FUNCTION public.fn_credit_or_reverse_points()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer    public.elite_customers%ROWTYPE;
  v_prev_count  INTEGER;
  v_points      INTEGER;
  v_current_pts INTEGER;
  v_rr_status   TEXT;
  v_rr_pts      INTEGER;
BEGIN
  -- Only act on the transition → 'approved'
  IF NEW.approval_status <> 'approved' OR OLD.approval_status = 'approved' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_customer FROM public.elite_customers WHERE id = NEW.customer_id;

  -- ── RETURN: reverse earned points ──────────────────────────────────────
  IF NEW.is_return THEN
    v_points := public.fn_calc_points(v_customer.card_tier, NEW.gross_bill_amount);
    IF v_points > 0 THEN
      v_current_pts := COALESCE(
        (SELECT SUM(points) FROM public.card_points WHERE customer_id = NEW.customer_id), 0
      );
      IF v_current_pts > 0 THEN
        INSERT INTO public.card_points (customer_id, points, transaction_type, bill_id)
        VALUES (NEW.customer_id, -LEAST(v_points, v_current_pts), 'reversal', NEW.id);
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- ── REGULAR SALE: earn points ──────────────────────────────────────────
  IF v_customer.card_tier IN ('super_elite', 'prestige_elite') AND v_customer.app_activated THEN
    -- First purchase earns zero — check prior approved non-return entries
    SELECT COUNT(*) INTO v_prev_count
    FROM public.card_bill_entries
    WHERE customer_id = NEW.customer_id
      AND approval_status = 'approved'
      AND is_return = FALSE
      AND id <> NEW.id;

    IF v_prev_count > 0 THEN
      v_points := public.fn_calc_points(v_customer.card_tier, NEW.net_bill_amount);
      IF v_points > 0 THEN
        INSERT INTO public.card_points (customer_id, points, transaction_type, bill_id, expires_at)
        VALUES (NEW.customer_id, v_points, 'purchase', NEW.id, NOW() + INTERVAL '12 months');
      END IF;
    END IF;
  END IF;

  -- ── REDEMPTION: deduct points for a linked + approved request ──────────
  IF NEW.redemption_request_id IS NOT NULL THEN
    SELECT status, points_requested INTO v_rr_status, v_rr_pts
    FROM public.redemption_requests
    WHERE id = NEW.redemption_request_id;

    IF v_rr_status = 'approved' THEN
      INSERT INTO public.card_points (customer_id, points, transaction_type, bill_id)
      VALUES (NEW.customer_id, -v_rr_pts, 'redemption', NEW.id);

      UPDATE public.redemption_requests
        SET status = 'used', used_in_bill_id = NEW.id
      WHERE id = NEW.redemption_request_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bill_entry_points ON public.card_bill_entries;
CREATE TRIGGER trg_bill_entry_points
  AFTER UPDATE OF approval_status ON public.card_bill_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_credit_or_reverse_points();

CREATE OR REPLACE FUNCTION public.fn_expire_points()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r       RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR r IN
    SELECT id, customer_id, points
    FROM public.card_points
    WHERE transaction_type = 'purchase'
      AND is_expired = FALSE
      AND expires_at IS NOT NULL
      AND expires_at < NOW()
    FOR UPDATE SKIP LOCKED          -- safe for concurrent runs
  LOOP
    -- Insert a negative 'expiry' row; bill_id holds the source point-row id
    INSERT INTO public.card_points (customer_id, points, transaction_type, bill_id)
    VALUES (r.customer_id, -r.points, 'expiry', r.id);

    UPDATE public.card_points SET is_expired = TRUE WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_award_anniversary_bonus()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec     RECORD;
  v_bonus INTEGER;
  v_count INTEGER := 0;
  v_today DATE    := CURRENT_DATE;
BEGIN
  FOR rec IN
    SELECT ec.id, ec.card_tier
    FROM public.elite_customers ec
    WHERE ec.card_tier IN ('super_elite', 'prestige_elite')
      AND ec.app_activated = TRUE
      AND ec.status = 'active'
      AND ec.card_enrollment_date IS NOT NULL
      -- Same calendar day as enrollment, but in a later year
      AND EXTRACT(MONTH FROM ec.card_enrollment_date) = EXTRACT(MONTH FROM v_today)
      AND EXTRACT(DAY   FROM ec.card_enrollment_date) = EXTRACT(DAY   FROM v_today)
      AND EXTRACT(YEAR  FROM ec.card_enrollment_date) < EXTRACT(YEAR  FROM v_today)
      -- Idempotency: no anniversary_bonus credited today yet
      AND NOT EXISTS (
        SELECT 1 FROM public.card_points cp
        WHERE cp.customer_id = ec.id
          AND cp.transaction_type = 'anniversary_bonus'
          AND cp.created_at::date = v_today
      )
  LOOP
    v_bonus := CASE rec.card_tier WHEN 'super_elite' THEN 25 ELSE 50 END;
    INSERT INTO public.card_points (customer_id, points, transaction_type, expires_at)
    VALUES (rec.id, v_bonus, 'anniversary_bonus', NOW() + INTERVAL '12 months');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;


-- ============================================================
-- G. LAST-PURCHASE TRIGGER + OPTIONAL pg_cron  (Step 4)
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_update_last_purchase_date()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only fires on transition → 'approved' for non-return entries
  IF NEW.approval_status = 'approved'
     AND OLD.approval_status <> 'approved'
     AND NEW.is_return = FALSE
  THEN
    UPDATE public.elite_customers
       SET last_purchase_date = GREATEST(COALESCE(last_purchase_date, '1970-01-01'::DATE), NEW.bill_date)
     WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_last_purchase_date ON public.card_bill_entries;
CREATE TRIGGER trg_update_last_purchase_date
  AFTER UPDATE OF approval_status ON public.card_bill_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_update_last_purchase_date();

-- Daily loyalty cron (02:30 UTC = 08:00 IST). Requires pg_cron + pg_net and
-- the app.supabase_functions_url / app.loyalty_cron_secret settings; skipped
-- silently when unavailable so the rest of the script always succeeds.
DO $do$
BEGIN
  PERFORM cron.unschedule('loyalty-daily-cron')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'loyalty-daily-cron');

  PERFORM cron.schedule(
    'loyalty-daily-cron',
    '30 2 * * *',
    $cron$
      SELECT net.http_post(
        url     := current_setting('app.supabase_functions_url') || '/loyalty-cron',
        headers := jsonb_build_object(
          'Content-Type',      'application/json',
          'x-internal-secret', current_setting('app.loyalty_cron_secret')
        ),
        body    := '{}'::jsonb
      );
    $cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END;
$do$;


-- ============================================================
-- H. Refresh the PostgREST schema cache so the API sees the
--    new tables immediately.
-- ============================================================
NOTIFY pgrst, 'reload schema';
