# Customer notification inbox (24-hour feed)

Goal: every notification sent to an HD Insider customer — plain text, banner, or offer — appears on the app's main page for 24 hours, can be tapped to read the full message inside the app, and then disappears completely.

The Insider customer app is a separate project, so this work prepares the shared backend feed. Once approved, ask me in the Insider project to add the on-screen list; it will read this feed with no further backend work.

## What gets stored

Every send already writes one row per customer to the notification log. That log gains the extra pieces the app needs to display a notification properly:

- Banner image and tap link, so banners and offers look the same in the app as on the phone
- Offer code and offer expiry, forwarded from the campaign
- The moment it was opened, so unopened ones can be highlighted with a dot/badge
- An expiry stamp set to 24 hours after sending

## What the customer sees (rules the backend enforces)

- A customer can read only their own notifications, and only those sent within the last 24 hours. Older ones stop being returned, so they vanish from the app on their own.
- A customer can mark their own notification as opened; they cannot change its text.
- Staff and admin keep the reporting view they have today, including older entries.

## Housekeeping

A daily cleanup removes notification rows older than 30 days so the table does not grow forever. Customers already stop seeing them at 24 hours; the extra window only keeps short-term admin reporting intact.

## Technical section

1. Migration on `public.push_notifications_log`:
   - Add `image_url text`, `link_url text`, `offer_code text`, `offer_expires_at timestamptz`, `opened_at timestamptz`, `expires_at timestamptz default now() + interval '24 hours'`, `campaign_id uuid references push_campaigns(id)`.
   - Backfill `expires_at = sent_at + interval '24 hours'` for existing rows.
   - Index on `(customer_id, sent_at desc)`.
   - Grants: `GRANT SELECT, UPDATE ON public.push_notifications_log TO authenticated;` (existing admin/accounts grants unchanged).
   - New policies using the existing helper `get_loyalty_customer_id(auth.uid())`:
     - select: `customer_id = get_loyalty_customer_id(auth.uid()) AND sent_at > now() - interval '24 hours'`
     - update: same predicate, with a trigger that rejects any change other than `opened`/`opened_at`.
2. `broadcast-push`: include `image_url`, `link_url`, `offer_code`, `offer_expires_at`, `campaign_id` in the per-customer log rows it already inserts.
3. `send-push`: store the optional `data` payload's `image_url`/`link_url` on the log row so single sends behave the same.
4. Cleanup: extend the existing `loyalty-cron` daily run with a delete of `push_notifications_log` rows older than 30 days.
5. No OmniFlow UI changes; `AdminPushNotifications` continues to work unchanged.
