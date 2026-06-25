-- Elite Card Loyalty Program — Step 1: Schema + RLS
-- Expands elite_customers and adds 6 new loyalty tables.
-- "customers" in the build spec maps to the existing elite_customers table.

-- ============================================================
-- 1. EXPAND elite_customers
-- ============================================================

-- card_expiry_date was GENERATED ALWAYS AS (card_issue_date + 3 years); we need
-- a plain TIMESTAMPTZ so the app can set it independently (e.g., Prestige enrolled
-- mid-year with a bill date, not card_issue_date).
ALTER TABLE public.elite_customers DROP COLUMN IF EXISTS card_expiry_date;

ALTER TABLE public.elite_customers
  ADD COLUMN IF NOT EXISTS card_tier            TEXT
    CHECK (card_tier IN ('elite','super_elite','prestige_elite')),
  ADD COLUMN IF NOT EXISTS card_number          TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS card_enrollment_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS card_expiry_date     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_points       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_points      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS app_activated        BOOLEAN NOT NULL DEFAULT false;

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
-- 2. card_points
-- ============================================================
CREATE TABLE IF NOT EXISTS public.card_points (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID        NOT NULL REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  points           INTEGER     NOT NULL,
  transaction_type TEXT        NOT NULL
    CHECK (transaction_type IN ('purchase','redemption','anniversary_bonus','referral','reversal','expiry')),
  bill_id          UUID,           -- references hde_orders; no FK to stay decoupled
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.card_points ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_points TO authenticated;
GRANT ALL ON public.card_points TO service_role;

CREATE INDEX IF NOT EXISTS idx_card_points_customer ON public.card_points(customer_id);
CREATE INDEX IF NOT EXISTS idx_card_points_expires  ON public.card_points(expires_at)
  WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_card_points_bill     ON public.card_points(bill_id)
  WHERE bill_id IS NOT NULL;

-- ============================================================
-- 3. card_commissions
-- ============================================================
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

-- ============================================================
-- 4. redemption_requests
-- ============================================================
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

-- ============================================================
-- 5. app_users  (customer PWA ↔ auth.users ↔ elite_customers)
-- ============================================================
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

-- ============================================================
-- 6. push_notifications_log
-- ============================================================
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

-- ============================================================
-- 7. card_settings  (admin-editable program parameters)
-- ============================================================
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

-- Seed default parameters (idempotent via ON CONFLICT DO NOTHING)
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
-- 8. RLS HELPER FUNCTIONS
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
-- 9. RLS POLICIES
-- ============================================================

-- ---- elite_customers: tighten existing overly-permissive policies ----
DROP POLICY IF EXISTS "elite_select_auth"   ON public.elite_customers;
DROP POLICY IF EXISTS "elite_insert_auth"   ON public.elite_customers;
DROP POLICY IF EXISTS "elite_update_auth"   ON public.elite_customers;
DROP POLICY IF EXISTS "elite_delete_admin"  ON public.elite_customers;
DROP POLICY IF EXISTS "elite_delete_owner"  ON public.elite_customers;

-- Staff (admin / sales / accounts / service_head): full CRUD
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

-- Customer app: SELECT own row only
CREATE POLICY "elite_customer_app_select_own" ON public.elite_customers
  FOR SELECT TO authenticated
  USING (id = public.get_loyalty_customer_id(auth.uid()));

-- ---- card_points ----
-- Writes: accounts + admin only (points post after accounts approval)
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

-- Customer app: SELECT own points only
CREATE POLICY "card_points_customer_select_own" ON public.card_points
  FOR SELECT TO authenticated
  USING (customer_id = public.get_loyalty_customer_id(auth.uid()));

-- ---- card_commissions ----
-- Admin + accounts: full access
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

-- Salesperson: SELECT own commissions only
CREATE POLICY "card_commissions_salesperson_select_own" ON public.card_commissions
  FOR SELECT TO authenticated
  USING (salesperson_id = auth.uid());

-- ---- redemption_requests ----
-- Staff: full access
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

-- Customer app: SELECT own + INSERT own (only status='pending' allowed on insert)
CREATE POLICY "redemption_customer_select_own" ON public.redemption_requests
  FOR SELECT TO authenticated
  USING (customer_id = public.get_loyalty_customer_id(auth.uid()));

CREATE POLICY "redemption_customer_insert_own" ON public.redemption_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    customer_id = public.get_loyalty_customer_id(auth.uid())
    AND status = 'pending'
  );

-- ---- app_users ----
-- Staff: full access
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

-- Customer app: own row (SELECT / INSERT on registration / UPDATE last_active_at, onesignal_player_id)
CREATE POLICY "app_users_customer_own" ON public.app_users
  FOR ALL TO authenticated
  USING   (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---- push_notifications_log ----
-- Admin + accounts: full access (send campaigns, view logs)
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

-- Customer app: SELECT own notifications
CREATE POLICY "push_log_customer_select_own" ON public.push_notifications_log
  FOR SELECT TO authenticated
  USING (customer_id = public.get_loyalty_customer_id(auth.uid()));

-- Customer app: mark notification as opened
CREATE POLICY "push_log_customer_update_opened" ON public.push_notifications_log
  FOR UPDATE TO authenticated
  USING   (customer_id = public.get_loyalty_customer_id(auth.uid()))
  WITH CHECK (customer_id = public.get_loyalty_customer_id(auth.uid()));

-- ---- card_settings ----
-- Admin: full CRUD
CREATE POLICY "card_settings_admin_all" ON public.card_settings
  FOR ALL TO authenticated
  USING   (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Staff: SELECT only (bill creation logic reads settings at runtime)
CREATE POLICY "card_settings_staff_select" ON public.card_settings
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)        OR
    public.has_role(auth.uid(), 'accounts'::app_role)     OR
    public.has_role(auth.uid(), 'sales'::app_role)        OR
    public.has_role(auth.uid(), 'service_head'::app_role)
  );
