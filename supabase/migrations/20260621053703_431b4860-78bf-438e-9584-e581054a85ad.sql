-- Backfill: for every photo on a completed order, set it as the product's inventory photo.
-- Since hde_product_photos has UNIQUE(product_id) we upsert — latest photo wins.
WITH latest AS (
  SELECT DISTINCT ON (pid)
         pid AS product_id, jp.photo_url, jp.uploaded_by
    FROM public.hde_job_photos jp
    JOIN public.hde_orders o ON o.id = jp.order_id
    CROSS JOIN LATERAL (
      SELECT unnest(ARRAY[o.product_id, o.replacement_product_id]) AS pid
    ) AS p
   WHERE o.status = 'completed'
     AND COALESCE(jp.photo_type, '') <> 'before'
     AND p.pid IS NOT NULL
   ORDER BY pid, jp.uploaded_at DESC NULLS LAST
)
INSERT INTO public.hde_product_photos (product_id, photo_url, uploaded_by)
SELECT product_id, photo_url, uploaded_by FROM latest
ON CONFLICT (product_id) DO UPDATE
  SET photo_url = EXCLUDED.photo_url,
      uploaded_by = EXCLUDED.uploaded_by;

-- Trigger: when a photo is added to a completed order, upsert it as the product's photo.
CREATE OR REPLACE FUNCTION public.mirror_job_photo_to_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o RECORD;
  pid uuid;
BEGIN
  IF COALESCE(NEW.photo_type, '') = 'before' THEN RETURN NEW; END IF;

  SELECT status, product_id, replacement_product_id
    INTO o FROM public.hde_orders WHERE id = NEW.order_id;
  IF NOT FOUND OR o.status <> 'completed' THEN RETURN NEW; END IF;

  FOR pid IN SELECT unnest(ARRAY[o.product_id, o.replacement_product_id]) LOOP
    IF pid IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.hde_product_photos (product_id, photo_url, uploaded_by)
    VALUES (pid, NEW.photo_url, NEW.uploaded_by)
    ON CONFLICT (product_id) DO UPDATE
      SET photo_url = EXCLUDED.photo_url,
          uploaded_by = EXCLUDED.uploaded_by;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_job_photo_to_product ON public.hde_job_photos;
CREATE TRIGGER trg_mirror_job_photo_to_product
AFTER INSERT ON public.hde_job_photos
FOR EACH ROW
EXECUTE FUNCTION public.mirror_job_photo_to_product();

-- Trigger: when an order transitions to completed, sweep its existing photos in.
CREATE OR REPLACE FUNCTION public.mirror_job_photos_on_order_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_uploader uuid;
  pid uuid;
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NEW; END IF;

  SELECT photo_url, uploaded_by INTO v_url, v_uploader
    FROM public.hde_job_photos
   WHERE order_id = NEW.id AND COALESCE(photo_type,'') <> 'before'
   ORDER BY uploaded_at DESC NULLS LAST
   LIMIT 1;

  IF v_url IS NULL THEN RETURN NEW; END IF;

  FOR pid IN SELECT unnest(ARRAY[NEW.product_id, NEW.replacement_product_id]) LOOP
    IF pid IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.hde_product_photos (product_id, photo_url, uploaded_by)
    VALUES (pid, v_url, v_uploader)
    ON CONFLICT (product_id) DO UPDATE
      SET photo_url = EXCLUDED.photo_url,
          uploaded_by = EXCLUDED.uploaded_by;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_photos_on_order_complete ON public.hde_orders;
CREATE TRIGGER trg_mirror_photos_on_order_complete
AFTER UPDATE OF status ON public.hde_orders
FOR EACH ROW
EXECUTE FUNCTION public.mirror_job_photos_on_order_complete();