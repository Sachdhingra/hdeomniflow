
-- Suppliers
CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  gstin TEXT,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY suppliers_accounts_admin_all ON public.suppliers FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role));

INSERT INTO public.suppliers (name) VALUES ('GODREJ AND BOYCE MANUFACTURING CO LTD') ON CONFLICT DO NOTHING;

-- Sequence for purchase numbers
CREATE SEQUENCE IF NOT EXISTS public.company_purchase_seq START 1;

CREATE TABLE public.company_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_number TEXT UNIQUE,
  supplier_name TEXT NOT NULL,
  supplier_invoice_no TEXT NOT NULL,
  purchase_date DATE NOT NULL,
  voucher_class TEXT NOT NULL DEFAULT 'PURCHASE GST',
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'Draft', -- Draft | Confirmed | Tally Exported
  tally_import_status TEXT NOT NULL DEFAULT 'Pending', -- Pending | Exported | Failed
  tally_exported_at TIMESTAMPTZ,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  gst_total NUMERIC NOT NULL DEFAULT 0,
  grand_total NUMERIC NOT NULL DEFAULT 0,
  pdf_url TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.company_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY cp_accounts_admin_all ON public.company_purchases FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role));

CREATE TABLE public.purchase_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES public.company_purchases(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  item_code TEXT,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'PCS',
  rate NUMERIC NOT NULL DEFAULT 0,
  discount_percent NUMERIC NOT NULL DEFAULT 0,
  amount NUMERIC NOT NULL DEFAULT 0,
  hsn_code TEXT,
  gst_percent NUMERIC NOT NULL DEFAULT 5,
  gst_amount NUMERIC NOT NULL DEFAULT 0,
  line_total NUMERIC NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY pli_accounts_admin_all ON public.purchase_line_items FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role));

CREATE INDEX idx_pli_purchase ON public.purchase_line_items(purchase_id);

-- Assign purchase_number on insert
CREATE OR REPLACE FUNCTION public.assign_purchase_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.purchase_number IS NULL OR NEW.purchase_number = '' THEN
    NEW.purchase_number := 'PO-' || lpad(nextval('public.company_purchase_seq')::text, 3, '0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_assign_purchase_number BEFORE INSERT ON public.company_purchases
FOR EACH ROW EXECUTE FUNCTION public.assign_purchase_number();

CREATE TRIGGER trg_cp_updated_at BEFORE UPDATE ON public.company_purchases
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_sup_updated_at BEFORE UPDATE ON public.suppliers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Recalc line item amounts
CREATE OR REPLACE FUNCTION public.recalc_purchase_line_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  NEW.amount := ROUND( (COALESCE(NEW.quantity,0) * COALESCE(NEW.rate,0)) * (1 - COALESCE(NEW.discount_percent,0)/100.0), 2);
  NEW.gst_amount := ROUND( NEW.amount * COALESCE(NEW.gst_percent,0)/100.0, 2);
  NEW.line_total := ROUND( NEW.amount + NEW.gst_amount, 2);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_recalc_pli BEFORE INSERT OR UPDATE ON public.purchase_line_items
FOR EACH ROW EXECUTE FUNCTION public.recalc_purchase_line_item();

-- Rollup totals onto parent purchase
CREATE OR REPLACE FUNCTION public.recalc_purchase_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID;
BEGIN
  v_id := COALESCE(NEW.purchase_id, OLD.purchase_id);
  UPDATE public.company_purchases cp
     SET subtotal = COALESCE((SELECT SUM(amount) FROM public.purchase_line_items WHERE purchase_id=v_id),0),
         gst_total = COALESCE((SELECT SUM(gst_amount) FROM public.purchase_line_items WHERE purchase_id=v_id),0),
         grand_total = COALESCE((SELECT SUM(line_total) FROM public.purchase_line_items WHERE purchase_id=v_id),0),
         updated_at = now()
   WHERE cp.id = v_id;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_rollup_pli AFTER INSERT OR UPDATE OR DELETE ON public.purchase_line_items
FOR EACH ROW EXECUTE FUNCTION public.recalc_purchase_totals();

-- Storage bucket for PDFs
INSERT INTO storage.buckets (id, name, public) VALUES ('purchase-pdfs','purchase-pdfs', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "purchase_pdfs_accounts_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='purchase-pdfs' AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role)));
CREATE POLICY "purchase_pdfs_accounts_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='purchase-pdfs' AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role)));
CREATE POLICY "purchase_pdfs_accounts_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id='purchase-pdfs' AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role)));
CREATE POLICY "purchase_pdfs_accounts_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id='purchase-pdfs' AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role)));
