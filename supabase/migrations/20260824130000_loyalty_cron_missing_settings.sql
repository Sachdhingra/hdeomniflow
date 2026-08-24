-- Stop the loyalty cron erroring when its settings are unset
--
-- 20260625030000_loyalty_cron_schema.sql scheduled loyalty-daily-cron with:
--
--   url     := current_setting('app.supabase_functions_url') || '/loyalty-cron'
--   headers := ... current_setting('app.loyalty_cron_secret') ...
--
-- Neither call passes the missing_ok argument, so an unset setting raises
-- 'unrecognized configuration parameter' rather than returning NULL. Both
-- settings are in fact unset on this project, so the job has been failing at
-- that line every night — points expiry, redemption, card expiry, birthday and
-- anniversary messages have not been going out, and the failure is only
-- visible in cron.job_run_details.
--
-- Editing the original migration would not fix it: cron.schedule stored the
-- command text in cron.job when it first ran, so the live job keeps the old
-- body until it is re-scheduled. This migration re-schedules it against a
-- helper that reads both settings safely, falls back the way the rest of the
-- project does, and warns instead of erroring when the secret is genuinely
-- missing.
--
-- Mirrors _invoke_daily_excel_report and _invoke_staff_push.

CREATE OR REPLACE FUNCTION public._invoke_loyalty_cron()
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
  -- Functions URL: the setting, else this project's own endpoint. Hardcoding
  -- the fallback matches _invoke_daily_excel_report and _invoke_staff_push.
  v_url := current_setting('app.supabase_functions_url', true);
  IF COALESCE(v_url, '') = '' THEN
    v_url := 'https://cdrgbhnntonyofqkhzpm.supabase.co/functions/v1';
  END IF;

  -- Secret: the database setting, else vault. Checking both means setting it
  -- in either place fixes the loyalty cron and staff push together, rather
  -- than one silently staying broken.
  v_secret := current_setting('app.loyalty_cron_secret', true);
  IF COALESCE(v_secret, '') = '' THEN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'LOYALTY_CRON_SECRET'
    LIMIT 1;
  END IF;

  -- loyalty-cron rejects an empty secret with 401, so there is nothing to be
  -- gained by calling. Warn and leave a clean row in cron.job_run_details.
  IF COALESCE(v_secret, '') = '' THEN
    RAISE WARNING 'loyalty-cron not dispatched: LOYALTY_CRON_SECRET is set in neither app.loyalty_cron_secret nor vault';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url     := v_url || '/loyalty-cron',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-internal-secret', v_secret
    ),
    body    := '{}'::jsonb
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public._invoke_loyalty_cron() FROM PUBLIC, anon, authenticated;

-- Re-schedule against the helper. Same slot as before: 02:30 UTC = 08:00 IST.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'loyalty-daily-cron') THEN
    PERFORM cron.unschedule('loyalty-daily-cron');
  END IF;

  PERFORM cron.schedule(
    'loyalty-daily-cron',
    '30 2 * * *',
    $$ SELECT public._invoke_loyalty_cron(); $$
  );
EXCEPTION WHEN OTHERS THEN
  -- pg_cron / pg_net may not be available in local dev; skip silently.
  RAISE NOTICE 'pg_cron reschedule skipped: %', SQLERRM;
END;
$$;
