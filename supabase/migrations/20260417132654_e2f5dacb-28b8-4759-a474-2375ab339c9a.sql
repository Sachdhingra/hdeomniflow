
-- 1. site_visits: add GPS + primary photo url
ALTER TABLE public.site_visits
  ADD COLUMN IF NOT EXISTS accuracy_meters double precision,
  ADD COLUMN IF NOT EXISTS gps_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS photo_url text;

-- 2. leads: add originating site agent + visit photo
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS created_by_agent_id uuid,
  ADD COLUMN IF NOT EXISTS visit_photo text;

CREATE INDEX IF NOT EXISTS idx_leads_created_by_agent_id
  ON public.leads(created_by_agent_id) WHERE deleted_at IS NULL;

-- 3. deletion_logs (audit trail for hard deletes)
CREATE TABLE IF NOT EXISTS public.deletion_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  deleted_by uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  record_snapshot jsonb,
  reason text
);

ALTER TABLE public.deletion_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view deletion logs"
  ON public.deletion_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins insert deletion logs"
  ON public.deletion_logs FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND deleted_by = auth.uid());

CREATE INDEX IF NOT EXISTS idx_deletion_logs_table_record
  ON public.deletion_logs(table_name, record_id);

-- 4. Storage policies for field-agent-photos bucket
DROP POLICY IF EXISTS "Field agent photos public read" ON storage.objects;
CREATE POLICY "Field agent photos public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'field-agent-photos');

DROP POLICY IF EXISTS "Authenticated upload field agent photos" ON storage.objects;
CREATE POLICY "Authenticated upload field agent photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'field-agent-photos');

DROP POLICY IF EXISTS "Owner update field agent photos" ON storage.objects;
CREATE POLICY "Owner update field agent photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'field-agent-photos' AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role)));

DROP POLICY IF EXISTS "Owner or admin delete field agent photos" ON storage.objects;
CREATE POLICY "Owner or admin delete field agent photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'field-agent-photos' AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role)));
