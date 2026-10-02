REVOKE EXECUTE ON FUNCTION public.record_google_review(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_google_review(uuid, text) TO service_role;