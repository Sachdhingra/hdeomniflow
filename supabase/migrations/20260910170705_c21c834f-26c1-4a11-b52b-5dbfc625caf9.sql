
REVOKE ALL ON FUNCTION public.fn_award_welcome_points(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_award_welcome_points(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_welcome_points_on_activation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_guard_redemption_eligibility() FROM PUBLIC, anon, authenticated;
