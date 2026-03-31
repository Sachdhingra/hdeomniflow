
-- Update user_roles SELECT policy to allow service_head to see all roles (needed to resolve agent names)
DROP POLICY IF EXISTS "Users can view own role or admin sees all" ON public.user_roles;

CREATE POLICY "Users can view own role or admin/service_head sees all"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  (user_id = auth.uid())
  OR has_role(auth.uid(), 'admin')
  OR has_role(auth.uid(), 'service_head')
);
