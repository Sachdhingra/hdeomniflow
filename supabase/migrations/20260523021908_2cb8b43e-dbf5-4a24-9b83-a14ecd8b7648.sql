CREATE OR REPLACE FUNCTION public.handle_customer_feedback_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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