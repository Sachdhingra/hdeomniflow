ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'accounts';
ALTER TYPE service_job_status ADD VALUE IF NOT EXISTS 'pending_accounts_approval';
ALTER TYPE service_job_status ADD VALUE IF NOT EXISTS 'accounts_rejected';