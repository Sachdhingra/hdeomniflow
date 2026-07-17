
-- Follow-up to 20260717020000_hde_safe_inventory_movement:
--
--   1. Legacy reconciliation — orders created BEFORE the safe-movement
--      migration were deducted client-side with no audit entry, so the new
--      reversal triggers skip them. Seed the missing 'sale_deduction' audit
--      entries (making legacy open orders eligible for auto-restore on
--      reject/cancel/delete) and restore stock for legacy orders that were
--      already rejected/cancelled without ever being restored.
--   2. Audit inventory row deletions — "Remove from Inventory" deleted rows
--      with no trace, which is how articles could vanish without explanation.
--   3. Daily reminders to the order creator (sales) + admin/accounts for
--      orders open for more than 3 days.

-- ─── 1a. Seed sale_deduction audit entries for legacy sale orders ────────────
-- Any warehouse/showroom order without a sale_deduction entry predates the
-- trigger; its deduction happened client-side. Recording it retroactively
-- makes the reject/cancel/delete restore triggers work for these orders too.

INSERT INTO public.inventory_audit_log
  (product_id, action, quantity_change, location_id, service_job_id, created_by, reason, created_at)
SELECT
  o.product_id, 'sale_deduction', -GREATEST(1, COALESCE(o.qty_sold, 1)),
  o.location_id, o.id, o.created_by,
  'Backfill: legacy client-side deduction for ' || o.order_number, o.created_at
FROM public.hde_orders o
WHERE o.order_type IN ('warehouse', 'showroom')
  AND o.location_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_audit_log al
     WHERE al.service_job_id = o.id AND al.action = 'sale_deduction');

-- ─── 1b. Restore stock for legacy rejected/cancelled orders ──────────────────
-- These were deducted at creation but never restored (the leak fixed by the
-- safe-movement migration). Idempotent via the sale_reversal audit guard.

DO $do$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT o.*
      FROM public.hde_orders o
     WHERE o.order_type IN ('warehouse', 'showroom')
       AND o.status IN ('rejected', 'cancelled')
       AND o.location_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.inventory_audit_log al
          WHERE al.service_job_id = o.id AND al.action = 'sale_deduction')
       AND NOT EXISTS (
         SELECT 1 FROM public.inventory_audit_log al
          WHERE al.service_job_id = o.id
            AND al.action IN ('sale_reversal', 'sale_reversal_on_delete'))
     ORDER BY o.created_at
  LOOP
    PERFORM public.hde_apply_inventory_delta(
      r.product_id, r.location_id,
      GREATEST(1, COALESCE(r.qty_sold, 1)),
      'sale_reversal', COALESCE(r.rejected_by, r.created_by), r.id,
      'Backfill: order ' || r.order_number || ' ' || r.status || ' — stock restored');
  END LOOP;
END;
$do$;

-- ─── 2. Audit trail for inventory row deletions ──────────────────────────────
-- "Remove from Inventory" (card + stock table) deletes hde_inventory rows.
-- Log each deleted row so a missing article can always be traced and re-added.

CREATE OR REPLACE FUNCTION public.handle_hde_inventory_row_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.inventory_audit_log
    (product_id, action, quantity_change, location_id, created_by, reason)
  VALUES (
    OLD.product_id, 'inventory_row_deleted', -OLD.quantity, OLD.location_id, auth.uid(),
    'Inventory row deleted (article removed from tracking) — had ' || OLD.quantity || ' units');
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_hde_inventory_row_delete ON public.hde_inventory;
CREATE TRIGGER trg_hde_inventory_row_delete
  BEFORE DELETE ON public.hde_inventory
  FOR EACH ROW EXECUTE FUNCTION public.handle_hde_inventory_row_delete();

-- ─── 3. Daily reminders for orders open > 3 days ─────────────────────────────
-- Notifies the order creator (salesperson) plus every admin and accounts user
-- via the in-app notifications bell. Max one reminder per order per recipient
-- per day. Runs daily via pg_cron; admins can also fire it manually via RPC.

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
  v_count     integer := 0;
BEGIN
  -- Manual invocation is limited to admin/accounts; pg_cron (no auth context)
  -- always passes.
  IF auth.uid() IS NOT NULL
     AND NOT (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'accounts'::app_role))
  THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  FOR r IN
    SELECT o.id, o.order_number, o.created_at, o.created_by, p.product_name
      FROM public.hde_orders o
      LEFT JOIN public.products p ON p.id = o.product_id
     WHERE o.status NOT IN ('completed', 'cancelled', 'rejected')
       AND o.created_at < now() - interval '3 days'
  LOOP
    v_days := FLOOR(EXTRACT(epoch FROM (now() - r.created_at)) / 86400)::integer;
    v_msg  := 'Order ' || r.order_number || ' (' || COALESCE(r.product_name, 'product')
              || ') has been open for ' || v_days || ' days — please complete, reject or cancel it.';

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

-- Schedule daily at 03:30 UTC (09:00 IST)
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hde-open-order-reminders') THEN
    PERFORM cron.unschedule('hde-open-order-reminders');
  END IF;
  PERFORM cron.schedule(
    'hde-open-order-reminders',
    '30 3 * * *',
    $cron$ SELECT public.hde_remind_open_orders(); $cron$
  );
EXCEPTION WHEN OTHERS THEN
  -- pg_cron may not be available in local dev; skip silently.
  RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END;
$do$;
