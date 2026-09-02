UPDATE public.card_settings
SET value = '{"elite":100,"super_elite":100,"prestige_elite":200}'::jsonb, updated_at = now()
WHERE key = 'commission_flat';

CREATE UNIQUE INDEX IF NOT EXISTS card_commissions_customer_tier_uniq
  ON public.card_commissions (customer_id, card_tier);

CREATE OR REPLACE FUNCTION public.fn_card_issue_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_amount NUMERIC;
  v_flat   JSONB;
  v_sales  UUID;
BEGIN
  IF NEW.card_tier IS NULL OR NEW.card_tier = 'silver' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.card_tier IS NOT DISTINCT FROM NEW.card_tier THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_flat FROM public.card_settings WHERE key = 'commission_flat';
  v_amount := COALESCE((v_flat->>NEW.card_tier)::NUMERIC, 0);
  IF v_amount <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT l.assigned_to INTO v_sales FROM public.leads l WHERE l.id = NEW.lead_id;
  v_sales := COALESCE(v_sales, NEW.created_by);
  IF v_sales IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.card_commissions
    (salesperson_id, customer_id, card_tier, commission_amount)
  VALUES (v_sales, NEW.id, NEW.card_tier, v_amount)
  ON CONFLICT (customer_id, card_tier) DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_card_issue_commission ON public.elite_customers;
CREATE TRIGGER trg_card_issue_commission
AFTER INSERT OR UPDATE OF card_tier ON public.elite_customers
FOR EACH ROW EXECUTE FUNCTION public.fn_card_issue_commission();

INSERT INTO public.card_commissions (salesperson_id, customer_id, card_tier, commission_amount, created_at)
SELECT COALESCE(l.assigned_to, ec.created_by),
       ec.id,
       ec.card_tier,
       COALESCE(((SELECT value FROM public.card_settings WHERE key='commission_flat')->>ec.card_tier)::NUMERIC, 0),
       COALESCE(ec.card_issue_date::timestamptz, ec.created_at)
FROM public.elite_customers ec
LEFT JOIN public.leads l ON l.id = ec.lead_id
WHERE ec.card_tier IN ('elite','super_elite','prestige_elite')
  AND COALESCE(l.assigned_to, ec.created_by) IS NOT NULL
ON CONFLICT (customer_id, card_tier) DO NOTHING;