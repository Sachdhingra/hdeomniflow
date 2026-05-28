
-- Staff profiles table
CREATE TABLE IF NOT EXISTS public.staff_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  date_of_birth DATE,
  joining_date DATE,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  profile_picture_url TEXT,
  department TEXT DEFAULT 'sales',
  designation TEXT,
  bio TEXT,
  is_profile_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.staff_profiles TO authenticated;
GRANT ALL ON public.staff_profiles TO service_role;

ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_profiles_select_all_auth"
ON public.staff_profiles FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "staff_profiles_insert_own"
ON public.staff_profiles FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "staff_profiles_update_own_or_admin"
ON public.staff_profiles FOR UPDATE
TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "staff_profiles_delete_admin"
ON public.staff_profiles FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER staff_profiles_set_updated_at
BEFORE UPDATE ON public.staff_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Monthly leaderboard view (joins by user_id, not name)
CREATE OR REPLACE VIEW public.monthly_sales_leaderboard AS
SELECT
  date_trunc('month', l.created_at)::date AS month,
  l.assigned_to AS user_id,
  COALESCE(sp.full_name, p.name) AS salesperson_name,
  sp.profile_picture_url,
  sp.designation,
  COUNT(l.id)::int AS leads_count,
  COUNT(*) FILTER (WHERE l.status::text IN ('negotiation','follow_up','qualified','hot'))::int AS qualified_leads,
  COUNT(*) FILTER (WHERE l.status::text IN ('won','converted'))::int AS closed_deals,
  ROUND(AVG(l.feedback_score::numeric), 1) AS avg_feedback_score,
  ROW_NUMBER() OVER (
    PARTITION BY date_trunc('month', l.created_at)
    ORDER BY COUNT(l.id) DESC
  ) AS rank_position
FROM public.leads l
LEFT JOIN public.staff_profiles sp ON sp.user_id = l.assigned_to
LEFT JOIN public.profiles p ON p.id = l.assigned_to
WHERE l.deleted_at IS NULL AND l.assigned_to IS NOT NULL
GROUP BY date_trunc('month', l.created_at), l.assigned_to, sp.full_name, p.name, sp.profile_picture_url, sp.designation;

GRANT SELECT ON public.monthly_sales_leaderboard TO authenticated;

-- Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('staff-profiles', 'staff-profiles', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage policies
CREATE POLICY "staff_profiles_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'staff-profiles');

CREATE POLICY "staff_profiles_upload_own"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'staff-profiles' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "staff_profiles_update_own"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'staff-profiles' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "staff_profiles_delete_own"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'staff-profiles' AND auth.uid()::text = (storage.foldername(name))[1]);
