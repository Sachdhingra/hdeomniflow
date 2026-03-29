
-- Enum for app roles
CREATE TYPE public.app_role AS ENUM ('admin', 'sales', 'service_head', 'field_agent', 'site_agent');

-- Enum for lead categories
CREATE TYPE public.lead_category AS ENUM ('sofa', 'coffee_table', 'almirah', 'dining', 'mattress', 'bed', 'kitchen', 'chair', 'office_table', 'others');

-- Enum for lead statuses
CREATE TYPE public.lead_status AS ENUM ('new', 'contacted', 'follow_up', 'negotiation', 'won', 'lost', 'overdue');

-- Enum for service job statuses
CREATE TYPE public.service_job_status AS ENUM ('pending', 'assigned', 'in_progress', 'completed');

-- Enum for service job types
CREATE TYPE public.service_job_type AS ENUM ('service', 'delivery');

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  avatar_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User roles table (separate from profiles per security guidelines)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Function to get user's role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = _user_id
  LIMIT 1
$$;

-- Profiles RLS policies
CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- User roles RLS policies
CREATE POLICY "Users can view all roles" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Leads table
CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  category lead_category NOT NULL,
  value_in_rupees NUMERIC NOT NULL DEFAULT 0,
  status lead_status NOT NULL DEFAULT 'new',
  assigned_to UUID REFERENCES auth.users(id),
  next_follow_up_date DATE,
  next_follow_up_time TIME,
  notes TEXT DEFAULT '',
  source TEXT NOT NULL DEFAULT 'sales',
  created_by UUID NOT NULL REFERENCES auth.users(id),
  updated_by UUID NOT NULL REFERENCES auth.users(id),
  delivery_date DATE,
  delivery_notes TEXT,
  delivery_assigned_to UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_follow_up TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Leads RLS: sales see own, admin sees all
CREATE POLICY "Sales see own leads" ON public.leads FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR
    assigned_to = auth.uid() OR
    created_by = auth.uid()
  );
CREATE POLICY "Authenticated can create leads" ON public.leads FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Users can update assigned leads" ON public.leads FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR
    assigned_to = auth.uid() OR
    created_by = auth.uid()
  );

-- Service jobs table
CREATE TABLE public.service_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  category lead_category NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  date_received DATE NOT NULL DEFAULT CURRENT_DATE,
  date_to_attend DATE,
  value NUMERIC NOT NULL DEFAULT 0,
  is_foc BOOLEAN NOT NULL DEFAULT false,
  status service_job_status NOT NULL DEFAULT 'pending',
  assigned_agent UUID REFERENCES auth.users(id),
  claim_part_no TEXT,
  claim_reason TEXT,
  claim_due_date DATE,
  completed_at TIMESTAMPTZ,
  agent_reached_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  travel_started_at TIMESTAMPTZ,
  photos TEXT[] DEFAULT '{}',
  remarks TEXT,
  type service_job_type NOT NULL DEFAULT 'service',
  source_lead_id UUID REFERENCES public.leads(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.service_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service jobs viewable by relevant roles" ON public.service_jobs FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'service_head') OR
    assigned_agent = auth.uid()
  );
CREATE POLICY "Service head and admin can create jobs" ON public.service_jobs FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'service_head') OR
    public.has_role(auth.uid(), 'sales')
  );
CREATE POLICY "Service head and admin can update jobs" ON public.service_jobs FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'service_head') OR
    assigned_agent = auth.uid()
  );

-- Site visits table
CREATE TABLE public.site_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES auth.users(id),
  location TEXT NOT NULL DEFAULT '',
  society TEXT NOT NULL DEFAULT '',
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  photos TEXT[] DEFAULT '{}',
  notes TEXT DEFAULT '',
  leads_generated INTEGER NOT NULL DEFAULT 0,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  customer_name TEXT,
  customer_phone TEXT,
  category lead_category,
  budget NUMERIC,
  follow_up_date DATE,
  status TEXT DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Site visits viewable by agent and admin" ON public.site_visits FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR
    agent_id = auth.uid()
  );
CREATE POLICY "Site agents can create visits" ON public.site_visits FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = agent_id);
CREATE POLICY "Site agents can update own visits" ON public.site_visits FOR UPDATE TO authenticated
  USING (auth.uid() = agent_id);

-- Notifications table
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  read BOOLEAN NOT NULL DEFAULT false,
  link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own notifications" ON public.notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Authenticated can create notifications" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- Trigger for auto-updating updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_service_jobs_updated_at BEFORE UPDATE ON public.service_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.email
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
