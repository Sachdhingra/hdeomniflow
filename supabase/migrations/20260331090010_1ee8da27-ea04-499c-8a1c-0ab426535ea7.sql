
-- Performance indexes for leads
CREATE INDEX IF NOT EXISTS idx_leads_created_by ON public.leads(created_by);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON public.leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_deleted_at ON public.leads(deleted_at);
CREATE INDEX IF NOT EXISTS idx_leads_next_follow_up ON public.leads(next_follow_up_date);
CREATE INDEX IF NOT EXISTS idx_leads_category ON public.leads(category);

-- Performance indexes for service_jobs
CREATE INDEX IF NOT EXISTS idx_service_jobs_status ON public.service_jobs(status);
CREATE INDEX IF NOT EXISTS idx_service_jobs_assigned_agent ON public.service_jobs(assigned_agent);
CREATE INDEX IF NOT EXISTS idx_service_jobs_created_at ON public.service_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_jobs_deleted_at ON public.service_jobs(deleted_at);
CREATE INDEX IF NOT EXISTS idx_service_jobs_type ON public.service_jobs(type);
CREATE INDEX IF NOT EXISTS idx_service_jobs_date_to_attend ON public.service_jobs(date_to_attend);

-- Performance indexes for site_visits
CREATE INDEX IF NOT EXISTS idx_site_visits_agent_id ON public.site_visits(agent_id);
CREATE INDEX IF NOT EXISTS idx_site_visits_date ON public.site_visits(date);
CREATE INDEX IF NOT EXISTS idx_site_visits_deleted_at ON public.site_visits(deleted_at);

-- Performance indexes for notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);

-- Performance indexes for user_roles
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles(role);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_leads_active ON public.leads(deleted_at, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_jobs_active ON public.service_jobs(deleted_at, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_jobs_pending ON public.service_jobs(status, deleted_at) WHERE status = 'pending' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_overdue ON public.leads(status, deleted_at) WHERE status = 'overdue' AND deleted_at IS NULL;

-- Server-side dashboard summary function
CREATE OR REPLACE FUNCTION public.get_dashboard_summary()
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT json_build_object(
    'total_leads', (SELECT count(*) FROM public.leads WHERE deleted_at IS NULL),
    'total_pipeline_value', (SELECT COALESCE(sum(value_in_rupees), 0) FROM public.leads WHERE deleted_at IS NULL),
    'pending_jobs', (SELECT count(*) FROM public.service_jobs WHERE deleted_at IS NULL AND status = 'pending'),
    'overdue_leads', (SELECT count(*) FROM public.leads WHERE deleted_at IS NULL AND status = 'overdue')
  )
$$;
