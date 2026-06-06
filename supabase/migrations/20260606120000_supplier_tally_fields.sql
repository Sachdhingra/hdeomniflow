-- Add tally_ledger_name to suppliers for exact Tally ledger matching
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS tally_ledger_name TEXT;

-- Add supplier_gstin to company_purchases to track which branch invoiced
ALTER TABLE public.company_purchases ADD COLUMN IF NOT EXISTS supplier_gstin TEXT;
