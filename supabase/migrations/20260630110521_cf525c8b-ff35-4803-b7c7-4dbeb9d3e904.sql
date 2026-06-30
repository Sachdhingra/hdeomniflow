
-- ============================================================
-- Insider (Home Decor Insider PWA) schema on Omni's database
-- ============================================================

-- 1. Extend elite_customers with loyalty / app fields
ALTER TABLE public.elite_customers
  ADD COLUMN IF NOT EXISTS app_activated         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS referral_code         text UNIQUE,
  ADD COLUMN IF NOT EXISTS card_tier             text NOT NULL DEFAULT 'silver',
  ADD COLUMN IF NOT EXISTS card_number           text UNIQUE,
  ADD COLUMN IF NOT EXISTS current_points        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_points       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS card_enrollment_date  date,
  ADD COLUMN IF NOT EXISTS date_of_birth         date;

-- 2. app_users — links a Supabase auth user to an elite_customers row
CREATE TABLE IF NOT EXISTS public.app_users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id          uuid NOT NULL REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  push_enabled         boolean NOT NULL DEFAULT true,
  onesignal_player_id  text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_users_user_id_key UNIQUE (user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_users TO authenticated;
GRANT ALL ON public.app_users TO service_role;

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

-- 3. Helper functions (security definer to break RLS recursion)
CREATE OR REPLACE FUNCTION public.get_loyalty_customer_id(_uid uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT customer_id FROM public.app_users WHERE user_id = _uid LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_loyalty_app_user(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS(SELECT 1 FROM public.app_users WHERE user_id = _uid);
$$;

-- app_users policies
DROP POLICY IF EXISTS "app_users: select own"  ON public.app_users;
DROP POLICY IF EXISTS "app_users: insert own"  ON public.app_users;
DROP POLICY IF EXISTS "app_users: update own"  ON public.app_users;
DROP POLICY IF EXISTS "app_users: staff read"  ON public.app_users;

CREATE POLICY "app_users: select own"
  ON public.app_users FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "app_users: insert own"
  ON public.app_users FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "app_users: update own"
  ON public.app_users FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "app_users: staff read"
  ON public.app_users FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'sales'::app_role)
  );

-- 4. card_points — points ledger
CREATE TABLE IF NOT EXISTS public.card_points (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid NOT NULL REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  points            integer NOT NULL,
  transaction_type  text NOT NULL DEFAULT 'earn',
  is_expired        boolean NOT NULL DEFAULT false,
  expires_at        timestamptz,
  notes             text,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS card_points_customer_idx ON public.card_points(customer_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_points TO authenticated;
GRANT ALL ON public.card_points TO service_role;
ALTER TABLE public.card_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "card_points: customer reads own"
  ON public.card_points FOR SELECT
  USING (customer_id = public.get_loyalty_customer_id(auth.uid()));
CREATE POLICY "card_points: staff reads all"
  ON public.card_points FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'sales'::app_role)
  );
CREATE POLICY "card_points: admin writes"
  ON public.card_points FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 5. redemption_requests
CREATE TABLE IF NOT EXISTS public.redemption_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid NOT NULL REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  points_requested  integer NOT NULL CHECK (points_requested > 0),
  rupee_value       numeric(12,2) NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'pending',
  notes             text,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  processed_by      uuid
);
CREATE INDEX IF NOT EXISTS redemption_requests_customer_idx
  ON public.redemption_requests(customer_id, requested_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.redemption_requests TO authenticated;
GRANT ALL ON public.redemption_requests TO service_role;
ALTER TABLE public.redemption_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "redemption: customer insert own"
  ON public.redemption_requests FOR INSERT
  WITH CHECK (customer_id = public.get_loyalty_customer_id(auth.uid()));
CREATE POLICY "redemption: customer reads own"
  ON public.redemption_requests FOR SELECT
  USING (customer_id = public.get_loyalty_customer_id(auth.uid()));
CREATE POLICY "redemption: staff reads all"
  ON public.redemption_requests FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'sales'::app_role)
  );
CREATE POLICY "redemption: admin updates"
  ON public.redemption_requests FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 6. app_service_requests
CREATE TABLE IF NOT EXISTS public.app_service_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         uuid NOT NULL REFERENCES public.elite_customers(id),
  product_description text NOT NULL,
  issue_description   text NOT NULL,
  contact_phone       text NOT NULL,
  preferred_callback  text,
  status              text NOT NULL DEFAULT 'open',
  created_at          timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_service_requests TO authenticated;
GRANT ALL ON public.app_service_requests TO service_role;
ALTER TABLE public.app_service_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asr: customer insert own"
  ON public.app_service_requests FOR INSERT
  WITH CHECK (customer_id = public.get_loyalty_customer_id(auth.uid()));
CREATE POLICY "asr: customer reads own"
  ON public.app_service_requests FOR SELECT
  USING (customer_id = public.get_loyalty_customer_id(auth.uid()));
CREATE POLICY "asr: staff reads all"
  ON public.app_service_requests FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'sales'::app_role)
    OR public.has_role(auth.uid(), 'service_head'::app_role)
  );
CREATE POLICY "asr: admin & service_head update"
  ON public.app_service_requests FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'service_head'::app_role)
  );

-- 7. Allow customer to read & update own elite_customers row via app_users link
--    (existing 'true' policies already allow read/update for any authenticated
--    user; that includes Insider customers. Adding explicit ones for clarity
--    if existing ones are later tightened.)
DROP POLICY IF EXISTS "elite: customer reads own" ON public.elite_customers;
CREATE POLICY "elite: customer reads own"
  ON public.elite_customers FOR SELECT
  USING (id = public.get_loyalty_customer_id(auth.uid()));

DROP POLICY IF EXISTS "elite: customer updates own" ON public.elite_customers;
CREATE POLICY "elite: customer updates own"
  ON public.elite_customers FOR UPDATE
  USING (id = public.get_loyalty_customer_id(auth.uid()));
