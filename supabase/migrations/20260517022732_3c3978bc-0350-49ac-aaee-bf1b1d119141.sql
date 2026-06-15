
-- ============== FEATURE 1: LEAD ASSIGNMENT ==============
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS assignment_notes text;

CREATE TABLE IF NOT EXISTS public.lead_assignment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  from_user uuid,
  to_user uuid,
  assigned_by uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lah_lead ON public.lead_assignment_history(lead_id, created_at DESC);

ALTER TABLE public.lead_assignment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lah_admin_all ON public.lead_assignment_history;
CREATE POLICY lah_admin_all ON public.lead_assignment_history
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS lah_view_own ON public.lead_assignment_history;
CREATE POLICY lah_view_own ON public.lead_assignment_history
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = lead_assignment_history.lead_id
        AND (l.created_by = auth.uid() OR l.assigned_to = auth.uid())
    )
  );

DROP POLICY IF EXISTS lah_insert_auth ON public.lead_assignment_history;
CREATE POLICY lah_insert_auth ON public.lead_assignment_history
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = lead_assignment_history.lead_id
        AND (l.created_by = auth.uid() OR l.assigned_to = auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.track_lead_assignment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.assigned_to::text,'') IS DISTINCT FROM COALESCE(NEW.assigned_to::text,'') THEN
    NEW.assigned_at := now();
    INSERT INTO public.lead_assignment_history(lead_id, from_user, to_user, assigned_by, reason)
    VALUES (NEW.id, OLD.assigned_to, NEW.assigned_to, auth.uid(), NEW.assignment_notes);
  ELSIF TG_OP = 'INSERT' AND NEW.assigned_to IS NOT NULL THEN
    NEW.assigned_at := COALESCE(NEW.assigned_at, now());
    INSERT INTO public.lead_assignment_history(lead_id, from_user, to_user, assigned_by, reason)
    VALUES (NEW.id, NULL, NEW.assigned_to, auth.uid(), NEW.assignment_notes);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_track_lead_assignment ON public.leads;
CREATE TRIGGER trg_track_lead_assignment
BEFORE INSERT OR UPDATE OF assigned_to ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.track_lead_assignment_change();

-- ============== FEATURE 2: ATTENDANCE ==============
CREATE TABLE IF NOT EXISTS public.attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  date date NOT NULL,
  clock_in timestamptz,
  clock_out timestamptz,
  status text NOT NULL DEFAULT 'absent', -- on_time | late | absent
  minutes_late int NOT NULL DEFAULT 0,
  working_hours numeric(5,2),
  clock_in_lat numeric,
  clock_in_lng numeric,
  clock_out_lat numeric,
  clock_out_lng numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON public.attendance(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance(date DESC);

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS att_admin_accounts_all ON public.attendance;
CREATE POLICY att_admin_accounts_all ON public.attendance
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role));

DROP POLICY IF EXISTS att_user_select ON public.attendance;
CREATE POLICY att_user_select ON public.attendance
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS att_user_insert ON public.attendance;
CREATE POLICY att_user_insert ON public.attendance
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS att_user_update ON public.attendance;
CREATE POLICY att_user_update ON public.attendance
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.attendance_recalc()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  ci_ist timestamptz;
  cutoff timestamptz;
BEGIN
  NEW.updated_at := now();
  IF NEW.clock_in IS NULL THEN
    NEW.status := 'absent';
    NEW.minutes_late := 0;
    NEW.working_hours := NULL;
    RETURN NEW;
  END IF;

  -- Cutoff = 11:10 AM IST on NEW.date
  cutoff := (NEW.date::text || ' 11:10:00')::timestamp AT TIME ZONE 'Asia/Kolkata';

  IF NEW.clock_in <= cutoff THEN
    NEW.status := 'on_time';
    NEW.minutes_late := 0;
  ELSE
    NEW.status := 'late';
    NEW.minutes_late := GREATEST(0, EXTRACT(EPOCH FROM (NEW.clock_in - cutoff))/60)::int;
  END IF;

  IF NEW.clock_out IS NOT NULL THEN
    NEW.working_hours := ROUND( (EXTRACT(EPOCH FROM (NEW.clock_out - NEW.clock_in))/3600)::numeric, 2 );
  ELSE
    NEW.working_hours := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_recalc ON public.attendance;
CREATE TRIGGER trg_attendance_recalc
BEFORE INSERT OR UPDATE ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.attendance_recalc();

-- Clock in/out RPC
CREATE OR REPLACE FUNCTION public.attendance_clock(p_action text, p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL)
RETURNS public.attendance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_row public.attendance;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  IF p_action = 'in' THEN
    INSERT INTO public.attendance(user_id, date, clock_in, clock_in_lat, clock_in_lng)
    VALUES (v_user, v_today, now(), p_lat, p_lng)
    ON CONFLICT (user_id, date) DO UPDATE
      SET clock_in = COALESCE(public.attendance.clock_in, EXCLUDED.clock_in),
          clock_in_lat = COALESCE(public.attendance.clock_in_lat, EXCLUDED.clock_in_lat),
          clock_in_lng = COALESCE(public.attendance.clock_in_lng, EXCLUDED.clock_in_lng)
    RETURNING * INTO v_row;
  ELSIF p_action = 'out' THEN
    UPDATE public.attendance
       SET clock_out = now(),
           clock_out_lat = p_lat,
           clock_out_lng = p_lng
     WHERE user_id = v_user AND date = v_today
     RETURNING * INTO v_row;
    IF v_row IS NULL THEN RAISE EXCEPTION 'No clock-in found for today'; END IF;
  ELSE
    RAISE EXCEPTION 'invalid action';
  END IF;

  RETURN v_row;
END;
$$;

-- Today summary across all active employees
CREATE OR REPLACE FUNCTION public.attendance_today_summary()
RETURNS TABLE (
  user_id uuid,
  name text,
  email text,
  role app_role,
  status text,
  clock_in timestamptz,
  clock_out timestamptz,
  minutes_late int,
  working_hours numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d)
  SELECT
    p.id, p.name, p.email, ur.role,
    COALESCE(a.status, 'absent') AS status,
    a.clock_in, a.clock_out,
    COALESCE(a.minutes_late, 0) AS minutes_late,
    a.working_hours
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  LEFT JOIN public.attendance a ON a.user_id = p.id AND a.date = (SELECT d FROM today)
  WHERE COALESCE(p.active, true) = true
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role));
$$;

-- Monthly report (admin/accounts -> all; others -> self)
CREATE OR REPLACE FUNCTION public.attendance_monthly_report(p_month text)
RETURNS TABLE (
  user_id uuid,
  name text,
  email text,
  role app_role,
  date date,
  status text,
  clock_in timestamptz,
  clock_out timestamptz,
  minutes_late int,
  working_hours numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start date := (p_month || '-01')::date;
  v_end   date := (v_start + INTERVAL '1 month')::date;
  v_is_priv boolean := has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'accounts'::app_role);
BEGIN
  RETURN QUERY
  SELECT p.id, p.name, p.email, ur.role,
         a.date, a.status, a.clock_in, a.clock_out, a.minutes_late, a.working_hours
  FROM public.attendance a
  JOIN public.profiles p ON p.id = a.user_id
  JOIN public.user_roles ur ON ur.user_id = a.user_id
  WHERE a.date >= v_start AND a.date < v_end
    AND (v_is_priv OR a.user_id = auth.uid())
  ORDER BY a.date DESC, p.name;
END;
$$;
