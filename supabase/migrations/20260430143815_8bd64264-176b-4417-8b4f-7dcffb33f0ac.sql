-- Ensure a vault secret exists for the daily report
DO $$
DECLARE
  v_existing uuid;
BEGIN
  SELECT id INTO v_existing FROM vault.secrets WHERE name = 'DAILY_REPORT_SECRET' LIMIT 1;
  IF v_existing IS NULL THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'DAILY_REPORT_SECRET', 'Internal token for daily Excel report cron');
  END IF;
END $$;

-- Verification RPC the edge function will call to check the cron token
CREATE OR REPLACE FUNCTION public.verify_daily_report_secret(_token text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $fn$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'DAILY_REPORT_SECRET'
  LIMIT 1;
  RETURN v_secret IS NOT NULL AND _token = v_secret;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.verify_daily_report_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_daily_report_secret(text) TO service_role;