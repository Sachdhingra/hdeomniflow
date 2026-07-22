-- Elite Card Loyalty — duplicate prevention + deletion integrity
--
-- Fixes four issues observed in production:
-- 1. Duplicate elite_customers rows for the same phone (client-side
--    .maybeSingle() guards fail silently once one duplicate exists, and the
--    lead opt-in trigger inserted without checking the phone).
--    → merge existing duplicates, add a UNIQUE index on phone_1, and make
--      the opt-in trigger reuse the existing card instead of inserting.
-- 2. Deleting a wrong-entry lead left the elite card (and its points)
--    orphaned in the system.
--    → child tables now cascade on elite_customers delete, and deleting
--      (hard or soft) the only lead linked to a card removes the card and
--      all its children — no trace left.
-- 3. Re-entering an existing customer offered a fresh card.
--    → DB now hard-guarantees reuse (unique phone + trigger); UI shows
--      "Elite card already exists" (separate frontend change).
-- 4. Cooling period admin-tunable: card_settings.points_cooling_days is
--    already RLS-restricted to admin writes; UI added separately.

-- ============================================================
-- 1. MERGE EXISTING DUPLICATES (same phone_1)
--    Keeper: app-activated first, then oldest. All FK children are
--    repointed to the keeper; rows that would violate a unique
--    constraint (e.g. app_users.customer_id) are dropped instead.
-- ============================================================
DO $$
DECLARE
  dup    RECORD;
  child  RECORD;
  keeper UUID;
  i      INTEGER;
BEGIN
  FOR dup IN
    SELECT phone_1,
           array_agg(id ORDER BY app_activated DESC NULLS LAST, created_at ASC) AS ids
    FROM public.elite_customers
    WHERE phone_1 IS NOT NULL
    GROUP BY phone_1
    HAVING COUNT(*) > 1
  LOOP
    keeper := dup.ids[1];
    FOR i IN 2 .. array_length(dup.ids, 1) LOOP
      FOR child IN
        SELECT con.conrelid::regclass AS tbl,
               (SELECT attname FROM pg_attribute
                WHERE attrelid = con.conrelid AND attnum = con.conkey[1]) AS col
        FROM pg_constraint con
        WHERE con.contype = 'f'
          AND con.confrelid = 'public.elite_customers'::regclass
      LOOP
        BEGIN
          EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2',
                         child.tbl, child.col, child.col)
            USING keeper, dup.ids[i];
        EXCEPTION WHEN unique_violation THEN
          EXECUTE format('DELETE FROM %s WHERE %I = $1', child.tbl, child.col)
            USING dup.ids[i];
        END;
      END LOOP;
      DELETE FROM public.elite_customers WHERE id = dup.ids[i];
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- 2. ONE CARD PER PHONE — hard guarantee
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_elite_customers_phone_1
  ON public.elite_customers(phone_1);

-- ============================================================
-- 3. OPT-IN TRIGGER: reuse the existing card for this phone,
--    never insert a duplicate. (Also guards OLD references so the
--    function is INSERT-safe.)
-- ============================================================
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
          (customer_name, phone_1, card_issue_date, status, lead_id, created_by, notes)
        VALUES
          (NEW.customer_name, NEW.customer_phone, v_issue, 'active', NEW.id,
           COALESCE(NEW.updated_by, NEW.created_by), 'Auto-enrolled from lead')
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

-- ============================================================
-- 4. CASCADE DELETES: every child of elite_customers is removed
--    with the card (points, bills, app link, commissions, logs…).
--    leads.elite_card_id keeps its ON DELETE SET NULL behaviour.
-- ============================================================
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname,
           con.conrelid::regclass AS tbl,
           (SELECT attname FROM pg_attribute
            WHERE attrelid = con.conrelid AND attnum = con.conkey[1]) AS col
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.elite_customers'::regclass
      AND con.confdeltype <> 'c'
      AND con.conrelid <> 'public.leads'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) '
      || 'REFERENCES public.elite_customers(id) ON DELETE CASCADE',
      r.tbl, r.conname, r.col);
  END LOOP;
END $$;

-- ============================================================
-- 5. LEAD DELETION → CARD CLEANUP (no trace)
--    When the only lead linked to a card is deleted (hard delete or
--    soft delete to the recycle bin), the card and all its children
--    are removed. If other live leads still reference the card
--    (a real customer with more sales), the card survives.
-- ============================================================

-- Hard delete
CREATE OR REPLACE FUNCTION public.fn_lead_delete_cleanup_elite()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.elite_card_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.leads
       WHERE elite_card_id = OLD.elite_card_id
         AND id <> OLD.id
         AND deleted_at IS NULL
     ) THEN
    DELETE FROM public.elite_customers WHERE id = OLD.elite_card_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_delete_cleanup_elite ON public.leads;
CREATE TRIGGER trg_lead_delete_cleanup_elite
  AFTER DELETE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_lead_delete_cleanup_elite();

-- Soft delete (recycle bin)
CREATE OR REPLACE FUNCTION public.fn_lead_soft_delete_cleanup_elite()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.elite_card_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.leads
       WHERE elite_card_id = NEW.elite_card_id
         AND id <> NEW.id
         AND deleted_at IS NULL
     ) THEN
    DELETE FROM public.elite_customers WHERE id = NEW.elite_card_id;
    -- FK sets leads.elite_card_id to NULL; clear the opt-in flags too so a
    -- restored lead comes back clean
    UPDATE public.leads
       SET elite_opted_in = NULL, elite_opted_date = NULL
     WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_soft_delete_cleanup_elite ON public.leads;
CREATE TRIGGER trg_lead_soft_delete_cleanup_elite
  AFTER UPDATE OF deleted_at ON public.leads
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
  EXECUTE FUNCTION public.fn_lead_soft_delete_cleanup_elite();
