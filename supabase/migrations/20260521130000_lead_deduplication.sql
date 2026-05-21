
-- Lead deduplication: prevent duplicate leads from repeat customer feedback visits.
-- Instead of creating a new lead every time a customer submits positive feedback,
-- this migration:
--   1. Adds visit_count, last_activity_date, feedback_score columns to leads
--   2. Creates lead_deduplication_log for audit trail
--   3. Replaces the always-create-new-lead logic with smart create-or-update

-- 1. New columns on leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS visit_count        INTEGER   NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_activity_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS feedback_score     SMALLINT  CHECK (feedback_score BETWEEN 1 AND 5);

-- 2. Broaden source_type constraint to accept 'feedback'
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_source_type_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_source_type_check
  CHECK (source_type IN ('sales', 'field_agent', 'site_agent', 'walk_in', 'referral', 'feedback'));

-- 3. Deduplication audit log
CREATE TABLE IF NOT EXISTS public.lead_deduplication_log (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id         UUID        REFERENCES public.leads(id) ON DELETE CASCADE,
  feedback_id     UUID        REFERENCES public.customer_feedback(id) ON DELETE CASCADE,
  phone           TEXT        NOT NULL,
  action          TEXT        NOT NULL, -- 'created_new_lead' | 'updated_existing_lead'
  previous_stage  TEXT,
  new_stage       TEXT,
  assigned_to     UUID,
  visit_count     INTEGER     DEFAULT 1,
  last_visit_date TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.lead_deduplication_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view dedup log"
  ON public.lead_deduplication_log FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 4. Fast phone-based dedup lookup index
CREATE INDEX IF NOT EXISTS idx_leads_customer_phone
  ON public.leads(customer_phone)
  WHERE deleted_at IS NULL;

-- 5. Strip lead-creation logic from the BEFORE INSERT trigger (flags only now)
CREATE OR REPLACE FUNCTION public.handle_customer_feedback_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.needs_attention    := NEW.overall_rating <= 2;
  NEW.qualified_for_review := NEW.overall_rating >= 4;
  RETURN NEW;
END;
$$;

-- 6. Smart AFTER INSERT trigger: update existing lead OR create new one
CREATE OR REPLACE FUNCTION public.create_or_update_lead_from_feedback()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id         UUID;
  v_existing_stage      TEXT;
  v_existing_visit_count INTEGER;
  v_existing_assigned   UUID;
  v_new_visit_count     INTEGER;
  v_new_lead_id         UUID;
  v_admin_id            UUID;
BEGIN
  -- Only process positive feedback
  IF NEW.overall_rating < 4 THEN
    RETURN NEW;
  END IF;

  -- Look up most recent active lead for this phone number
  SELECT id, journey_stage, visit_count, assigned_to
  INTO v_existing_id, v_existing_stage, v_existing_visit_count, v_existing_assigned
  FROM public.leads
  WHERE customer_phone = NEW.customer_phone
    AND deleted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- ── EXISTING CUSTOMER ──────────────────────────────────────────────────
    -- Update the existing lead; keep the same assignee to preserve continuity.
    v_new_visit_count := COALESCE(v_existing_visit_count, 1) + 1;

    UPDATE public.leads
    SET
      feedback_score     = NEW.overall_rating,
      last_activity_date = NOW(),
      visit_count        = v_new_visit_count,
      notes              = COALESCE(notes, '')
                           || E'\n[Visit #' || v_new_visit_count
                           || '] Feedback: ' || NEW.overall_rating || '/5 overall, '
                           || NEW.staff_rating || '/5 staff'
                           || CASE
                                WHEN NEW.comments IS NOT NULL AND NEW.comments <> ''
                                THEN '. ' || NEW.comments
                                ELSE ''
                              END || '.',
      updated_at         = NOW()
    WHERE id = v_existing_id;

    -- Backfill feedback row so callers can see which lead it belongs to
    UPDATE public.customer_feedback
    SET lead_id = v_existing_id, lead_created = true
    WHERE id = NEW.id;

    INSERT INTO public.lead_deduplication_log
      (lead_id, feedback_id, phone, action,
       previous_stage, new_stage, assigned_to, visit_count, last_visit_date, notes)
    VALUES
      (v_existing_id, NEW.id, NEW.customer_phone,
       'updated_existing_lead',
       v_existing_stage, v_existing_stage,
       v_existing_assigned, v_new_visit_count, NOW(),
       'Repeat visit #' || v_new_visit_count || '. Rating: ' || NEW.overall_rating || '/5');

  ELSE
    -- ── NEW CUSTOMER ────────────────────────────────────────────────────────
    -- No existing lead found — create a fresh one.
    SELECT user_id INTO v_admin_id
    FROM public.user_roles
    WHERE role = 'admin'::app_role
    LIMIT 1;

    IF v_admin_id IS NULL THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.leads (
      customer_name, customer_phone, category, value_in_rupees,
      status, source, source_type, notes,
      created_by, updated_by,
      feedback_score, visit_count, last_activity_date
    ) VALUES (
      NEW.customer_name, NEW.customer_phone,
      'others'::lead_category, 0,
      'new'::lead_status,
      'feedback_kiosk', 'feedback',
      'Auto-created from kiosk feedback. Overall: ' || NEW.overall_rating
        || '/5, Staff: ' || NEW.staff_rating || '/5'
        || COALESCE(E'\nComments: ' || NEW.comments, ''),
      v_admin_id, v_admin_id,
      NEW.overall_rating, 1, NOW()
    )
    RETURNING id INTO v_new_lead_id;

    UPDATE public.customer_feedback
    SET lead_id = v_new_lead_id, lead_created = true
    WHERE id = NEW.id;

    INSERT INTO public.lead_deduplication_log
      (lead_id, feedback_id, phone, action,
       new_stage, visit_count, last_visit_date, notes)
    VALUES
      (v_new_lead_id, NEW.id, NEW.customer_phone,
       'created_new_lead',
       NULL, 1, NOW(),
       'First feedback visit. Rating: ' || NEW.overall_rating || '/5');

  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_feedback_dedup_lead ON public.customer_feedback;
CREATE TRIGGER trg_customer_feedback_dedup_lead
  AFTER INSERT ON public.customer_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.create_or_update_lead_from_feedback();
