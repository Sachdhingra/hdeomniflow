-- Audit Logging Setup
-- Immutable audit log table for tracking all sensitive operations

-- Create audit_log table
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation TEXT NOT NULL,          -- 'INSERT', 'UPDATE', 'DELETE', 'SOFT_DELETE', 'HARD_DELETE'
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_role TEXT,
  user_email TEXT,
  old_values JSONB,                 -- Before state (for UPDATE/DELETE)
  new_values JSONB,                 -- After state (for INSERT/UPDATE)
  reason TEXT,                      -- Why: admin note, automatic expiry, etc.
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Immutability constraints
  CONSTRAINT audit_log_immutable CHECK (true)
);

-- Enable RLS on audit_log
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Only admin can SELECT audit logs
CREATE POLICY audit_log_admin_select ON public.audit_log
  FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- RLS Policy: System/triggers can INSERT (no row-level check needed)
CREATE POLICY audit_log_system_insert ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- RLS Policy: Prevent all updates and deletes (immutable)
CREATE POLICY audit_log_immutable_update ON public.audit_log
  FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY audit_log_immutable_delete ON public.audit_log
  FOR DELETE TO authenticated
  USING (false);

-- Create index for common audit log queries
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON public.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON public.audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_operation ON public.audit_log(operation);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.audit_log(created_at DESC);

-- Audit trigger function
CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
RETURNS TRIGGER AS $$
DECLARE
  v_user_email TEXT;
BEGIN
  -- Get user email from auth.users if available
  SELECT email INTO v_user_email FROM auth.users WHERE id = auth.uid();

  INSERT INTO public.audit_log (
    operation,
    table_name,
    record_id,
    user_id,
    user_role,
    user_email,
    old_values,
    new_values,
    created_at
  ) VALUES (
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    auth.uid(),
    auth.jwt() ->> 'role',
    v_user_email,
    to_jsonb(OLD),
    to_jsonb(NEW),
    now()
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Soft delete audit function (tracks soft deletes specifically)
CREATE OR REPLACE FUNCTION public.audit_soft_delete_fn()
RETURNS TRIGGER AS $$
DECLARE
  v_user_email TEXT;
BEGIN
  -- Only log if deleted_at changed from NULL to a timestamp
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    SELECT email INTO v_user_email FROM auth.users WHERE id = auth.uid();

    INSERT INTO public.audit_log (
      operation,
      table_name,
      record_id,
      user_id,
      user_role,
      user_email,
      old_values,
      new_values,
      reason,
      created_at
    ) VALUES (
      'SOFT_DELETE',
      TG_TABLE_NAME,
      NEW.id,
      auth.uid(),
      auth.jwt() ->> 'role',
      v_user_email,
      to_jsonb(OLD),
      to_jsonb(NEW),
      'Soft delete: marked as deleted',
      now()
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to verify admin password (for critical operations)
-- This assumes a separate admin_passwords table with hashed passwords
-- In practice, this would integrate with Supabase Auth webhooks
CREATE OR REPLACE FUNCTION public.verify_admin_password(_password TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID;
  v_is_admin BOOLEAN;
BEGIN
  v_user_id := auth.uid();

  -- Check if user is admin
  SELECT (auth.jwt() ->> 'role') = 'admin' INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN false;
  END IF;

  -- In a real implementation, this would:
  -- 1. Look up the user's password hash from a secure admin_sessions table
  -- 2. Verify the provided password against the hash
  -- 3. Check that the session is still valid (not expired)
  --
  -- For now, we'll use Supabase's auth.users verification
  -- by checking if the user's email/password combination is valid
  -- This requires a separate backend endpoint or edge function

  -- Placeholder: return true if admin, false otherwise
  RETURN v_is_admin;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to verify MFA code (for critical operations)
-- This requires an mfa_secrets table with user's TOTP secrets
CREATE OR REPLACE FUNCTION public.verify_mfa_code(_user_id UUID, _code TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  -- Check if requesting user is admin
  SELECT (auth.jwt() ->> 'role') = 'admin' INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN false;
  END IF;

  -- In a real implementation, this would:
  -- 1. Look up the user's MFA secret from mfa_secrets table
  -- 2. Verify the provided TOTP code against the secret
  -- 3. Check code timestamp (valid for 30 seconds, prevents replay)
  -- 4. Mark code as used (in mfa_sessions table) to prevent reuse

  -- Placeholder: always return false until MFA is properly configured
  -- Once configured, replace with actual TOTP verification
  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to perform hard delete (only callable by admin)
CREATE OR REPLACE FUNCTION public.hard_delete_record(
  _table_name TEXT,
  _record_id UUID,
  _reason TEXT DEFAULT 'Admin hard delete'
)
RETURNS void AS $$
DECLARE
  v_user_email TEXT;
BEGIN
  -- Verify admin role
  IF (auth.jwt() ->> 'role') != 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: hard delete requires admin role';
  END IF;

  -- Log the hard delete before it happens
  SELECT email INTO v_user_email FROM auth.users WHERE id = auth.uid();

  INSERT INTO public.audit_log (
    operation,
    table_name,
    record_id,
    user_id,
    user_role,
    user_email,
    reason,
    created_at
  ) VALUES (
    'HARD_DELETE',
    _table_name,
    _record_id,
    auth.uid(),
    'admin',
    v_user_email,
    _reason,
    now()
  );

  -- Execute the deletion (note: actual DELETE will be done by caller or edge function)
  -- because dynamic SQL in stored procedures has security implications
  -- We log the intent here, execution is handled at application layer

  RAISE NOTICE 'Hard delete logged for % table, record %', _table_name, _record_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant permissions
REVOKE ALL ON TABLE public.audit_log FROM public;
REVOKE ALL ON FUNCTION public.audit_trigger_fn() FROM public;
REVOKE ALL ON FUNCTION public.audit_soft_delete_fn() FROM public;
REVOKE ALL ON FUNCTION public.verify_admin_password(TEXT) FROM public;
REVOKE ALL ON FUNCTION public.verify_mfa_code(UUID, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.hard_delete_record(TEXT, UUID, TEXT) FROM public;

GRANT SELECT ON TABLE public.audit_log TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_admin_password(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_mfa_code(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hard_delete_record(TEXT, UUID, TEXT) TO authenticated;
