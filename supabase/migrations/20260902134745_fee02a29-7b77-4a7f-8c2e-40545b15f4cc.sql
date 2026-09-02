UPDATE public.card_settings
SET value = '{"elite":0,"super_elite":100,"prestige_elite":200}'::jsonb,
    updated_at = now()
WHERE key = 'commission_flat';

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
  -- Commission applies only to super_elite and prestige_elite; elite earns 0
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
    (SELECT l.assigned_to FROM public.leads l WHERE l.phone = NEW.phone AND l.assigned_to IS NOT NULL ORDER BY l.created_at DESC LIMIT 1)
  );

  IF v_sales IS NOT NULL AND v_rate > 0 THEN
    INSERT INTO public.card_commissions (customer_id, bill_entry_id, sales_user_id, card_tier, commission_amount, status)
    VALUES (NEW.id, NULL, v_sales, NEW.card_tier, v_rate, 'pending')
    ON CONFLICT (customer_id, card_tier) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DELETE FROM public.card_commissions WHERE card_tier = 'elite';

REVOKE EXECUTE ON FUNCTION public.fn_card_issue_commission() FROM PUBLIC, anon, authenticated;