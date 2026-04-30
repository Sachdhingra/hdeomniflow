CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any prior schedule
DO $$
DECLARE jid INT;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'daily-excel-report-8pm-ist';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;

-- 8 PM IST = 14:30 UTC
SELECT cron.schedule(
  'daily-excel-report-8pm-ist',
  '30 14 * * *',
  $$
  SELECT net.http_post(
    url := 'https://cdrgbhnntonyofqkhzpm.supabase.co/functions/v1/daily-excel-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', current_setting('app.daily_report_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);