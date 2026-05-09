
CREATE OR REPLACE FUNCTION public.get_chat_directory()
RETURNS TABLE(id uuid, name text, email text, role app_role)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.email, ur.role
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE ur.role IN ('admin','sales','accounts','service_head')
    AND COALESCE(p.active, true) = true;
$$;

GRANT EXECUTE ON FUNCTION public.get_chat_directory() TO authenticated;
