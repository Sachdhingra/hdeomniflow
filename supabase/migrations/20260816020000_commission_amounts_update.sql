-- Finalise commission amounts: ₹100 per Elite & Super Elite, ₹200 per Prestige Elite
-- Upsert the card_commissions_flat key in card_settings.

INSERT INTO public.card_settings (key, value)
VALUES ('card_commissions_flat', '{"elite": 100, "super_elite": 100, "prestige_elite": 200}'::jsonb)
ON CONFLICT (key) DO UPDATE
  SET value      = EXCLUDED.value,
      updated_at = NOW();
