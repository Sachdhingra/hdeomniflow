-- Fix: Elite card carries no commission — only Super Elite (₹100) and Prestige Elite (₹200).
-- Also backfills commission rows for super_elite / prestige_elite members enrolled
-- in the last 3 days who are missing a card_commissions entry.

-- 1. Update card_settings to reflect correct amounts (remove elite key)
INSERT INTO public.card_settings (key, value)
VALUES ('card_commissions_flat', '{"super_elite": 100, "prestige_elite": 200}'::jsonb)
ON CONFLICT (key) DO UPDATE
  SET value      = EXCLUDED.value,
      updated_at = NOW();

-- 2. Remove any incorrectly logged commission rows for elite-tier members
DELETE FROM public.card_commissions
WHERE card_tier = 'elite';

-- 3. Backfill missing commission rows for the last 3 days
INSERT INTO public.card_commissions (salesperson_id, customer_id, card_tier, commission_amount)
SELECT
  ec.created_by,
  ec.id,
  ec.card_tier,
  CASE ec.card_tier
    WHEN 'super_elite'    THEN 100
    WHEN 'prestige_elite' THEN 200
  END
FROM public.elite_customers ec
WHERE ec.card_tier IN ('super_elite', 'prestige_elite')
  AND ec.created_at >= NOW() - INTERVAL '3 days'
  AND ec.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.card_commissions cc
    WHERE cc.customer_id = ec.id
  );
