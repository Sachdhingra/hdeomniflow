
-- 1. Add dedup/tracking columns to leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS visit_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS feedback_score smallint,
  ADD COLUMN IF NOT EXISTS last_activity_date timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_leads_customer_phone ON public.leads(customer_phone) WHERE deleted_at IS NULL;

-- 2. Dedup log table
CREATE TABLE IF NOT EXISTS public.lead_deduplication_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  customer_phone text NOT NULL,
  action text NOT NULL, -- created_new_lead | updated_existing_lead | visit_recorded
  source text,          -- feedback_kiosk | sales | etc.
  feedback_id uuid,
  visit_count integer,
  last_visit_date timestamptz,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dedup_log_lead ON public.lead_deduplication_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_dedup_log_phone ON public.lead_deduplication_log(customer_phone);

ALTER TABLE public.lead_deduplication_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage dedup log" ON public.lead_deduplication_log
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "View dedup log for accessible leads" ON public.lead_deduplication_log
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = lead_deduplication_log.lead_id
        AND (l.created_by = auth.uid() OR l.assigned_to = auth.uid())
    )
  );

-- 3. Replace feedback insert handler with smart dedup logic
CREATE OR REPLACE FUNCTION public.handle_customer_feedback_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_admin uuid;
  v_existing public.leads%ROWTYPE;
  v_lead_id uuid;
  v_action text;
  v_owner uuid;
BEGIN
  NEW.needs_attention := NEW.overall_rating <= 2;
  NEW.qualified_for_review := NEW.overall_rating >= 4;

  -- Try to find an existing non-deleted lead for this phone (most recent)
  SELECT * INTO v_existing
    FROM public.leads
   WHERE customer_phone = NEW.customer_phone
     AND deleted_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND THEN
    -- Update existing lead — DO NOT reassign
    UPDATE public.leads
       SET visit_count = COALESCE(visit_count, 1) + 1,
           feedback_score = NEW.overall_rating,
           last_activity_date = now(),
           notes = COALESCE(notes, '') ||
             E'\n[' || to_char(now(), 'YYYY-MM-DD HH24:MI') || '] Kiosk feedback: '
             || NEW.overall_rating || '★ (staff ' || NEW.staff_rating || '★)'
             || COALESCE(' — ' || NEW.comments, ''),
           updated_at = now()
     WHERE id = v_existing.id;

    v_lead_id := v_existing.id;
    v_owner := COALESCE(v_existing.assigned_to, v_existing.created_by);
    v_action := 'updated_existing_lead';

    NEW.lead_id := v_lead_id;
    NEW.lead_created := false;

  ELSIF NEW.overall_rating >= 4 THEN
    -- New positive lead — create
    SELECT user_id INTO v_admin
      FROM public.user_roles
     WHERE role = 'admin'::app_role
     LIMIT 1;

    IF v_admin IS NOT NULL THEN
      INSERT INTO public.leads (
        customer_name, customer_phone, category, value_in_rupees,
        status, source, source_type, notes, created_by, updated_by,
        visit_count, feedback_score, last_activity_date
      )
      VALUES (
        NEW.customer_name, NEW.customer_phone, 'kitchen'::lead_category, 0,
        'new'::lead_status, 'feedback_kiosk', 'feedback',
        'Auto-created from kiosk feedback. Overall: ' || NEW.overall_rating
          || ', Staff: ' || NEW.staff_rating
          || COALESCE(E'\nComments: ' || NEW.comments, ''),
        v_admin, v_admin, 1, NEW.overall_rating, now()
      )
      RETURNING id INTO v_lead_id;

      v_owner := v_admin;
      v_action := 'created_new_lead';
      NEW.lead_id := v_lead_id;
      NEW.lead_created := true;
    END IF;
  END IF;

  IF v_lead_id IS NOT NULL THEN
    INSERT INTO public.lead_deduplication_log (
      lead_id, customer_phone, action, source, feedback_id,
      visit_count, last_visit_date, notes, created_by
    )
    VALUES (
      v_lead_id, NEW.customer_phone, v_action, 'feedback_kiosk', NEW.id,
      (SELECT visit_count FROM public.leads WHERE id = v_lead_id),
      now(),
      'Rating ' || NEW.overall_rating || '★ / staff ' || NEW.staff_rating || '★',
      v_owner
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Ensure triggers are actually attached to customer_feedback
DROP TRIGGER IF EXISTS trg_customer_feedback_before_insert ON public.customer_feedback;
CREATE TRIGGER trg_customer_feedback_before_insert
  BEFORE INSERT ON public.customer_feedback
  FOR EACH ROW EXECUTE FUNCTION public.handle_customer_feedback_insert();

DROP TRIGGER IF EXISTS trg_customer_feedback_thank_you ON public.customer_feedback;
CREATE TRIGGER trg_customer_feedback_thank_you
  BEFORE INSERT ON public.customer_feedback
  FOR EACH ROW EXECUTE FUNCTION public.create_thank_you_message();
