CREATE OR REPLACE FUNCTION public.check_customer_dues(p_customer_phone text)
 RETURNS TABLE(has_dues boolean, total_pending numeric, due_count integer, dues_list jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (
       public.has_role(auth.uid(),'admin'::app_role)
       OR public.has_role(auth.uid(),'accounts'::app_role)
       OR public.has_role(auth.uid(),'service_head'::app_role)
     ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    EXISTS (SELECT 1 FROM public.customer_dues WHERE customer_phone = p_customer_phone AND is_cleared = false),
    COALESCE(SUM(amount) FILTER (WHERE is_cleared = false), 0),
    COUNT(*) FILTER (WHERE is_cleared = false)::int,
    COALESCE(
      jsonb_agg(jsonb_build_object(
        'id', id, 'amount', amount, 'type', due_type,
        'description', description, 'created_at', created_at
      )) FILTER (WHERE is_cleared = false),
      '[]'::jsonb
    )
  FROM public.customer_dues
  WHERE customer_phone = p_customer_phone;
END;
$function$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_chat_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_chat_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_loyalty_customer_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_loyalty_app_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_loyalty_app_user(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_directory() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_dm_channel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_default_chat_channels(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lead_owners_for_jobs(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_approvals_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_hde_order_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_clock(text, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_today_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_monthly_report(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_monthly_user_summary(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_conversion_probability(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_score_breakdown(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detect_journey_stage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_customer_dues(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_set_anniversary_date(date) TO authenticated;

ALTER VIEW public.daily_feedback_stats SET (security_invoker = true);
ALTER VIEW public.monthly_sales_leaderboard SET (security_invoker = true);

DROP POLICY IF EXISTS "Authenticated can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile or admin/service_head sees all" ON public.profiles;
CREATE POLICY "profiles_select_self_or_management"
ON public.profiles FOR SELECT TO authenticated
USING (
  auth.uid() = id
  OR public.has_role(auth.uid(),'admin'::app_role)
  OR public.has_role(auth.uid(),'service_head'::app_role)
  OR public.has_role(auth.uid(),'sales'::app_role)
  OR public.has_role(auth.uid(),'accounts'::app_role)
);

DROP POLICY IF EXISTS "staff_profiles_select_all_auth" ON public.staff_profiles;
CREATE POLICY "staff_profiles_select_self_or_management"
ON public.staff_profiles FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(),'admin'::app_role)
  OR public.has_role(auth.uid(),'service_head'::app_role)
);

DROP POLICY IF EXISTS "elite_select_auth" ON public.elite_customers;
DROP POLICY IF EXISTS "elite_update_auth" ON public.elite_customers;
DROP POLICY IF EXISTS "elite_insert_auth" ON public.elite_customers;

CREATE POLICY "elite_select_staff"
ON public.elite_customers FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'admin'::app_role)
  OR public.has_role(auth.uid(),'sales'::app_role)
  OR public.has_role(auth.uid(),'accounts'::app_role)
  OR public.has_role(auth.uid(),'service_head'::app_role)
);

CREATE POLICY "elite_insert_staff"
ON public.elite_customers FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(),'admin'::app_role)
  OR public.has_role(auth.uid(),'sales'::app_role)
  OR public.has_role(auth.uid(),'accounts'::app_role)
);

CREATE POLICY "elite_update_staff"
ON public.elite_customers FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(),'admin'::app_role)
  OR public.has_role(auth.uid(),'sales'::app_role)
  OR public.has_role(auth.uid(),'accounts'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(),'admin'::app_role)
  OR public.has_role(auth.uid(),'sales'::app_role)
  OR public.has_role(auth.uid(),'accounts'::app_role)
);

DROP POLICY IF EXISTS "Public read access for field-agent-photos" ON storage.objects;
DROP POLICY IF EXISTS "Field agent photos public read" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read field agent photos" ON storage.objects;
CREATE POLICY "Authenticated read field agent photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'field-agent-photos');

DELETE FROM public.app_settings WHERE key = 'FIRECRAWL_API_KEY';