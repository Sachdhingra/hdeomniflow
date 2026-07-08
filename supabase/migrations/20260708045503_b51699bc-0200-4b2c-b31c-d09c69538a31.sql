
CREATE SEQUENCE IF NOT EXISTS public.elite_card_number_seq START 1001;

CREATE OR REPLACE FUNCTION public.generate_elite_card_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix TEXT;
  v_seq BIGINT;
  v_yy TEXT;
BEGIN
  IF NEW.card_number IS NOT NULL AND btrim(NEW.card_number) <> '' THEN
    RETURN NEW;
  END IF;
  v_prefix := CASE lower(COALESCE(NEW.card_tier,'silver'))
    WHEN 'prestige_elite' THEN 'PE'
    WHEN 'super_elite' THEN 'SE'
    WHEN 'elite' THEN 'EL'
    ELSE 'HDE'
  END;
  v_yy := to_char(COALESCE(NEW.card_issue_date, CURRENT_DATE), 'YY');
  v_seq := nextval('public.elite_card_number_seq');
  NEW.card_number := v_prefix || '-' || v_yy || '-' || lpad(v_seq::text, 5, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_elite_card_number ON public.elite_customers;
CREATE TRIGGER trg_elite_card_number
BEFORE INSERT ON public.elite_customers
FOR EACH ROW EXECUTE FUNCTION public.generate_elite_card_number();
