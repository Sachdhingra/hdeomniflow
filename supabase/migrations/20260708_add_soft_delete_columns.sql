-- Add soft delete columns, audit triggers, and soft-delete visibility
-- policies to sensitive tables.
--
-- Notes:
-- - Table list matches the actual schema (card_bill_entries /
--   card_commissions — there are no bills/commissions tables).
-- - Skips tables that don't exist so the migration never aborts partway.
-- - Visibility policies are RESTRICTIVE: they AND with existing permissive
--   policies to hide soft-deleted rows from non-admins, instead of ORing
--   and accidentally widening read access.
-- - Idempotent: safe to re-run.

DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'leads',
    'service_jobs',
    'site_visits',
    'profiles',
    'elite_customers',
    'app_users',
    'card_points',
    'redemption_requests',
    'card_bill_entries',
    'card_commissions'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE NOTICE 'Skipping % (table does not exist)', v_table;
      CONTINUE;
    END IF;

    -- deleted_at column (soft-delete marker)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_table
        AND column_name = 'deleted_at'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL', v_table);
      RAISE NOTICE 'Added deleted_at column to %', v_table;
    END IF;

    -- Audit triggers: every INSERT/UPDATE/DELETE is logged
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON public.%I', v_table, v_table);
    EXECUTE format(
      'CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn()',
      v_table, v_table);

    -- Soft-delete trigger: logs the SOFT_DELETE transition specifically
    EXECUTE format('DROP TRIGGER IF EXISTS audit_soft_delete_%I ON public.%I', v_table, v_table);
    EXECUTE format(
      'CREATE TRIGGER audit_soft_delete_%I AFTER UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.audit_soft_delete_fn()',
      v_table, v_table);

    -- RESTRICTIVE visibility policy: non-admins never see soft-deleted rows
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                   v_table || '_hide_soft_deleted', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated
       USING (deleted_at IS NULL OR public.has_role(auth.uid(), ''admin''))',
      v_table || '_hide_soft_deleted', v_table);

    -- Partial index for admin recovery queries
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%I_deleted_at ON public.%I(deleted_at) WHERE deleted_at IS NOT NULL',
      v_table, v_table);
  END LOOP;
END $$;
