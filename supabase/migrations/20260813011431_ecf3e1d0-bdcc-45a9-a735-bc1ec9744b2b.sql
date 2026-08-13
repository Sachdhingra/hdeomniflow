CREATE OR REPLACE FUNCTION public.fn_hde_order_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u uuid;
  v_product text;
BEGIN
  SELECT product_name INTO v_product FROM public.products WHERE id = NEW.product_id;

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
$$;