-- Personal website links for salespeople.
-- Each staff profile gets a short code; the website is shared as
-- https://hdefurniture.netlify.app/?ref=<code>, and enquiries sent through that
-- link are created by the website-lead function and assigned to that person.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS website_ref_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_website_ref_code_key
  ON public.profiles (website_ref_code);

-- "Rahul Sharma" -> "rahul-sharma", then "rahul-sharma-2" if taken
CREATE OR REPLACE FUNCTION public.generate_website_ref_code(_name TEXT, _profile_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_base TEXT;
  v_code TEXT;
  v_n    INTEGER := 2;
BEGIN
  v_base := trim(both '-' from regexp_replace(lower(coalesce(_name, '')), '[^a-z0-9]+', '-', 'g'));
  v_base := left(v_base, 32);
  IF v_base = '' THEN
    v_base := 'staff';
  END IF;
  v_code := v_base;
  WHILE EXISTS (
    SELECT 1 FROM public.profiles
    WHERE website_ref_code = v_code AND id IS DISTINCT FROM _profile_id
  ) LOOP
    v_code := v_base || '-' || v_n;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_website_ref_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.website_ref_code IS NULL OR NEW.website_ref_code = '' THEN
    NEW.website_ref_code := public.generate_website_ref_code(NEW.name, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_website_ref_code ON public.profiles;
CREATE TRIGGER trg_profiles_website_ref_code
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_website_ref_code();

-- Backfill existing staff, oldest first so the earliest "Rahul" keeps "rahul"
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id, name FROM public.profiles WHERE website_ref_code IS NULL ORDER BY created_at LOOP
    UPDATE public.profiles
    SET website_ref_code = public.generate_website_ref_code(r.name, r.id)
    WHERE id = r.id;
  END LOOP;
END;
$$;

-- Website enquiries get their own source type
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_source_type_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_source_type_check
  CHECK (source_type IN ('sales', 'field_agent', 'site_agent', 'walk_in', 'referral', 'feedback', 'website'));
