-- ADD TABLE errors on a table already in the publication, which fails the
-- whole migration on a re-run. Only add the ones that aren't members yet.
DO $realtime$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leads', 'service_jobs', 'site_visits', 'notifications'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END
$realtime$;