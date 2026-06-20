
-- Backfill: for every photo on a completed order, link it to the order's product
-- and all replacement products in the product photo library.
-- Skips "before" shots and avoids duplicates.
INSERT INTO public.hde_product_photos (product_id, photo_url, uploaded_by)
SELECT DISTINCT pid, jp.photo_url, jp.uploaded_by
  FROM public.hde_job_photos jp
  JOIN public.hde_orders o ON o.id = jp.order_id
  CROSS JOIN LATERAL (
    SELECT unnest(
      ARRAY[o.product_id, o.replacement_product_id]
      || COALESCE(o.replacement_product_ids, '{}'::uuid[])
    ) AS pid
  ) AS p
 WHERE o.status = 'completed'
   AND COALESCE(jp.photo_type, '') <> 'before'
   AND p.pid IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.hde_product_photos pp
      WHERE pp.product_id = p.pid AND pp.photo_url = jp.photo_url
   );

-- Trigger: whenever a photo is added to a completed order, mirror it into the
-- product photo library (idempotent — guarded against duplicates).
CREATE OR REPLACE FUNCTION public.mirror_job_photo_to_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o   RECORD;
  pid uuid;
BEGIN
  IF COALESCE(NEW.photo_type, '') = 'before' THEN RETURN NEW; END IF;

  SELECT status, product_id, replacement_product_id, replacement_product_ids
    INTO o FROM public.hde_orders WHERE id = NEW.order_id;
  IF NOT FOUND OR o.status <> 'completed' THEN RETURN NEW; END IF;

  FOR pid IN
    SELECT unnest(
      ARRAY[o.product_id, o.replacement_product_id]
      || COALESCE(o.replacement_product_ids, '{}'::uuid[])
    )
  LOOP
    IF pid IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.hde_product_photos
       WHERE product_id = pid AND photo_url = NEW.photo_url
    ) THEN
      INSERT INTO public.hde_product_photos (product_id, photo_url, uploaded_by)
      VALUES (pid, NEW.photo_url, NEW.uploaded_by);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_job_photo_to_product ON public.hde_job_photos;
CREATE TRIGGER trg_mirror_job_photo_to_product
AFTER INSERT ON public.hde_job_photos
FOR EACH ROW
EXECUTE FUNCTION public.mirror_job_photo_to_product();

-- Also: when an order transitions to 'completed', sweep its existing photos in.
CREATE OR REPLACE FUNCTION public.mirror_job_photos_on_order_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  jp  RECORD;
  pid uuid;
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NEW; END IF;

  FOR jp IN
    SELECT photo_url, uploaded_by FROM public.hde_job_photos
     WHERE order_id = NEW.id AND COALESCE(photo_type, '') <> 'before'
  LOOP
    FOR pid IN
      SELECT unnest(
        ARRAY[NEW.product_id, NEW.replacement_product_id]
        || COALESCE(NEW.replacement_product_ids, '{}'::uuid[])
      )
    LOOP
      IF pid IS NULL THEN CONTINUE; END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.hde_product_photos
         WHERE product_id = pid AND photo_url = jp.photo_url
      ) THEN
        INSERT INTO public.hde_product_photos (product_id, photo_url, uploaded_by)
        VALUES (pid, jp.photo_url, jp.uploaded_by);
      END IF;
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_photos_on_order_complete ON public.hde_orders;
CREATE TRIGGER trg_mirror_photos_on_order_complete
AFTER UPDATE OF status ON public.hde_orders
FOR EACH ROW
EXECUTE FUNCTION public.mirror_job_photos_on_order_complete();
