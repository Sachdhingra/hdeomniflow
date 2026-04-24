-- Add source tracking columns
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'sales';

DO $$ BEGIN
  ALTER TABLE public.leads ADD CONSTRAINT leads_source_type_check 
    CHECK (source_type IN ('sales', 'field_agent', 'site_agent', 'walk_in', 'referral'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS created_from_location text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS created_from_lat numeric;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS created_from_lng numeric;

-- Daily lead limit function for field agents
CREATE OR REPLACE FUNCTION public.check_field_agent_daily_lead_limit()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today_count int;
  v_role app_role;
BEGIN
  SELECT role INTO v_role FROM public.user_roles
  WHERE user_id = NEW.created_by LIMIT 1;

  IF v_role = 'field_agent' THEN
    SELECT COUNT(*) INTO today_count
    FROM public.leads
    WHERE created_by = NEW.created_by
      AND DATE(created_at) = CURRENT_DATE
      AND deleted_at IS NULL;

    IF today_count >= 2 THEN
      RAISE EXCEPTION 'Daily lead limit reached. Field agents can add maximum 2 leads per day.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_field_agent_lead_limit ON public.leads;
CREATE TRIGGER enforce_field_agent_lead_limit
BEFORE INSERT ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.check_field_agent_daily_lead_limit();

-- Allow field agents and site agents to create leads
DROP POLICY IF EXISTS "field_agent_create_leads" ON public.leads;
CREATE POLICY "field_agent_create_leads" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'sales'::app_role)
      OR has_role(auth.uid(), 'field_agent'::app_role)
      OR has_role(auth.uid(), 'site_agent'::app_role)
    )
  );

-- Field agents can view leads they created
DROP POLICY IF EXISTS "field_agent_view_own_leads" ON public.leads;
CREATE POLICY "field_agent_view_own_leads" ON public.leads
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (created_by = auth.uid() OR assigned_to = auth.uid()
         OR has_role(auth.uid(), 'admin'::app_role))
  );