-- Referral Code auto-generation + Birthday Bonus Points
-- 1. Auto-generate referral_code at enrollment (BEFORE INSERT trigger)
-- 2. Backfill existing members who lack a referral code
-- 3. fn_award_birthday_bonus() — credits points on customer birthday
-- 4. Extend card_points.transaction_type to allow 'birthday_bonus'
-- 5. Seed card_settings and push_automation_settings rows

-- ============================================================
-- 1. Referral code generator
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_generate_referral_code(p_name TEXT, p_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_initials TEXT;
  v_code     TEXT;
  v_attempt  INTEGER := 0;
BEGIN
  -- First two uppercase letters (consonants/letters only) from name
  v_initials := UPPER(LEFT(REGEXP_REPLACE(p_name, '[^A-Za-z]', '', 'g'), 2));
  IF LENGTH(v_initials) < 2 THEN
    v_initials := RPAD(v_initials, 2, 'X');
  END IF;

  LOOP
    -- Format: HDE + 4-digit number + 2 name initials  e.g. HDE4521RA
    v_code := 'HDE' || LPAD((FLOOR(RANDOM() * 9000) + 1000)::TEXT, 4, '0') || v_initials;

    IF NOT EXISTS (
      SELECT 1 FROM public.elite_customers
      WHERE referral_code = v_code AND id <> p_id
    ) THEN
      RETURN v_code;
    END IF;

    v_attempt := v_attempt + 1;
    IF v_attempt > 20 THEN
      -- Fallback: first 6 hex chars of UUID, guaranteed unique
      RETURN 'HDE' || UPPER(LEFT(REPLACE(p_id::TEXT, '-', ''), 6));
    END IF;
  END LOOP;
END;
$$;

-- ============================================================
-- 2. BEFORE INSERT trigger — set referral_code if not supplied
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_set_referral_code()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := public.fn_generate_referral_code(NEW.customer_name, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_elite_referral_code ON public.elite_customers;
CREATE TRIGGER trg_elite_referral_code
  BEFORE INSERT ON public.elite_customers
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_referral_code();

-- ============================================================
-- 3. Backfill existing members that have no referral code yet
-- ============================================================
DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT id, customer_name FROM public.elite_customers WHERE referral_code IS NULL
  LOOP
    UPDATE public.elite_customers
       SET referral_code = public.fn_generate_referral_code(rec.customer_name, rec.id)
     WHERE id = rec.id;
  END LOOP;
END;
$$;

-- ============================================================
-- 4. Extend card_points.transaction_type to include birthday_bonus
--    Safe: drops the old CHECK (if any) and recreates it with the
--    full list, including legacy values from both migration lineages.
-- ============================================================
ALTER TABLE public.card_points
  DROP CONSTRAINT IF EXISTS card_points_transaction_type_check;

ALTER TABLE public.card_points
  ADD CONSTRAINT card_points_transaction_type_check
  CHECK (transaction_type IN (
    'purchase', 'redemption', 'anniversary_bonus', 'referral',
    'reversal', 'expiry', 'birthday_bonus',
    'earn', 'redeem'               -- legacy values from earlier migrations
  ));

-- ============================================================
-- 5. fn_award_birthday_bonus — credits points on birthday
--    Super Elite: 15 pts  |  Prestige Elite: 25 pts
--    Idempotent: skips if a birthday_bonus was already posted today.
--    Called daily by loyalty-cron; push notification handled separately.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_award_birthday_bonus()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec     RECORD;
  v_bonus INTEGER;
  v_count INTEGER := 0;
  v_today DATE    := CURRENT_DATE;
BEGIN
  FOR rec IN
    SELECT ec.id, ec.card_tier
    FROM public.elite_customers ec
    WHERE ec.card_tier IN ('super_elite', 'prestige_elite')
      AND ec.app_activated = TRUE
      AND ec.status = 'active'
      AND ec.date_of_birth IS NOT NULL
      AND EXTRACT(MONTH FROM ec.date_of_birth) = EXTRACT(MONTH FROM v_today)
      AND EXTRACT(DAY   FROM ec.date_of_birth) = EXTRACT(DAY   FROM v_today)
      -- Idempotency: no birthday_bonus credited today for this customer
      AND NOT EXISTS (
        SELECT 1 FROM public.card_points cp
        WHERE cp.customer_id = ec.id
          AND cp.transaction_type = 'birthday_bonus'
          AND cp.created_at::date = v_today
      )
  LOOP
    v_bonus := CASE rec.card_tier WHEN 'super_elite' THEN 15 ELSE 25 END;
    INSERT INTO public.card_points (customer_id, points, transaction_type, expires_at)
    VALUES (rec.id, v_bonus, 'birthday_bonus', NOW() + INTERVAL '12 months');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ============================================================
-- 6. card_settings — birthday bonus amounts
-- ============================================================
INSERT INTO public.card_settings (key, value) VALUES
  ('birthday_bonus_pts', '{"super_elite": 15, "prestige_elite": 25}')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 7. push_automation_settings — birthday_bonus toggle
-- ============================================================
INSERT INTO public.push_automation_settings (key, label, description) VALUES
  ('birthday_bonus', 'Birthday bonus points',
   'Credits loyalty points to Super Elite (15 pts) and Prestige Elite (25 pts) members on their birthday')
ON CONFLICT (key) DO NOTHING;
