ALTER FUNCTION public.submit_kiosk_feedback(text, text, smallint, smallint, text, text) SECURITY INVOKER;
GRANT INSERT ON public.customer_feedback TO anon, authenticated;
GRANT SELECT (id) ON public.customer_feedback TO anon, authenticated;
NOTIFY pgrst, 'reload schema';