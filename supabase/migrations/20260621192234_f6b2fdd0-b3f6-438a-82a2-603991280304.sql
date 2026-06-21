
ALTER TABLE public.service_jobs
  ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS invoice_date DATE;

CREATE OR REPLACE FUNCTION public.enforce_self_delivery_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type = 'self_delivery'::service_job_type THEN
    IF NEW.invoice_number IS NULL OR btrim(NEW.invoice_number) = '' THEN
      RAISE EXCEPTION 'Invoice number is required for self-delivery';
    END IF;
    IF NEW.invoice_date IS NULL THEN
      RAISE EXCEPTION 'Invoice date is required for self-delivery';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_self_delivery_invoice_trg ON public.service_jobs;
CREATE TRIGGER enforce_self_delivery_invoice_trg
BEFORE INSERT OR UPDATE ON public.service_jobs
FOR EACH ROW EXECUTE FUNCTION public.enforce_self_delivery_invoice();
