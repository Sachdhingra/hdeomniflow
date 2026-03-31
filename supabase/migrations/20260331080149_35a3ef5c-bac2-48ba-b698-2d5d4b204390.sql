
-- Add soft delete columns to leads
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS deleted_by uuid DEFAULT NULL;

-- Add soft delete columns to service_jobs
ALTER TABLE public.service_jobs ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;
ALTER TABLE public.service_jobs ADD COLUMN IF NOT EXISTS deleted_by uuid DEFAULT NULL;

-- Add soft delete columns to site_visits
ALTER TABLE public.site_visits ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;
ALTER TABLE public.site_visits ADD COLUMN IF NOT EXISTS deleted_by uuid DEFAULT NULL;
