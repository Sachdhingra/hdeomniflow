CREATE POLICY "Staff view own feedback"
ON public.customer_feedback
FOR SELECT
TO authenticated
USING (
  salesperson_name IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(p.name) = lower(btrim(customer_feedback.salesperson_name))
  )
);