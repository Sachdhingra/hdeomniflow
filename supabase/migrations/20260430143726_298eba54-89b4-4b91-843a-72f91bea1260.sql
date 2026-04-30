-- Re-schedule using vault to securely fetch DAILY_REPORT_SECRET
DO $$
DECLARE jid INT;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'daily-excel-report-8pm-ist';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;

-- Helper function: invoke the daily report function (SECURITY DEFINER so it can read vault)
CREATE OR REPLACE FUNCTION public._invoke_daily_excel_report()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $fn$
DECLARE
  v_secret text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'DAILY_REPORT_SECRET'
  LIMIT 1;

  SELECT net.http_post(
    url := 'https://cdrgbhnntonyofqkhzpm.supabase.co/functions/v1/daily-excel-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', COALESCE(v_secret, '')
    ),
    body := '{}'::jsonb
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public._invoke_daily_excel_report() FROM PUBLIC, anon, authenticated;

-- Schedule for 14:30 UTC = 20:00 IST every day
SELECT cron.schedule(
  'daily-excel-report-8pm-ist',
  '30 14 * * *',
  $$ SELECT public._invoke_daily_excel_report(); $$
);