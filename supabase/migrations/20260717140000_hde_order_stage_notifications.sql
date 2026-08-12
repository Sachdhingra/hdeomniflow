-- Stage notifications + 2-day stage reminders for warehouse-request orders.
--
-- Flow: sales raises "Request from Warehouse" (order_type='company')
--   1. On creation  -> notify every accounts (and admin) user: approve it.
--   2. On approval  -> notify every service_head (and admin) user: get it done.
--   3. Stuck > 2 days in a stage -> daily reminder to the responsible role:
--        pending_approval            -> accounts/admin
--        approved / service_assigned -> service_head/admin
--      (the existing 3-day overall reminder to the creator stays)
--
-- Delivery is via the in-app notifications table; the OrderNotifier component
-- plays the ding-dong and shows the toast when a row arrives in realtime.

-- --- 1. Stage-change notifications ---

CREATE OR REPLACE FUNCTION public.hde_notify_order_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient uuid;
  v_product   text;
  v_creator   text;
BEGIN
  IF NEW.order_type <> 'company' THEN
    RETURN NEW;
  END IF;

  SELECT p.product_name INTO v_product
    FROM public.products p
   WHERE p.id = NEW.product_id;

  -- New warehouse request -> accounts (and admin) must approve
  IF TG_OP = 'INSERT' AND NEW.status = 'pending_approval' THEN
    SELECT pr.name INTO v_creator
      FROM public.profiles pr
     WHERE pr.id = NEW.created_by;
    FOR v_recipient IN
      SELECT DISTINCT ur.user_id FROM public.user_roles ur
       WHERE ur.role IN ('accounts'::app_role, 'admin'::app_role)
    LOOP
      INSERT INTO public.notifications (user_id, message, type, link)
      VALUES (
        v_recipient,
        'Warehouse request ' || NEW.order_number || ' (' || COALESCE(v_product, 'product') || ') raised by '
          || COALESCE(v_creator, 'sales') || ' - awaiting your approval.',
        'order_approval', '/inventory');
    END LOOP;
  END IF;

  -- Approved -> service head (and admin) must assign & complete the job
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'approved'
     AND OLD.status IS DISTINCT FROM 'approved'
  THEN
    FOR v_recipient IN
      SELECT DISTINCT ur.user_id FROM public.user_roles ur
       WHERE ur.role IN ('service_head'::app_role, 'admin'::app_role)
    LOOP
      INSERT INTO public.notifications (user_id, message, type, link)
      VALUES (
        v_recipient,
        'Order ' || NEW.order_number || ' (' || COALESCE(v_product, 'product')
          || ') approved by accounts - assign a field agent to get the job done.',
        'order_service', '/inventory');
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hde_notify_order_stage_insert ON public.hde_orders;
CREATE TRIGGER trg_hde_notify_order_stage_insert
  AFTER INSERT ON public.hde_orders
  FOR EACH ROW EXECUTE FUNCTION public.hde_notify_order_stage();

DROP TRIGGER IF EXISTS trg_hde_notify_order_stage_update ON public.hde_orders;
CREATE TRIGGER trg_hde_notify_order_stage_update
  AFTER UPDATE OF status ON public.hde_orders
  FOR EACH ROW EXECUTE FUNCTION public.hde_notify_order_stage();

-- --- 2. Reminders: add 2-day stage reminders to the daily job ---
-- Replaces hde_remind_open_orders() (from 20260717120000). Each reminder kind
-- has its own notification type so their daily dedupe guards don't collide.

