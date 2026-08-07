-- Fix silver tier support for elite cards
--
-- Issue: The card_tier CHECK constraint only allows 'elite','super_elite','prestige_elite'
-- but the frontend includes 'silver' as a valid tier. When a new card is created via the
-- opt-in trigger without specifying a tier, the insert fails.
--
-- Solution: Add 'silver' to the allowed tier values and make it the default for new cards.

-- 1. Update elite_customers table to add 'silver' to the allowed values
--    and provide a default for new enrollments
ALTER TABLE public.elite_customers
  DROP CONSTRAINT IF EXISTS elite_customers_card_tier_check,
  ADD CONSTRAINT elite_customers_card_tier_check
    CHECK (card_tier IN ('silver','elite','super_elite','prestige_elite'));

-- 2. Backfill any NULL card_tier values with 'silver' (shouldn't exist, but just in case)
UPDATE public.elite_customers
SET card_tier = 'silver'
WHERE card_tier IS NULL;

-- 3. Update the trigger to set 'silver' as the default tier when creating a new card
CREATE OR REPLACE FUNCTION public.handle_lead_elite_optin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card_id UUID;
  v_issue DATE;
BEGIN
  -- Opt-in: link existing card for this phone, or create one
  IF NEW.elite_opted_in IS TRUE
     AND (TG_OP = 'INSERT' OR OLD.elite_opted_in IS DISTINCT FROM TRUE) THEN
    IF NEW.elite_card_id IS NULL THEN
      SELECT id INTO v_card_id FROM public.elite_customers
      WHERE phone_1 = NEW.customer_phone
      LIMIT 1;

      IF v_card_id IS NOT NULL THEN
        -- Card already exists for this phone — reuse it, never duplicate
        UPDATE public.elite_customers
           SET status = 'active',
               lead_id = COALESCE(lead_id, NEW.id),
               updated_at = now()
         WHERE id = v_card_id;
        NEW.elite_card_id := v_card_id;
      ELSE
        v_issue := COALESCE(NEW.elite_opted_date, CURRENT_DATE);
        INSERT INTO public.elite_customers
          (customer_name, phone_1, card_issue_date, status, lead_id, created_by, card_tier, notes)
        VALUES
          (NEW.customer_name, NEW.customer_phone, v_issue, 'active', NEW.id,
           COALESCE(NEW.updated_by, NEW.created_by), 'silver', 'Auto-enrolled from lead')
        ON CONFLICT (phone_1) DO UPDATE
          SET status = 'active',
              lead_id = COALESCE(public.elite_customers.lead_id, EXCLUDED.lead_id),
              updated_at = now()
        RETURNING id INTO v_card_id;
        NEW.elite_card_id := v_card_id;
      END IF;
    ELSE
      UPDATE public.elite_customers
         SET status = 'active',
             lead_id = COALESCE(lead_id, NEW.id),
             updated_at = now()
       WHERE id = NEW.elite_card_id;
    END IF;
  END IF;

  -- Opt-out: mark linked card as opted_out
  IF NEW.elite_opted_in IS FALSE
     AND (TG_OP = 'INSERT' OR OLD.elite_opted_in IS DISTINCT FROM FALSE) THEN
    IF NEW.elite_card_id IS NOT NULL THEN
      UPDATE public.elite_customers
         SET status = 'opted_out', updated_at = now()
       WHERE id = NEW.elite_card_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
