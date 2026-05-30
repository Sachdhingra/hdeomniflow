CREATE POLICY elite_delete_owner ON public.elite_customers
FOR DELETE TO authenticated
USING (
  lead_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = elite_customers.lead_id
      AND (l.created_by = auth.uid() OR l.assigned_to = auth.uid())
  )
);