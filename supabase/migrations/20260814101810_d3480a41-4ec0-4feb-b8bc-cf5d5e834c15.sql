CREATE OR REPLACE FUNCTION public.fn_lead_won_create_bill_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_entered_by UUID;
  v_issue_date DATE;
BEGIN
  IF NEW.status::text NOT IN ('won','converted')
     OR NEW.elite_card_id IS NULL
     OR COALESCE(NEW.value_in_rupees,0) <= 0
     OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.card_bill_entries WHERE lead_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  SELECT card_issue_date INTO v_issue_date
    FROM public.elite_customers WHERE id = NEW.elite_card_id;
  IF v_issue_date IS NULL OR CURRENT_DATE < v_issue_date THEN
    RETURN NEW;
  END IF;

  v_entered_by := COALESCE(NEW.updated_by, NEW.created_by);
  IF v_entered_by IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.card_bill_entries
    (customer_id, entered_by, lead_id, bill_date,
     gross_bill_amount, net_bill_amount, approval_status, notes)
  VALUES
    (NEW.elite_card_id, v_entered_by, NEW.id, CURRENT_DATE,
     NEW.value_in_rupees, NEW.value_in_rupees, 'pending',
     'Auto-created from won lead — accounts to confirm final net value')
  ON CONFLICT (lead_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_lead_won_create_bill_entry ON public.leads;
CREATE TRIGGER trg_lead_won_create_bill_entry
AFTER INSERT OR UPDATE OF status, elite_card_id, value_in_rupees
ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.fn_lead_won_create_bill_entry();

INSERT INTO public.card_bill_entries
  (customer_id, entered_by, lead_id, bill_date, gross_bill_amount, net_bill_amount, approval_status, notes)
SELECT l.elite_card_id,
       COALESCE(l.updated_by, l.created_by),
       l.id,
       COALESCE(l.last_purchase_date::date, l.updated_at::date, CURRENT_DATE),
       l.value_in_rupees,
       l.value_in_rupees,
       'pending',
       'Auto-created from won lead — accounts to confirm final net value'
FROM public.leads l
JOIN public.elite_customers ec ON ec.id = l.elite_card_id
WHERE l.status::text IN ('won','converted')
  AND l.deleted_at IS NULL
  AND COALESCE(l.value_in_rupees,0) > 0
  AND COALESCE(l.updated_by, l.created_by) IS NOT NULL
  AND ec.card_issue_date IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.card_bill_entries b WHERE b.lead_id = l.id)
ON CONFLICT (lead_id) DO NOTHING;