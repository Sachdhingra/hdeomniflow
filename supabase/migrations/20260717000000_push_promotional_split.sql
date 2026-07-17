-- Promotional / transactional push split
--
-- app_users.push_enabled now gates PROMOTIONAL pushes only (admin broadcasts
-- and the dormant win-back reminder). Account/loyalty pushes — points expiry,
-- redemption reminders, card expiry, birthday and anniversary messages — are
-- always delivered. Enforced in the send-push and broadcast-push edge
-- functions; the Insider app labels the toggle "Offers & Promotions".

COMMENT ON COLUMN public.app_users.push_enabled IS
  'Customer opt-in for PROMOTIONAL pushes only (broadcasts, win-back). Account/loyalty pushes are always delivered.';

UPDATE public.push_automation_settings
   SET description = 'Sent to customers with no purchase in the last 180 days (max once per 30 days). Promotional: skips customers who turned off Offers & Promotions.'
 WHERE key = 'dormant';
