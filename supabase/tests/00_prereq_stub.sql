-- Stand-in for the parts of the LIVE schema that the redemption migrations
-- touch, reconstructed from queries against production (card_points has no
-- bill_id and no transaction_type check; fn_sync_customer_points clamps the
-- displayed balance; fn_expire_points is the live pre-fix version). Lets the
-- tests run on a throwaway Postgres without a full Supabase instance.
--
--   initdb -D /tmp/pg && pg_ctl -D /tmp/pg -o "-p 5433" start
--   psql -p 5433 -U postgres -f supabase/tests/00_prereq_stub.sql
--   psql -p 5433 -U postgres -f supabase/migrations/20260912000000_point_lot_consumption.sql
--   psql -p 5433 -U postgres -f supabase/migrations/20260912010000_lock_customer_self_writes.sql
--   psql -p 5433 -U postgres -f supabase/tests/point_lot_consumption_test.sql
--   psql -p 5433 -U postgres -f supabase/tests/customer_write_guard_test.sql

CREATE SCHEMA IF NOT EXISTS auth;
-- auth.uid() reads the same GUC PostgREST sets from the JWT
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin','sales','service_head','field_agent','site_agent','accounts');
CREATE TABLE public.user_roles (user_id UUID NOT NULL, role public.app_role NOT NULL);
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO anon, authenticated;

CREATE TABLE public.elite_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT, phone_1 TEXT,
  card_issue_date DATE,
  -- GENERATED in production: (card_issue_date + '3 years'). Postgres computes it after BEFORE
  -- triggers run, so NEW.card_expiry_date inside a BEFORE trigger differs from OLD.
  card_expiry_date DATE GENERATED ALWAYS AS (card_issue_date + 1095) STORED,
  status TEXT DEFAULT 'active',
  app_activated BOOLEAN DEFAULT false,
  referral_code TEXT, card_tier TEXT, card_number TEXT,
  current_points INTEGER NOT NULL DEFAULT 0,
  lifetime_points INTEGER NOT NULL DEFAULT 0,
  date_of_birth DATE, anniversary_date DATE,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.app_users (user_id UUID PRIMARY KEY, customer_id UUID NOT NULL REFERENCES public.elite_customers(id));
CREATE OR REPLACE FUNCTION public.get_loyalty_customer_id(_uid UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT customer_id FROM public.app_users WHERE user_id = _uid LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION public.get_loyalty_customer_id(UUID) TO anon, authenticated;

-- live shape: no bill_id, no transaction_type check, default 'earn'
CREATE TABLE public.card_points (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID        NOT NULL REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  points           INTEGER     NOT NULL,
  transaction_type TEXT        NOT NULL DEFAULT 'earn',
  is_expired       BOOLEAN     NOT NULL DEFAULT false,
  expires_at       TIMESTAMPTZ,
  notes            TEXT,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.redemption_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  points_requested INTEGER CHECK (points_requested > 0),
  rupee_value      NUMERIC,
  status           TEXT DEFAULT 'pending',
  requested_at     TIMESTAMPTZ DEFAULT now(),
  processed_at     TIMESTAMPTZ, processed_by UUID, used_in_bill_id UUID, notes TEXT
);
ALTER TABLE public.redemption_requests ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.redemption_requests, public.elite_customers, public.card_points TO anon, authenticated, service_role;

-- the live INSERT policy BEFORE hardening: no status check
CREATE POLICY "redemption: customer insert own" ON public.redemption_requests
  FOR INSERT TO public WITH CHECK (customer_id = public.get_loyalty_customer_id(auth.uid()));
CREATE POLICY "redemption: customer reads own" ON public.redemption_requests
  FOR SELECT TO public USING (customer_id = public.get_loyalty_customer_id(auth.uid()));

-- live fn_sync_customer_points: clamps the displayed balance at 0
CREATE OR REPLACE FUNCTION public.fn_sync_customer_points() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_cid UUID := COALESCE(NEW.customer_id, OLD.customer_id); v_current INTEGER; v_lifetime INTEGER;
BEGIN
  SELECT COALESCE(SUM(points),0) INTO v_current FROM public.card_points WHERE customer_id = v_cid;
  SELECT COALESCE(SUM(points),0) INTO v_lifetime FROM public.card_points
   WHERE customer_id = v_cid AND transaction_type IN ('purchase','anniversary_bonus','referral');
  UPDATE public.elite_customers SET current_points = GREATEST(0, v_current),
         lifetime_points = GREATEST(0, v_lifetime), updated_at = now() WHERE id = v_cid;
  RETURN NULL;
END; $function$;
CREATE TRIGGER trg_sync_customer_points AFTER INSERT OR DELETE OR UPDATE ON public.card_points
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_customer_points();

-- live updated_at trigger on elite_customers (fires before the guard)
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER trg_elite_updated_at BEFORE UPDATE ON public.elite_customers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- balance as the ledger sees it (unclamped)
CREATE OR REPLACE FUNCTION public.bal(p UUID) RETURNS INTEGER LANGUAGE sql AS
$$ SELECT COALESCE(SUM(points),0)::int FROM public.card_points WHERE customer_id = p $$;

-- the LIVE pre-fix expiry function, kept so tests can demonstrate the old bug
CREATE OR REPLACE FUNCTION public.fn_expire_points_OLD() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE rec RECORD; v_count INTEGER := 0;
BEGIN
  FOR rec IN SELECT id, customer_id, points FROM public.card_points
    WHERE points > 0 AND transaction_type IN ('purchase','anniversary_bonus','referral')
      AND expires_at IS NOT NULL AND expires_at <= now() AND COALESCE(is_expired,false) = false
  LOOP
    INSERT INTO public.card_points (customer_id, points, transaction_type, notes)
    VALUES (rec.customer_id, -rec.points, 'expiry', 'Auto-expiry of points from '||rec.id::text);
    UPDATE public.card_points SET is_expired = true WHERE id = rec.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $function$;

-- test helper
CREATE OR REPLACE FUNCTION public.chk(label TEXT, got ANYELEMENT, want ANYELEMENT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'FAIL % : got %, want %', label, got, want; END IF;
  RAISE NOTICE 'pass  %  (%)', label, got;
END $$;
