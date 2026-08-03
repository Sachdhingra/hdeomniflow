-- CATEGORIES
CREATE TABLE public.pl_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  image_url text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_categories TO authenticated;
GRANT ALL ON public.pl_categories TO service_role;
ALTER TABLE public.pl_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pl_categories_read" ON public.pl_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "pl_categories_admin" ON public.pl_categories FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- COLLECTIONS
CREATE TABLE public.pl_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.pl_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  image_url text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_collections TO authenticated;
GRANT ALL ON public.pl_collections TO service_role;
ALTER TABLE public.pl_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pl_collections_read" ON public.pl_collections FOR SELECT TO authenticated USING (true);
CREATE POLICY "pl_collections_admin" ON public.pl_collections FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- PRODUCTS
CREATE TABLE public.pl_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  category_id uuid REFERENCES public.pl_categories(id) ON DELETE SET NULL,
  collection_id uuid REFERENCES public.pl_collections(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  features text[] NOT NULL DEFAULT '{}',
  dimensions text,
  warranty text,
  mrp numeric(12,2) NOT NULL DEFAULT 0,
  offer_price numeric(12,2),
  gst_percent numeric(5,2) NOT NULL DEFAULT 18,
  exchange_eligible boolean NOT NULL DEFAULT false,
  elite_card_eligible boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  hero_image_url text,
  thumbnail_url text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_products TO authenticated;
GRANT ALL ON public.pl_products TO service_role;
ALTER TABLE public.pl_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pl_products_read" ON public.pl_products FOR SELECT TO authenticated USING (true);
CREATE POLICY "pl_products_admin" ON public.pl_products FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- VARIANTS
CREATE TABLE public.pl_product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.pl_products(id) ON DELETE CASCADE,
  variant_sku text,
  colour text,
  colour_hex text,
  size text,
  finish text,
  mrp numeric(12,2),
  offer_price numeric(12,2),
  image_url text,
  in_stock boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_product_variants TO authenticated;
GRANT ALL ON public.pl_product_variants TO service_role;
ALTER TABLE public.pl_product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pl_variants_read" ON public.pl_product_variants FOR SELECT TO authenticated USING (true);
CREATE POLICY "pl_variants_admin" ON public.pl_product_variants FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- IMAGES
CREATE TABLE public.pl_product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.pl_products(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  storage_path text,
  image_type text NOT NULL DEFAULT 'gallery',
  alt_text text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_product_images TO authenticated;
GRANT ALL ON public.pl_product_images TO service_role;
ALTER TABLE public.pl_product_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pl_images_read" ON public.pl_product_images FOR SELECT TO authenticated USING (true);
CREATE POLICY "pl_images_admin" ON public.pl_product_images FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- BROCHURES
CREATE TABLE public.pl_product_brochures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.pl_products(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Brochure',
  file_url text NOT NULL,
  storage_path text,
  file_size int,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_product_brochures TO authenticated;
GRANT ALL ON public.pl_product_brochures TO service_role;
ALTER TABLE public.pl_product_brochures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pl_brochures_read" ON public.pl_product_brochures FOR SELECT TO authenticated USING (true);
CREATE POLICY "pl_brochures_admin" ON public.pl_product_brochures FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- VIDEOS
CREATE TABLE public.pl_product_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.pl_products(id) ON DELETE CASCADE,
  title text,
  video_url text NOT NULL,
  storage_path text,
  thumbnail_url text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_product_videos TO authenticated;
GRANT ALL ON public.pl_product_videos TO service_role;
ALTER TABLE public.pl_product_videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pl_videos_read" ON public.pl_product_videos FOR SELECT TO authenticated USING (true);
CREATE POLICY "pl_videos_admin" ON public.pl_product_videos FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- SPECIFICATIONS
CREATE TABLE public.pl_product_specifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.pl_products(id) ON DELETE CASCADE,
  spec_group text,
  label text NOT NULL,
  value text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pl_product_specifications TO authenticated;
GRANT ALL ON public.pl_product_specifications TO service_role;
ALTER TABLE public.pl_product_specifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pl_specs_read" ON public.pl_product_specifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "pl_specs_admin" ON public.pl_product_specifications FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- QUOTES
CREATE TABLE public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  lead_id uuid,
  customer_name text,
  customer_phone text,
  status text NOT NULL DEFAULT 'draft',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotes TO authenticated;
GRANT ALL ON public.quotes TO service_role;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quotes_own" ON public.quotes FOR ALL TO authenticated USING (created_by = auth.uid() OR public.has_role(auth.uid(),'admin')) WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE TABLE public.quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.pl_products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES public.pl_product_variants(id) ON DELETE SET NULL,
  image_url text,
  product_name text NOT NULL,
  sku text,
  description text,
  quantity int NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  gst_percent numeric(5,2) NOT NULL DEFAULT 18,
  total numeric(12,2) NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_items TO authenticated;
GRANT ALL ON public.quote_items TO service_role;
ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quote_items_own" ON public.quote_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_id AND (q.created_by = auth.uid() OR public.has_role(auth.uid(),'admin'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_id AND (q.created_by = auth.uid() OR public.has_role(auth.uid(),'admin'))));

-- updated_at triggers
CREATE TRIGGER trg_pl_categories_updated BEFORE UPDATE ON public.pl_categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_pl_collections_updated BEFORE UPDATE ON public.pl_collections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_pl_products_updated BEFORE UPDATE ON public.pl_products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_pl_variants_updated BEFORE UPDATE ON public.pl_product_variants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_quotes_updated BEFORE UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_pl_products_category ON public.pl_products(category_id);
CREATE INDEX idx_pl_products_collection ON public.pl_products(collection_id);
CREATE INDEX idx_pl_images_product ON public.pl_product_images(product_id);
CREATE INDEX idx_quote_items_quote ON public.quote_items(quote_id);

INSERT INTO public.pl_categories (name, slug, description, sort_order)
VALUES ('Home Storage', 'home-storage', 'Wardrobes, cabinets, shoe racks and modular storage solutions', 1);