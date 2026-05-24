
-- 1. Update review URL
UPDATE public.app_settings SET value = 'https://g.page/r/CSD4GHiNc4IUEAE/review', updated_at = now()
WHERE key = 'google_review_url';

-- 2. Salesperson on feedback
ALTER TABLE public.customer_feedback
  ADD COLUMN IF NOT EXISTS salesperson_name text;

-- 3. Admin delete feedback
DROP POLICY IF EXISTS "Admins delete feedback" ON public.customer_feedback;
CREATE POLICY "Admins delete feedback" ON public.customer_feedback
  FOR DELETE USING (has_role(auth.uid(), 'admin'::app_role));

-- 4. Scheme banners table
CREATE TABLE IF NOT EXISTS public.scheme_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  image_url text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
ALTER TABLE public.scheme_banners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view active banners" ON public.scheme_banners;
CREATE POLICY "Public can view active banners" ON public.scheme_banners
  FOR SELECT USING (active = true OR has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "Admins manage banners" ON public.scheme_banners;
CREATE POLICY "Admins manage banners" ON public.scheme_banners
  FOR ALL USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE TRIGGER trg_scheme_banners_updated
  BEFORE UPDATE ON public.scheme_banners
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Storage bucket
INSERT INTO storage.buckets (id, name, public)
  VALUES ('scheme-banners','scheme-banners', true)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read scheme banners" ON storage.objects;
CREATE POLICY "Public read scheme banners" ON storage.objects
  FOR SELECT USING (bucket_id = 'scheme-banners');

DROP POLICY IF EXISTS "Admins upload scheme banners" ON storage.objects;
CREATE POLICY "Admins upload scheme banners" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'scheme-banners' AND has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "Admins update scheme banners" ON storage.objects;
CREATE POLICY "Admins update scheme banners" ON storage.objects
  FOR UPDATE USING (bucket_id = 'scheme-banners' AND has_role(auth.uid(),'admin'::app_role));

DROP POLICY IF EXISTS "Admins delete scheme banners" ON storage.objects;
CREATE POLICY "Admins delete scheme banners" ON storage.objects
  FOR DELETE USING (bucket_id = 'scheme-banners' AND has_role(auth.uid(),'admin'::app_role));

-- 6. Update trigger to include salesperson_name in lead notes
CREATE OR REPLACE FUNCTION public.handle_customer_feedback_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin uuid;
  v_existing public.leads%ROWTYPE;
  v_lead_id uuid;
  v_action text;
  v_owner uuid;
  v_sp text;
BEGIN
  NEW.needs_attention := NEW.overall_rating <= 2;
  NEW.qualified_for_review := NEW.overall_rating >= 4;
  v_sp := NULLIF(trim(COALESCE(NEW.salesperson_name,'')), '');

  SELECT * INTO v_existing
    FROM public.leads
   WHERE customer_phone = NEW.customer_phone
     AND deleted_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND THEN
    UPDATE public.leads
       SET visit_count = COALESCE(visit_count, 1) + 1,
           feedback_score = NEW.overall_rating,
           last_activity_date = now(),
           notes = COALESCE(notes, '') ||
             E'\n[' || to_char(now(), 'YYYY-MM-DD HH24:MI') || '] Kiosk feedback: '
             || NEW.overall_rating || '★ (staff ' || NEW.staff_rating || '★)'
             || COALESCE(' — salesperson: ' || v_sp, '')
             || COALESCE(' — ' || NEW.comments, ''),
           updated_at = now()
     WHERE id = v_existing.id;

    v_lead_id := v_existing.id;
    v_owner := COALESCE(v_existing.assigned_to, v_existing.created_by);
    v_action := 'updated_existing_lead';
    NEW.lead_id := v_lead_id;
    NEW.lead_created := false;

  ELSIF NEW.overall_rating >= 4 THEN
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
        'new'::lead_status, 'feedback_kiosk', 'walk_in',
        'Auto-created from kiosk feedback. Overall: ' || NEW.overall_rating
          || ', Staff: ' || NEW.staff_rating
          || COALESCE(E'\nSalesperson mentioned: ' || v_sp, '')
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
      'Rating ' || NEW.overall_rating || '★ / staff ' || NEW.staff_rating || '★'
        || COALESCE(' / SP: ' || v_sp, ''),
      v_owner
    );
  END IF;

  RETURN NEW;
END;
$function$;