CREATE OR REPLACE FUNCTION public.hde_remind_open_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r           RECORD;
  v_recipient uuid;
  v_days      integer;
  v_msg       text;
  v_type      text;
  v_count     integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accounts'::app_role))
  THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- -- 2a. Stage reminders: stuck > 2 days at approval or service stage
  FOR r IN
    SELECT o.id, o.order_number, o.status, o.created_at, o.approved_at, p.product_name
      FROM public.hde_orders o
      LEFT JOIN public.products p ON p.id = o.product_id
     WHERE (o.status = 'pending_approval' AND o.created_at < now() - interval '2 days')
        OR (o.status IN ('approved', 'service_assigned')
            AND COALESCE(o.approved_at, o.created_at) < now() - interval '2 days')
  LOOP
    IF r.status = 'pending_approval' THEN
      v_type := 'order_approval_reminder';
      v_days := FLOOR(EXTRACT(epoch FROM (now() - r.created_at)) / 86400)::integer;
      v_msg  := 'Order ' || r.order_number || ' (' || COALESCE(r.product_name, 'product')
                || ') has been awaiting APPROVAL for ' || v_days || ' days.';
    ELSE
      v_type := 'order_service_reminder';
      v_days := FLOOR(EXTRACT(epoch FROM (now() - COALESCE(r.approved_at, r.created_at))) / 86400)::integer;
      v_msg  := 'Order ' || r.order_number || ' (' || COALESCE(r.product_name, 'product')
                || ') has been awaiting SERVICE ACTION for ' || v_days || ' days.';
    END IF;

    FOR v_recipient IN
      SELECT DISTINCT ur.user_id FROM public.user_roles ur
       WHERE (r.status = 'pending_approval'
                AND ur.role IN ('accounts'::app_role, 'admin'::app_role))
          OR (r.status <> 'pending_approval'
                AND ur.role IN ('service_head'::app_role, 'admin'::app_role))
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.user_id = v_recipient
           AND n.type = v_type
           AND n.message LIKE 'Order ' || r.order_number || ' %'
           AND n.created_at > now() - interval '23 hours')
      THEN
        INSERT INTO public.notifications (user_id, message, type, link)
        VALUES (v_recipient, v_msg, v_type, '/inventory');
        v_count := v_count + 1;
      END IF;
    END LOOP;
  END LOOP;

  -- -- 2b. Overall reminder: open > 3 days -> creator + admin/accounts
  FOR r IN
    SELECT o.id, o.order_number, o.created_at, o.created_by, p.product_name
      FROM public.hde_orders o
      LEFT JOIN public.products p ON p.id = o.product_id
     WHERE o.status NOT IN ('completed', 'cancelled', 'rejected')
       AND o.created_at < now() - interval '3 days'
  LOOP
    v_days := FLOOR(EXTRACT(epoch FROM (now() - r.created_at)) / 86400)::integer;
    v_msg  := 'Order ' || r.order_number || ' (' || COALESCE(r.product_name, 'product')
              || ') has been open for ' || v_days || ' days - please complete, reject or cancel it.';

    FOR v_recipient IN
      SELECT DISTINCT u FROM (
        SELECT r.created_by AS u
        UNION
        SELECT ur.user_id FROM public.user_roles ur
         WHERE ur.role IN ('admin'::app_role, 'accounts'::app_role)
      ) x
      WHERE u IS NOT NULL
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.user_id = v_recipient
           AND n.type = 'order_reminder'
           AND n.message LIKE 'Order ' || r.order_number || ' %'
           AND n.created_at > now() - interval '23 hours')
      THEN
        INSERT INTO public.notifications (user_id, message, type, link)
        VALUES (v_recipient, v_msg, 'order_reminder', '/inventory');
        v_count := v_count + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hde_remind_open_orders() TO authenticated;

-- Run hourly so stage reminders land promptly once the 2-day mark is crossed;
-- the per-day dedupe above still caps delivery at one per order per recipient.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hde-open-order-reminders') THEN
    PERFORM cron.unschedule('hde-open-order-reminders');
  END IF;
  PERFORM cron.schedule(
    'hde-open-order-reminders',
    '15 * * * *',
    $cron$ SELECT public.hde_remind_open_orders(); $cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END;
$do$;
