-- 1. Photo mirroring: never overwrite the outgoing/sold article's photo
CREATE OR REPLACE FUNCTION public.mirror_job_photo_to_product()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  o RECORD;
  pid uuid;
  reps uuid[];
BEGIN
  IF COALESCE(NEW.photo_type, '') = 'before' THEN RETURN NEW; END IF;

  SELECT status, order_type, product_id, replacement_product_id, replacement_product_ids
    INTO o FROM public.hde_orders WHERE id = NEW.order_id;
  IF NOT FOUND OR o.status <> 'completed' THEN RETURN NEW; END IF;

  reps := COALESCE(NULLIF(o.replacement_product_ids, ARRAY[]::uuid[]),
                   CASE WHEN o.replacement_product_id IS NULL
                        THEN ARRAY[]::uuid[] ELSE ARRAY[o.replacement_product_id] END);

  -- company orders: the received article itself is the new inventory
  IF array_length(reps, 1) IS NULL AND o.order_type = 'company' THEN
    reps := ARRAY[o.product_id];
  END IF;

  FOREACH pid IN ARRAY reps LOOP
    IF pid IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.hde_product_photos (product_id, photo_url, uploaded_by)
    VALUES (pid, NEW.photo_url, NEW.uploaded_by)
    ON CONFLICT (product_id) DO UPDATE
      SET photo_url = EXCLUDED.photo_url, uploaded_by = EXCLUDED.uploaded_by;
  END LOOP;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mirror_job_photos_on_order_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_url text;
  v_uploader uuid;
  pid uuid;
  reps uuid[];
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NEW; END IF;

  SELECT photo_url, uploaded_by INTO v_url, v_uploader
    FROM public.hde_job_photos
   WHERE order_id = NEW.id AND COALESCE(photo_type,'') <> 'before'
   ORDER BY uploaded_at DESC NULLS LAST LIMIT 1;
  IF v_url IS NULL THEN RETURN NEW; END IF;

  reps := COALESCE(NULLIF(NEW.replacement_product_ids, ARRAY[]::uuid[]),
                   CASE WHEN NEW.replacement_product_id IS NULL
                        THEN ARRAY[]::uuid[] ELSE ARRAY[NEW.replacement_product_id] END);
  IF array_length(reps, 1) IS NULL AND NEW.order_type = 'company' THEN
    reps := ARRAY[NEW.product_id];
  END IF;

  FOREACH pid IN ARRAY reps LOOP
    IF pid IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.hde_product_photos (product_id, photo_url, uploaded_by)
    VALUES (pid, v_url, v_uploader)
    ON CONFLICT (product_id) DO UPDATE
      SET photo_url = EXCLUDED.photo_url, uploaded_by = EXCLUDED.uploaded_by;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- 2. Inventory order notifications
CREATE OR REPLACE FUNCTION public.fn_hde_order_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  u uuid;
  v_product text;
BEGIN
  SELECT name INTO v_product FROM public.products WHERE id = NEW.product_id;

  IF TG_OP = 'INSERT' AND NEW.status = 'pending_approval' THEN
    FOR u IN SELECT user_id FROM public.user_roles WHERE role IN ('accounts'::app_role,'admin'::app_role) LOOP
      INSERT INTO public.notifications (user_id, type, message, link)
      VALUES (u, 'order_approval',
        'Order ' || NEW.order_number || ' — ' || COALESCE(v_product,'article') ||
        COALESCE(' for ' || NEW.customer_name, '') || ' needs approval',
        '/inventory');
    END LOOP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    FOR u IN SELECT user_id FROM public.user_roles WHERE role IN ('service_head'::app_role,'admin'::app_role) LOOP
      INSERT INTO public.notifications (user_id, type, message, link)
      VALUES (u, 'order_service',
        'Order ' || NEW.order_number || ' — ' || COALESCE(v_product,'article') ||
        ' approved, ready for service assignment', '/inventory');
    END LOOP;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    INSERT INTO public.notifications (user_id, type, message, link)
    VALUES (NEW.created_by, 'order_rejected',
      'Order ' || NEW.order_number || ' was rejected' ||
      COALESCE(' — ' || NEW.rejection_reason, ''), '/inventory');
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_hde_order_notify_insert ON public.hde_orders;
CREATE TRIGGER trg_hde_order_notify_insert
AFTER INSERT ON public.hde_orders
FOR EACH ROW EXECUTE FUNCTION public.fn_hde_order_notify();

DROP TRIGGER IF EXISTS trg_hde_order_notify_update ON public.hde_orders;
CREATE TRIGGER trg_hde_order_notify_update
AFTER UPDATE OF status ON public.hde_orders
FOR EACH ROW EXECUTE FUNCTION public.fn_hde_order_notify();

-- 3. Daily reminders for stale inventory orders (> 2 days in stage)
CREATE OR REPLACE FUNCTION public.fn_hde_order_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  r RECORD;
  u uuid;
  n int := 0;
BEGIN
  FOR r IN
    SELECT o.id, o.order_number, o.status, o.customer_name,
           EXTRACT(DAY FROM now() - COALESCE(o.approved_at, o.created_at))::int AS age_days
      FROM public.hde_orders o
     WHERE o.status IN ('pending_approval','approved','service_assigned')
       AND COALESCE(o.approved_at, o.created_at) < now() - interval '2 days'
  LOOP
    FOR u IN
      SELECT user_id FROM public.user_roles
       WHERE role = 'admin'::app_role
          OR role = (CASE WHEN r.status = 'pending_approval'
                          THEN 'accounts'::app_role ELSE 'service_head'::app_role END)
    LOOP
      IF EXISTS (SELECT 1 FROM public.notifications
                  WHERE user_id = u
                    AND type LIKE 'order_%_reminder'
                    AND message LIKE '%' || r.order_number || '%'
                    AND created_at > now() - interval '20 hours') THEN
        CONTINUE;
      END IF;

      INSERT INTO public.notifications (user_id, type, message, link)
      VALUES (u,
        CASE WHEN r.status = 'pending_approval'
             THEN 'order_approval_reminder' ELSE 'order_service_reminder' END,
        'Reminder: order ' || r.order_number ||
        COALESCE(' (' || r.customer_name || ')', '') ||
        ' pending ' || r.age_days || ' days',
        '/inventory');
      n := n + 1;
    END LOOP;
  END LOOP;
  RETURN n;
END;
$function$;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

SELECT cron.unschedule('hde-order-reminders')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hde-order-reminders');

SELECT cron.schedule('hde-order-reminders', '30 4 * * *',
  $$SELECT public.fn_hde_order_reminders();$$);