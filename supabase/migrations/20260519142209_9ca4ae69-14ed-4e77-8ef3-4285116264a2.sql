SELECT net.http_post(
  url := 'https://cdrgbhnntonyofqkhzpm.supabase.co/functions/v1/daily-performance-summary',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-internal-secret', COALESCE((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'DAILY_REPORT_SECRET' LIMIT 1), '')
  ),
  body := '{}'::jsonb
);