
ALTER TABLE public.message_templates DROP CONSTRAINT IF EXISTS message_templates_stage_check;
ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_stage_check
  CHECK (stage = ANY (ARRAY['problem','exploration','evaluation','reassurance','decision','cold']));
