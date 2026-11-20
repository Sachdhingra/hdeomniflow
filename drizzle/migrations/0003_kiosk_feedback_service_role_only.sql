-- Kiosk feedback submission now follows the same shape as kiosk review
-- confirmation (20261002105630 + the record-kiosk-review function): the
-- signed-out kiosk calls a validating edge function, and the elevated database
-- action is service-role-only.
--
-- 20261120090000 fixed the submission failure by making submit_kiosk_feedback
-- SECURITY DEFINER again, but left EXECUTE granted to anon — an elevated write
-- reachable straight from the browser with the publishable key. The submit-
-- kiosk-feedback edge function now validates the payload and calls this with
-- the service role, so anon has no route to it.

REVOKE EXECUTE ON FUNCTION public.submit_kiosk_feedback(text, text, smallint, smallint, text, text)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_kiosk_feedback(text, text, smallint, smallint, text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
