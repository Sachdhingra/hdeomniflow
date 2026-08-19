-- The Firecrawl API key must never be stored in the database or in version
-- control. It is read exclusively from the FIRECRAWL_API_KEY edge function
-- secret. Purge any previously stored value.
DELETE FROM app_settings WHERE key = 'FIRECRAWL_API_KEY';
