CREATE OR REPLACE FUNCTION public.fn_card_issue_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate numeric;
  v_sales uuid;
BEGIN
  IF NEW.card_tier NOT IN ('super_elite','prestige_elite') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.card_tier = NEW.card_tier THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE((value ->> NEW.card_tier)::numeric, 0) INTO v_rate
  FROM public.card_settings
  WHERE key = 'commission_flat';

  v_sales := COALESCE(
    NEW.created_by,
    (SELECT l.assigned_to FROM public.leads l
      WHERE l.id = NEW.lead_id AND l.assigned_to IS NOT NULL
      LIMIT 1),
    (SELECT l.assigned_to FROM public.leads l
      WHERE regexp_replace(COALESCE(l.customer_phone,''), '\D', '', 'g') <> ''
        AND right(regexp_replace(COALESCE(l.customer_phone,''), '\D', '', 'g'), 10)
            = right(regexp_replace(COALESCE(NEW.phone_1,''), '\D', '', 'g'), 10)
        AND l.assigned_to IS NOT NULL
      ORDER BY l.created_at DESC LIMIT 1)
  );

  IF v_sales IS NOT NULL AND v_rate > 0 THEN
    INSERT INTO public.card_commissions (customer_id, bill_entry_id, sales_user_id, card_tier, commission_amount, status)
    VALUES (NEW.id, NULL, v_sales, NEW.card_tier, v_rate, 'pending')
    ON CONFLICT (customer_id, card_tier) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_card_issue_commission() FROM PUBLIC, anon, authenticated;