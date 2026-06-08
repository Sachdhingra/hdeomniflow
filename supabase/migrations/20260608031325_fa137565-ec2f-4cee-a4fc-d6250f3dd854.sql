
-- 1. Rates table (singleton key/value)
CREATE TABLE public.logistics_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_key TEXT NOT NULL UNIQUE,
  rate_value NUMERIC NOT NULL,
  description TEXT,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.logistics_rates TO authenticated;
GRANT ALL ON public.logistics_rates TO service_role;
ALTER TABLE public.logistics_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "All authenticated can view rates" ON public.logistics_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin can manage rates" ON public.logistics_rates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.logistics_rates (rate_key, rate_value, description) VALUES
  ('local_freight_per_km', 32, 'Local freight per round trip km'),
  ('outstation_freight_per_km', 25, 'Outstation freight per round trip km'),
  ('handling_per_km', 15, 'Furniture handling per round trip km'),
  ('floor_labour_rate', 400, 'Floor labour per unit per floor (sofa/almirah)'),
  ('modular_labour_rate', 75, 'Modular labour per carton per floor'),
  ('minimum_charge', 400, 'Minimum charge across applicable calculators'),
  ('gst_rate', 18, 'GST percentage');

-- 2. Kitchen visit locations
CREATE TABLE public.kitchen_visit_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_name TEXT NOT NULL UNIQUE,
  charge NUMERIC NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kitchen_visit_locations TO authenticated;
GRANT ALL ON public.kitchen_visit_locations TO service_role;
ALTER TABLE public.kitchen_visit_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "All authenticated can view kitchen locations" ON public.kitchen_visit_locations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin manages kitchen locations" ON public.kitchen_visit_locations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.kitchen_visit_locations (location_name, charge) VALUES
  ('Roorkee', 3500),
  ('Selaqui', 1500),
  ('Vikas Nagar', 2000),
  ('Harrawala', 2000),
  ('Doiwala', 2000),
  ('Rishikesh', 3000),
  ('Sahaspur', 2000),
  ('Nanda Ki Chowki', 1500),
  ('Saharanpur', 3500),
  ('Mussoorie', 2500),
  ('Srinagar', 4000),
  ('Tehri', 4000);

-- 3. Calculations history
CREATE TABLE public.logistics_calculations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calculator_type TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  gst_amount NUMERIC NOT NULL DEFAULT 0,
  final_amount NUMERIC NOT NULL DEFAULT 0,
  gst_included BOOLEAN NOT NULL DEFAULT true,
  attached_to_lead BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_logistics_calc_created_by ON public.logistics_calculations(created_by);
CREATE INDEX idx_logistics_calc_lead ON public.logistics_calculations(lead_id);
CREATE INDEX idx_logistics_calc_created_at ON public.logistics_calculations(created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.logistics_calculations TO authenticated;
GRANT ALL ON public.logistics_calculations TO service_role;
ALTER TABLE public.logistics_calculations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View own or privileged" ON public.logistics_calculations FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'service_head'::app_role)
    OR public.has_role(auth.uid(), 'accounts'::app_role)
  );
CREATE POLICY "Authenticated create calculations" ON public.logistics_calculations FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "Update own or admin" ON public.logistics_calculations FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admin can delete" ON public.logistics_calculations FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- updated_at triggers
CREATE TRIGGER trg_logistics_rates_updated_at BEFORE UPDATE ON public.logistics_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_kitchen_visit_locations_updated_at BEFORE UPDATE ON public.kitchen_visit_locations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_logistics_calculations_updated_at BEFORE UPDATE ON public.logistics_calculations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
