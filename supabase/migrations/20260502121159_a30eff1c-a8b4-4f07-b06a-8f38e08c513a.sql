
CREATE TABLE public.godrej_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  name text NOT NULL,
  price text,
  price_numeric numeric,
  description text,
  image_url text,
  product_url text NOT NULL,
  product_code text,
  scraped_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_url)
);

CREATE INDEX idx_godrej_products_category ON public.godrej_products(category) WHERE active = true;
CREATE INDEX idx_godrej_products_name ON public.godrej_products USING gin (to_tsvector('english', name));

ALTER TABLE public.godrej_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_manage_godrej_products"
  ON public.godrej_products FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "view_active_godrej_products"
  ON public.godrej_products FOR SELECT
  TO authenticated
  USING (
    active = true AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'sales'::app_role)
      OR has_role(auth.uid(), 'site_agent'::app_role)
      OR has_role(auth.uid(), 'field_agent'::app_role)
    )
  );

CREATE TRIGGER update_godrej_products_updated_at
  BEFORE UPDATE ON public.godrej_products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Scrape run audit table
CREATE TABLE public.godrej_scrape_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  mode text NOT NULL DEFAULT 'map',
  status text NOT NULL DEFAULT 'running',
  categories_processed int NOT NULL DEFAULT 0,
  urls_discovered int NOT NULL DEFAULT 0,
  products_upserted int NOT NULL DEFAULT 0,
  products_skipped int NOT NULL DEFAULT 0,
  error_message text,
  details jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.godrej_scrape_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_manage_scrape_runs"
  ON public.godrej_scrape_runs FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Unified view bridging internal products and Godrej products
CREATE OR REPLACE VIEW public.unified_products AS
SELECT
  p.id,
  'internal'::text AS source,
  COALESCE(c.name, '') AS category,
  p.product_name AS name,
  p.net_price::text AS price,
  p.net_price AS price_numeric,
  NULL::text AS description,
  NULL::text AS image_url,
  NULL::text AS product_url,
  p.sku AS product_code,
  p.created_at AS scraped_at,
  (p.status = 'active' AND p.deleted_at IS NULL) AS active
FROM public.products p
LEFT JOIN public.categories c ON c.id = p.category_id
WHERE p.deleted_at IS NULL
UNION ALL
SELECT
  g.id,
  'godrej'::text AS source,
  g.category,
  g.name,
  g.price,
  g.price_numeric,
  g.description,
  g.image_url,
  g.product_url,
  g.product_code,
  g.scraped_at,
  g.active
FROM public.godrej_products g;

GRANT SELECT ON public.unified_products TO authenticated;
