
-- Fix notifications INSERT policy: restrict sales users to only create notifications for themselves
-- Admin and service_head can create notifications for any user (needed for system notifications)
DROP POLICY IF EXISTS "Authenticated can create notifications" ON public.notifications;

CREATE POLICY "Authenticated can create notifications"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'service_head'::app_role)
  OR (user_id = auth.uid())
);
