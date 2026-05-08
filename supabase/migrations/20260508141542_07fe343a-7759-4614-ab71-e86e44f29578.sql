CREATE OR REPLACE FUNCTION public.get_lead_owners_for_jobs(p_job_ids uuid[])
RETURNS TABLE(job_id uuid, lead_id uuid, owner_id uuid, owner_name text, assignee_id uuid, assignee_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sj.id AS job_id,
    l.id AS lead_id,
    l.created_by AS owner_id,
    po.name AS owner_name,
    l.assigned_to AS assignee_id,
    pa.name AS assignee_name
  FROM public.service_jobs sj
  LEFT JOIN public.leads l ON l.id = sj.source_lead_id
  LEFT JOIN public.profiles po ON po.id = l.created_by
  LEFT JOIN public.profiles pa ON pa.id = l.assigned_to
  WHERE sj.id = ANY(p_job_ids);
$$;