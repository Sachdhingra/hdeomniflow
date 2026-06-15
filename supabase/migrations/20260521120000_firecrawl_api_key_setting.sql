-- Store Firecrawl API key in app_settings so edge functions can fall back
-- to the database when the FIRECRAWL_API_KEY env var is not yet wired up.
INSERT INTO app_settings (key, value, updated_at, updated_by)
VALUES (
  'FIRECRAWL_API_KEY',
  'fc-eee68390fb484761a3f168bea5b24c2c',
  now(),
  (SELECT id FROM auth.users WHERE is_super_admin = true LIMIT 1)
)
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = now();
