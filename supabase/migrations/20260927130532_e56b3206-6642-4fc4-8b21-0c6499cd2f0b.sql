DO $$
DECLARE
  existing_job RECORD;
BEGIN
  FOR existing_job IN
    SELECT jobid FROM cron.job WHERE jobname IN ('nurture-engine-6pm-ist', 'nurture-engine-8pm-ist')
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'nurture-engine-6pm-ist',
  '30 12 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://cdrgbhnntonyofqkhzpm.supabase.co/functions/v1/nurture-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', COALESCE((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'NURTURE_ENGINE_SECRET' LIMIT 1), '')
    ),
    body := '{}'::jsonb
  );
  $job$
);

SELECT cron.schedule(
  'nurture-engine-8pm-ist',
  '30 14 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://cdrgbhnntonyofqkhzpm.supabase.co/functions/v1/nurture-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', COALESCE((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'NURTURE_ENGINE_SECRET' LIMIT 1), '')
    ),
    body := '{}'::jsonb
  );
  $job$
);