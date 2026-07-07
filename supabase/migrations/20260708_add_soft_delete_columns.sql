-- Add soft delete columns and audit triggers to sensitive tables

-- Helper function to add deleted_at column and trigger if not exists
DO $$
DECLARE
  v_table_name TEXT;
  v_tables TEXT[] := ARRAY[
    'leads',
    'service_jobs',
    'site_visits',
    'profiles',
    'elite_customers',
    'app_users',
    'card_points',
    'redemption_requests',
    'bills',
    'commissions'
  ];
BEGIN
  FOREACH v_table_name IN ARRAY v_tables
  LOOP
    -- Add deleted_at column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = v_table_name AND column_name = 'deleted_at'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL', v_table_name);
      RAISE NOTICE 'Added deleted_at column to %', v_table_name;
    END IF;
  END LOOP;
END $$;

-- Create audit triggers for sensitive tables
-- These will log all INSERT, UPDATE, DELETE operations

CREATE TRIGGER audit_leads AFTER INSERT OR UPDATE OR DELETE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER audit_soft_delete_leads AFTER UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.audit_soft_delete_fn();

CREATE TRIGGER audit_service_jobs AFTER INSERT OR UPDATE OR DELETE ON public.service_jobs
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER audit_soft_delete_service_jobs AFTER UPDATE ON public.service_jobs
  FOR EACH ROW EXECUTE FUNCTION public.audit_soft_delete_fn();

CREATE TRIGGER audit_site_visits AFTER INSERT OR UPDATE OR DELETE ON public.site_visits
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER audit_soft_delete_site_visits AFTER UPDATE ON public.site_visits
  FOR EACH ROW EXECUTE FUNCTION public.audit_soft_delete_fn();

CREATE TRIGGER audit_profiles AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER audit_soft_delete_profiles AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_soft_delete_fn();

CREATE TRIGGER audit_elite_customers AFTER INSERT OR UPDATE OR DELETE ON public.elite_customers
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER audit_soft_delete_elite_customers AFTER UPDATE ON public.elite_customers
  FOR EACH ROW EXECUTE FUNCTION public.audit_soft_delete_fn();

CREATE TRIGGER audit_app_users AFTER INSERT OR UPDATE OR DELETE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER audit_soft_delete_app_users AFTER UPDATE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.audit_soft_delete_fn();

CREATE TRIGGER audit_card_points AFTER INSERT OR UPDATE OR DELETE ON public.card_points
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER audit_soft_delete_card_points AFTER UPDATE ON public.card_points
  FOR EACH ROW EXECUTE FUNCTION public.audit_soft_delete_fn();

CREATE TRIGGER audit_redemption_requests AFTER INSERT OR UPDATE OR DELETE ON public.redemption_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER audit_soft_delete_redemption_requests AFTER UPDATE ON public.redemption_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_soft_delete_fn();

CREATE TRIGGER audit_bills AFTER INSERT OR UPDATE OR DELETE ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER audit_soft_delete_bills AFTER UPDATE ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.audit_soft_delete_fn();

CREATE TRIGGER audit_commissions AFTER INSERT OR UPDATE OR DELETE ON public.commissions
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER audit_soft_delete_commissions AFTER UPDATE ON public.commissions
  FOR EACH ROW EXECUTE FUNCTION public.audit_soft_delete_fn();

-- Update existing RLS policies to respect soft deletes
-- Pattern: staff users (non-admin) should not see deleted_at IS NOT NULL records

-- Example for leads table (apply similar pattern to all tables):
CREATE POLICY leads_hide_soft_deleted ON public.leads
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL OR (auth.jwt() ->> 'role') = 'admin');

-- Prevent staff from updating/deleting leads (only soft delete via normal updates)
-- This is enforced by existing RLS policies, but we clarify the soft-delete pattern

-- Create indexes on deleted_at for performance
CREATE INDEX IF NOT EXISTS idx_leads_deleted_at ON public.leads(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_jobs_deleted_at ON public.service_jobs(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_site_visits_deleted_at ON public.site_visits(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at ON public.profiles(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_elite_customers_deleted_at ON public.elite_customers(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_users_deleted_at ON public.app_users(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_card_points_deleted_at ON public.card_points(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_redemption_requests_deleted_at ON public.redemption_requests(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bills_deleted_at ON public.bills(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commissions_deleted_at ON public.commissions(deleted_at) WHERE deleted_at IS NOT NULL;
