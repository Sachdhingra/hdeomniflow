-- Relax inventory_audit_log to support both inventory systems and richer entries
ALTER TABLE public.inventory_audit_log
  DROP CONSTRAINT IF EXISTS inventory_audit_log_product_id_fkey;

ALTER TABLE public.inventory_audit_log
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS location_id UUID;

-- Allow admins to also UPDATE/DELETE if ever needed (safe; UI is admin-only)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='inv_audit_admin_all' AND tablename='inventory_audit_log') THEN
    CREATE POLICY "inv_audit_admin_all" ON public.inventory_audit_log
      FOR ALL TO authenticated
      USING (has_role(auth.uid(),'admin'::app_role))
      WITH CHECK (has_role(auth.uid(),'admin'::app_role));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inv_audit_created_at ON public.inventory_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_audit_action ON public.inventory_audit_log(action);