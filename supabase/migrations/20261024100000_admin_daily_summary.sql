-- Admin end-of-day summary: a short report (what was done, plan for tomorrow, who
-- needs attention) generated at 8:05 pm IST by the daily-admin-summary edge function
-- and shown to admins as a pop-up. One row per day; the report itself is JSON.

CREATE TABLE IF NOT EXISTS public.admin_daily_summaries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_date date NOT NULL UNIQUE,
  generated_at timestamptz NOT NULL DEFAULT now(),
  headline     text NOT NULL,
  report       jsonb NOT NULL,
  source       text NOT NULL DEFAULT 'cron'
);

ALTER TABLE public.admin_daily_summaries ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.admin_daily_summaries TO authenticated;
GRANT ALL ON public.admin_daily_summaries TO service_role;

DROP POLICY IF EXISTS admin_daily_summaries_admin_select ON public.admin_daily_summaries;
CREATE POLICY admin_daily_summaries_admin_select ON public.admin_daily_summaries
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Which admin has already dismissed which day's pop-up.
CREATE TABLE IF NOT EXISTS public.admin_summary_views (
  summary_id uuid NOT NULL REFERENCES public.admin_daily_summaries(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  seen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (summary_id, user_id)
);

ALTER TABLE public.admin_summary_views ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.admin_summary_views TO authenticated;
GRANT ALL ON public.admin_summary_views TO service_role;

DROP POLICY IF EXISTS admin_summary_views_own_select ON public.admin_summary_views;
CREATE POLICY admin_summary_views_own_select ON public.admin_summary_views
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS admin_summary_views_own_insert ON public.admin_summary_views;
CREATE POLICY admin_summary_views_own_insert ON public.admin_summary_views
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.has_role(auth.uid(), 'admin'::app_role));

DO $do$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_daily_summaries;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'realtime publication skipped: %', SQLERRM;
END;
$do$;

-- Dispatch helper, same pattern as _invoke_staff_agent_tick.
CREATE OR REPLACE FUNCTION public._invoke_daily_admin_summary()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $fn$
DECLARE
  v_url        text;
  v_secret     text;
  v_request_id bigint;
BEGIN
  v_url := current_setting('app.supabase_functions_url', true);
  IF COALESCE(v_url, '') = '' THEN
    v_url := 'https://cdrgbhnntonyofqkhzpm.supabase.co/functions/v1';
  END IF;

  v_secret := current_setting('app.loyalty_cron_secret', true);
  IF COALESCE(v_secret, '') = '' THEN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'LOYALTY_CRON_SECRET'
    LIMIT 1;
  END IF;

  IF COALESCE(v_secret, '') = '' THEN
    RAISE WARNING 'daily-admin-summary not dispatched: LOYALTY_CRON_SECRET is set in neither app.loyalty_cron_secret nor vault';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url     := v_url || '/daily-admin-summary',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-internal-secret', v_secret
    ),
    body    := '{"source":"cron","notify":true}'::jsonb
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public._invoke_daily_admin_summary() FROM PUBLIC, anon, authenticated;

-- 20:05 IST = 14:35 UTC.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-admin-summary-2005-ist') THEN
    PERFORM cron.unschedule('daily-admin-summary-2005-ist');
  END IF;

  PERFORM cron.schedule(
    'daily-admin-summary-2005-ist',
    '35 14 * * *',
    $cron$ SELECT public._invoke_daily_admin_summary(); $cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END;
$do$;
