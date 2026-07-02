-- Elite Card Loyalty — Step 2: card_bill_entries table + RLS
-- Bills are NOT generated here; sales staff enter figures after the Tally/manual bill.

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

-- ---- RLS POLICIES ----

-- Admin: full access
CREATE POLICY "cbe_admin_all" ON public.card_bill_entries
  FOR ALL TO authenticated
  USING   (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Accounts: SELECT all + UPDATE approval fields (status, approved_by, approved_at, notes)
CREATE POLICY "cbe_accounts_select" ON public.card_bill_entries
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'accounts'::app_role));

CREATE POLICY "cbe_accounts_update" ON public.card_bill_entries
  FOR UPDATE TO authenticated
  USING   (public.has_role(auth.uid(), 'accounts'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'accounts'::app_role));

-- Sales: INSERT own entries; SELECT own entries
CREATE POLICY "cbe_sales_insert" ON public.card_bill_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'sales'::app_role)
    AND entered_by = auth.uid()
  );

CREATE POLICY "cbe_sales_select_own" ON public.card_bill_entries
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'sales'::app_role)
    AND entered_by = auth.uid()
  );
