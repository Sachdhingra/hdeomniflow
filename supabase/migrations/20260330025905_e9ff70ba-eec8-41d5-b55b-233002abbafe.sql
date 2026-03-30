
-- Fix 1: Restrict profiles SELECT to own profile + admin
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
CREATE POLICY "Users can view own profile or admin sees all"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR has_role(auth.uid(), 'admin'::app_role));

-- Fix 2: Restrict user_roles SELECT to own role + admin
DROP POLICY IF EXISTS "Users can view all roles" ON public.user_roles;
CREATE POLICY "Users can view own role or admin sees all"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
