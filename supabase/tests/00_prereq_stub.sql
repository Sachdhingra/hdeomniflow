-- Stand-in for the parts of the live schema that the point-lot migration
-- touches. Lets the ledger tests run against a throwaway Postgres without a
-- full Supabase instance.
--
--   initdb -D /tmp/pg && pg_ctl -D /tmp/pg -o "-p 5433" start
--   psql -p 5433 -U postgres -f supabase/tests/00_prereq_stub.sql
--   psql -p 5433 -U postgres -f supabase/migrations/20260912000000_point_lot_consumption.sql
--   psql -p 5433 -U postgres -f supabase/tests/point_lot_consumption_test.sql

-- Minimal stand-in for the parts of the live schema the migration touches.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql AS $$ SELECT NULL::uuid $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TYPE public.app_role AS ENUM ('admin','sales','service_head','field_agent','site_agent');
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$ SELECT false $$;

CREATE TABLE public.elite_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT,
  current_points INTEGER NOT NULL DEFAULT 0,
  card_tier TEXT
);

CREATE TABLE public.card_points (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID        NOT NULL REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  points           INTEGER     NOT NULL,
  transaction_type TEXT        NOT NULL
    CHECK (transaction_type IN ('purchase','redemption','anniversary_bonus','referral','reversal','expiry')),
  bill_id          UUID,
  is_expired       BOOLEAN     NOT NULL DEFAULT false,
  expires_at       TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.card_points ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.redemption_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID NOT NULL REFERENCES public.elite_customers(id) ON DELETE CASCADE,
  points_requested INTEGER NOT NULL,
  rupee_value      NUMERIC NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- balance, as the live system computes it
CREATE OR REPLACE FUNCTION public.bal(p UUID) RETURNS INTEGER LANGUAGE sql AS
$$ SELECT COALESCE(SUM(points),0)::int FROM public.card_points WHERE customer_id = p $$;

-- The pre-fix expiry function, kept so tests can demonstrate the old bug.
CREATE OR REPLACE FUNCTION public.fn_expire_points_OLD()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE r RECORD; v_count INTEGER := 0;
BEGIN
  FOR r IN SELECT id, customer_id, points FROM public.card_points
    WHERE transaction_type='purchase' AND is_expired=FALSE
      AND expires_at IS NOT NULL AND expires_at < NOW() FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.card_points (customer_id, points, transaction_type, bill_id)
    VALUES (r.customer_id, -r.points, 'expiry', r.id);
    UPDATE public.card_points SET is_expired=TRUE WHERE id=r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
