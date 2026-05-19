CREATE TABLE IF NOT EXISTS firecrawl_research (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  markdown TEXT,
  links JSONB DEFAULT '[]',
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE firecrawl_research ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage firecrawl_research"
  ON firecrawl_research FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE INDEX firecrawl_research_scraped_at_idx ON firecrawl_research (scraped_at DESC);
