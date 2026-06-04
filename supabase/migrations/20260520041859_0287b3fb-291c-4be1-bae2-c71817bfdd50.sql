
-- App settings (key/value)
CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read public settings"
  ON public.app_settings FOR SELECT
  USING (key IN ('google_review_url','business_phone'));

CREATE POLICY "Admins manage settings"
  ON public.app_settings FOR ALL
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

INSERT INTO public.app_settings(key, value) VALUES
  ('google_review_url', 'https://g.page/r/REPLACE_ME/review'),
  ('business_phone', '')
ON CONFLICT (key) DO NOTHING;

-- Customer feedback table
CREATE TABLE public.customer_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  comments text,
  overall_rating smallint NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  staff_rating smallint NOT NULL CHECK (staff_rating BETWEEN 1 AND 5),
  needs_attention boolean NOT NULL DEFAULT false,
  qualified_for_review boolean NOT NULL DEFAULT false,
  lead_created boolean NOT NULL DEFAULT false,
  lead_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(customer_phone) = 10 AND customer_phone ~ '^[0-9]+$'),
  CHECK (char_length(customer_name) BETWEEN 1 AND 100)
);
ALTER TABLE public.customer_feedback ENABLE ROW LEVEL SECURITY;

-- Public (anon + authenticated) can insert feedback
CREATE POLICY "Anyone can submit feedback"
  ON public.customer_feedback FOR INSERT
  WITH CHECK (true);

-- Only admins can read feedback
CREATE POLICY "Admins view feedback"
  ON public.customer_feedback FOR SELECT
  USING (has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "Admins update feedback"
  ON public.customer_feedback FOR UPDATE
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE INDEX idx_customer_feedback_created_at ON public.customer_feedback(created_at DESC);

-- Trigger: derived flags + auto-create lead when positive
CREATE OR REPLACE FUNCTION public.handle_customer_feedback_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid;
  v_lead_id uuid;
BEGIN
  NEW.needs_attention := NEW.overall_rating <= 2;
  NEW.qualified_for_review := NEW.overall_rating >= 4;

  IF NEW.overall_rating >= 4 THEN
    SELECT user_id INTO v_admin
      FROM public.user_roles
     WHERE role = 'admin'::app_role
     LIMIT 1;

    IF v_admin IS NOT NULL THEN
      INSERT INTO public.leads (
        customer_name, customer_phone, category, value_in_rupees,
        status, source, source_type, notes, created_by, updated_by
      )
      VALUES (
        NEW.customer_name,
        NEW.customer_phone,
        'kitchen'::lead_category,
        0,
        'new'::lead_status,
        'feedback_kiosk',
        'feedback',
        'Auto-created from kiosk feedback. Overall: ' || NEW.overall_rating
          || ', Staff: ' || NEW.staff_rating
          || COALESCE(E'\nComments: ' || NEW.comments, ''),
        v_admin,
        v_admin
      )
      RETURNING id INTO v_lead_id;

      NEW.lead_id := v_lead_id;
      NEW.lead_created := true;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_customer_feedback_before_insert
  BEFORE INSERT ON public.customer_feedback
  FOR EACH ROW EXECUTE FUNCTION public.handle_customer_feedback_insert();
