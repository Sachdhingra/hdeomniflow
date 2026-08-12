-- Fix the crash in fn_hde_order_notify() and remove the duplicate/overlapping
-- notification system, which together broke order creation for ALL order
-- types (not just company orders).
--
-- Root cause of the crash:
--   Migration 20260811151747 added a SECOND order-notification trigger,
--   fn_hde_order_notify(), independent of the one added in 20260717140000.
--   It runs "SELECT name FROM public.products" but the products table's
--   column is product_name, not name -- so every hde_orders INSERT/UPDATE
--   raised "column 'name' does not exist", blocking Warehouse AND Showroom
--   order creation (fn_hde_order_notify has no order_type filter, unlike
--   hde_notify_order_stage which only ran for order_type='company').
--
-- Since fn_hde_order_notify covers all order types -- which matches how the
-- UI's Approve/Reject actions actually work (shown for any pending_approval
-- order, not just company/warehouse-request) -- it is the more complete
-- implementation. We fix its bug and keep it as the single source of
-- stage-change notifications, and drop the narrower, now-redundant
-- hde_notify_order_stage trigger pair so company orders stop getting
-- double notifications.
--
-- Reminders: hde_remind_open_orders() (20260717120000/140000) is a superset
-- of fn_hde_order_reminders() -- it has the same 2-day stage reminders PLUS
-- the 3-day "please close this order" reminder to the creator, which
-- fn_hde_order_reminders lacks. Keep hde_remind_open_orders' cron job and
-- drop fn_hde_order_reminders' duplicate cron job.

-- --- 1. Fix fn_hde_order_notify(): products has product_name, not name ─────

CREATE OR REPLACE FUNCTION public.fn_hde_order_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  u uuid;
  v_product text;
BEGIN
  SELECT p.product_name INTO v_product FROM public.products p WHERE p.id = NEW.product_id;

  IF TG_OP = 'INSERT' AND NEW.status = 'pending_approval' THEN
    FOR u IN SELECT user_id FROM public.user_roles WHERE role IN ('accounts'::app_role,'admin'::app_role) LOOP
      INSERT INTO public.notifications (user_id, type, message, link)
      VALUES (u, 'order_approval',
        'Order ' || NEW.order_number || ' - ' || COALESCE(v_product,'article') ||
        COALESCE(' for ' || NEW.customer_name, '') || ' needs approval',
        '/inventory');
    END LOOP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    FOR u IN SELECT user_id FROM public.user_roles WHERE role IN ('service_head'::app_role,'admin'::app_role) LOOP
      INSERT INTO public.notifications (user_id, type, message, link)
      VALUES (u, 'order_service',
        'Order ' || NEW.order_number || ' - ' || COALESCE(v_product,'article') ||
        ' approved, ready for service assignment', '/inventory');
    END LOOP;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    INSERT INTO public.notifications (user_id, type, message, link)
    VALUES (NEW.created_by, 'order_rejected',
      'Order ' || NEW.order_number || ' was rejected' ||
      COALESCE(' - ' || NEW.rejection_reason, ''), '/inventory');
  END IF;

  RETURN NEW;
END;
$function$;

-- --- 2. Drop the redundant, narrower notification trigger pair ────────────
-- (hde_notify_order_stage only covered order_type='company'; fn_hde_order_notify
-- above now covers everything correctly, so keeping both double-fires for
-- company orders.)

DROP TRIGGER IF EXISTS trg_hde_notify_order_stage_insert ON public.hde_orders;
DROP TRIGGER IF EXISTS trg_hde_notify_order_stage_update ON public.hde_orders;
DROP FUNCTION IF EXISTS public.hde_notify_order_stage();

-- --- 3. Drop the redundant reminder cron job ───────────────────────────────
-- hde_remind_open_orders() (scheduled as 'hde-open-order-reminders') already
-- covers everything fn_hde_order_reminders() does, plus the 3-day creator
-- reminder it lacks. Keep the function itself (harmless if never called) but
-- stop it from running on its own schedule.

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hde-order-reminders') THEN
    PERFORM cron.unschedule('hde-order-reminders');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron unschedule skipped: %', SQLERRM;
END;
$do$;
