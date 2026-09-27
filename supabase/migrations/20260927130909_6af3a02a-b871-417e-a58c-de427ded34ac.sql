DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'NURTURE_ENGINE_SECRET') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'NURTURE_ENGINE_SECRET',
      'Authorizes scheduled lead outreach'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.verify_nurture_engine_secret(candidate text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, vault
AS $$
  SELECT candidate IS NOT NULL
    AND candidate <> ''
    AND EXISTS (
      SELECT 1
      FROM vault.decrypted_secrets
      WHERE name = 'NURTURE_ENGINE_SECRET'
        AND decrypted_secret = candidate
    );
$$;

REVOKE ALL ON FUNCTION public.verify_nurture_engine_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_nurture_engine_secret(text) TO service_role;