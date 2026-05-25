
-- 1) Add 'kiosk' to lead_category enum
ALTER TYPE public.lead_category ADD VALUE IF NOT EXISTS 'kiosk';

-- 2) Rewrite kiosk feedback trigger: route to selected salesperson; use 'kiosk' category
CREATE OR REPLACE FUNCTION public.handle_customer_feedback_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin uuid;
  v_sp_user uuid;
  v_owner uuid;
  v_existing public.leads%ROWTYPE;
  v_lead_id uuid;
  v_action text;
  v_sp text;
BEGIN
  NEW.needs_attention := NEW.overall_rating <= 2;
  NEW.qualified_for_review := NEW.overall_rating >= 4;
  v_sp := NULLIF(trim(COALESCE(NEW.salesperson_name,'')), '');

  -- Lookup salesperson user_id by name (case insensitive)
  IF v_sp IS NOT NULL THEN
    SELECT id INTO v_sp_user
      FROM public.profiles
     WHERE lower(name) = lower(v_sp)
     LIMIT 1;
  END IF;

  SELECT user_id INTO v_admin
    FROM public.user_roles
   WHERE role = 'admin'::app_role
   LIMIT 1;

  v_owner := COALESCE(v_sp_user, v_admin);

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
           assigned_to = COALESCE(v_sp_user, assigned_to),
           assignment_notes = CASE
             WHEN v_sp_user IS NOT NULL AND v_sp_user IS DISTINCT FROM assigned_to
               THEN 'Auto-assigned from kiosk feedback: ' || v_sp
             ELSE assignment_notes
           END,
           notes = COALESCE(notes,'') ||
             E'\n[' || to_char(now(),'YYYY-MM-DD HH24:MI') || '] Kiosk feedback: '
             || NEW.overall_rating || '★ (staff ' || NEW.staff_rating || '★)'
             || COALESCE(' — salesperson: ' || v_sp, '')
             || COALESCE(' — ' || NEW.comments, ''),
           updated_at = now()
     WHERE id = v_existing.id;

    v_lead_id := v_existing.id;
    v_action := 'updated_existing_lead';
    NEW.lead_id := v_lead_id;
    NEW.lead_created := false;

  ELSIF NEW.overall_rating >= 4 AND v_owner IS NOT NULL THEN
    INSERT INTO public.leads (
      customer_name, customer_phone, category, value_in_rupees,
      status, source, source_type, notes, created_by, updated_by,
      assigned_to, assignment_notes,
      visit_count, feedback_score, last_activity_date
    )
    VALUES (
      NEW.customer_name, NEW.customer_phone, 'kiosk'::lead_category, 0,
      'new'::lead_status, 'feedback_kiosk', 'walk_in',
      'Auto-created from kiosk feedback. Overall: ' || NEW.overall_rating
        || ', Staff: ' || NEW.staff_rating
        || COALESCE(E'\nSalesperson: ' || v_sp, '')
        || COALESCE(E'\nComments: ' || NEW.comments, ''),
      v_owner, v_owner,
      v_owner,
      COALESCE('Auto-assigned to ' || v_sp, 'Auto-assigned (admin fallback)'),
      1, NEW.overall_rating, now()
    )
    RETURNING id INTO v_lead_id;

    v_action := 'created_new_lead';
    NEW.lead_id := v_lead_id;
    NEW.lead_created := true;
  END IF;

  IF v_lead_id IS NOT NULL THEN
    INSERT INTO public.lead_deduplication_log (
      lead_id, customer_phone, action, source, feedback_id,
      visit_count, last_visit_date, notes, created_by
    ) VALUES (
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

-- 3) Auto clock-out function: stamp clock_out = today 20:05 IST for anyone still clocked-in
CREATE OR REPLACE FUNCTION public.attendance_auto_clockout()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_cutoff timestamptz := (v_today::text || ' 20:05:00')::timestamp AT TIME ZONE 'Asia/Kolkata';
  v_count int;
BEGIN
  UPDATE public.attendance
     SET clock_out = v_cutoff
   WHERE date = v_today
     AND clock_in IS NOT NULL
     AND clock_out IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Schedule via pg_cron at 14:35 UTC = 20:05 IST
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='attendance-auto-clockout';
    PERFORM cron.schedule(
      'attendance-auto-clockout',
      '35 14 * * *',
      $cron$ SELECT public.attendance_auto_clockout(); $cron$
    );
  END IF;
END $$;

-- 4) Per-user monthly summary (days present / on_time / late / absent)
CREATE OR REPLACE FUNCTION public.attendance_monthly_user_summary(p_month text, p_user_id uuid DEFAULT NULL)
RETURNS TABLE(
  user_id uuid,
  name text,
  email text,
  role app_role,
  days_present int,
  days_on_time int,
  days_late int,
  days_absent int,
  working_days int
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_start date := (p_month || '-01')::date;
  v_end   date := (v_start + INTERVAL '1 month')::date;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_eff_end date := LEAST(v_end - 1, v_today);
  v_is_priv boolean := has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role);
  v_uid uuid := COALESCE(p_user_id, auth.uid());
  v_working int;
BEGIN
  -- Working days = all days from v_start .. v_eff_end excluding Sundays (DOW=0)
  SELECT COUNT(*)::int INTO v_working
    FROM generate_series(v_start, v_eff_end, '1 day') d
   WHERE EXTRACT(DOW FROM d) <> 0;

  IF v_is_priv AND p_user_id IS NULL THEN
    RETURN QUERY
    SELECT p.id, p.name, p.email, ur.role,
           COUNT(*) FILTER (WHERE a.clock_in IS NOT NULL)::int AS days_present,
           COUNT(*) FILTER (WHERE a.status = 'on_time')::int AS days_on_time,
           COUNT(*) FILTER (WHERE a.status = 'late')::int AS days_late,
           GREATEST(0, v_working - COUNT(*) FILTER (WHERE a.clock_in IS NOT NULL)::int) AS days_absent,
           v_working AS working_days
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    LEFT JOIN public.attendance a
      ON a.user_id = p.id AND a.date >= v_start AND a.date < v_end
    WHERE COALESCE(p.active,true) = true
    GROUP BY p.id, p.name, p.email, ur.role
    ORDER BY p.name;
  ELSE
    RETURN QUERY
    SELECT p.id, p.name, p.email, ur.role,
           COUNT(*) FILTER (WHERE a.clock_in IS NOT NULL)::int,
           COUNT(*) FILTER (WHERE a.status = 'on_time')::int,
           COUNT(*) FILTER (WHERE a.status = 'late')::int,
           GREATEST(0, v_working - COUNT(*) FILTER (WHERE a.clock_in IS NOT NULL)::int),
           v_working
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    LEFT JOIN public.attendance a
      ON a.user_id = p.id AND a.date >= v_start AND a.date < v_end
    WHERE p.id = v_uid
    GROUP BY p.id, p.name, p.email, ur.role;
  END IF;
END;
$$;

-- 5) Realtime for scheme banners
ALTER TABLE public.scheme_banners REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.scheme_banners;
