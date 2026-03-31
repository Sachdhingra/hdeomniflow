
-- Update profiles SELECT policy to allow service_head to see all profiles (needed for agent assignment dropdown)
DROP POLICY IF EXISTS "Users can view own profile or admin sees all" ON public.profiles;

CREATE POLICY "Users can view own profile or admin/service_head sees all"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  (auth.uid() = id)
  OR has_role(auth.uid(), 'admin')
  OR has_role(auth.uid(), 'service_head')
);
