
-- Fix overly permissive notification insert policy
DROP POLICY "Authenticated can create notifications" ON public.notifications;
CREATE POLICY "Authenticated can create notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'service_head') OR
    public.has_role(auth.uid(), 'sales') OR
    user_id = auth.uid()
  );
