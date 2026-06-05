
DROP POLICY IF EXISTS view_active_products ON public.products;
DROP POLICY IF EXISTS view_active_categories ON public.categories;

CREATE POLICY view_active_products ON public.products
FOR SELECT TO authenticated
USING (
  status = 'active' AND deleted_at IS NULL AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'sales'::app_role)
    OR has_role(auth.uid(), 'site_agent'::app_role)
    OR has_role(auth.uid(), 'service_head'::app_role)
    OR has_role(auth.uid(), 'accounts'::app_role)
  )
);

CREATE POLICY view_active_categories ON public.categories
FOR SELECT TO authenticated
USING (
  is_active = true AND deleted_at IS NULL AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'sales'::app_role)
    OR has_role(auth.uid(), 'site_agent'::app_role)
    OR has_role(auth.uid(), 'service_head'::app_role)
    OR has_role(auth.uid(), 'accounts'::app_role)
  )
);
