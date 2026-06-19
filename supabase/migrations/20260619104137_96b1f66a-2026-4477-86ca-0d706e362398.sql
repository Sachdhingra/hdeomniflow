
-- 1) Allow all authenticated users to view basic profile info (name lookups for timelines, leaderboards, accounts page)
DROP POLICY IF EXISTS "Authenticated can view profiles" ON public.profiles;
CREATE POLICY "Authenticated can view profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

-- 2) Recreate leaderboard view with security_invoker = off so review/feedback aggregates
--    aren't suppressed by customer_feedback RLS for non-admin viewers.
ALTER VIEW IF EXISTS public.monthly_sales_leaderboard SET (security_invoker = off);
