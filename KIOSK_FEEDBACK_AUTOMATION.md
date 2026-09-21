# Kiosk WhatsApp welcome, Google review ask & monthly lucky draw

How a showroom visit turns into a WhatsApp message, a Google review and a draw entry.

## The flow

1. Customer fills the kiosk (`/kiosk/feedback`) and taps **Submit Feedback**.
2. The kiosk calls `submit_kiosk_feedback()`, which inserts the row and returns its id.
3. `trg_customer_feedback_thank_you` queues a row in `pending_thank_you_messages`
   and pokes the `feedback-whatsapp` edge function through `pg_net` — the
   WhatsApp lands within seconds of the customer typing their number.
4. `feedback-whatsapp` composes the message
   (`supabase/functions/_shared/kiosk-messages.ts`) and sends it via
   `send-whatsapp`. A `*/5 * * * *` cron re-runs the same function as a safety
   net; anything still queued after 24 hours is dropped rather than sent late.
5. On the thank-you screen the customer scans the Google review QR (generated
   live from `google_review_url`) and taps **I've left my review**, which calls
   `record_google_review()` — that marks the feedback and creates the customer's
   entry for the month in `review_draw_entries`.
6. `monthly-review-draw` runs daily on the 1st–7th at 10:00 IST and calls
   `fn_run_monthly_draw()`. It draws a winner for the month that just closed
   **only if that month has at least `monthly_draw_min_entries` (50) entries**,
   records it in `monthly_draws`, and queues the winner's WhatsApp.
7. Admin → **Customer Feedback** shows the draw panel: entries so far this
   month against the threshold, last month's winner, past winners, a **Run draw
   now** button and **Resend winner message**.

## Message wording

All copy lives in `supabase/functions/_shared/kiosk-messages.ts` and is covered
by `src/test/kioskMessages.test.ts` — edit it there, not in SQL.

| Overall rating | What goes out |
| --- | --- |
| 1–2 ★ | Apology, "tell us what went wrong", phone number. **No review ask** — asking an unhappy customer for a public review is how you get a one-star review. |
| 3 ★ | Thank you plus an open "what could we have done better?". |
| 4–5 ★ | Thank you, Google review link, lucky-draw explainer (prize + the 50-entry rule). |
| 4–5 ★, already reviewed | Thanks them for the earlier review instead of asking again, and confirms the draw. |

## Settings (Admin → app_settings)

| Key | Meaning |
| --- | --- |
| `google_review_url` | Review link. Drives both the QR and the message. Blank/`REPLACE_ME` = no review ask. |
| `business_name`, `business_phone` | Used in the message body. |
| `monthly_draw_enabled` | `false` switches the draw off; review asks continue. |
| `monthly_draw_min_entries` | Entries needed before a month is drawn. Default `50`. |
| `monthly_draw_prize` | Prize wording shown on the kiosk and in both messages. |
| `kiosk_welcome_content_sid` | Twilio Content SID for the welcome — vars `{{1}}` first name, `{{2}}` review URL. |
| `draw_winner_content_sid` | Twilio Content SID for the winner — vars `{{1}}` first name, `{{2}}` month, `{{3}}` prize. |

## To go live

1. Apply the migration and deploy the function:
   `supabase functions deploy feedback-whatsapp`.
2. Make sure `LOYALTY_CRON_SECRET` is set as an edge-function secret **and** is
   reachable from the database — either in vault as `LOYALTY_CRON_SECRET` or as
   the `app.loyalty_cron_secret` setting. Without it the trigger cannot poke the
   function and messages only go out on the 5-minute cron.
3. Confirm `pg_cron` and `pg_net` are enabled (they already are for
   `loyalty-daily-cron`).
4. **WhatsApp templates.** Meta blocks business-initiated free text outside the
   24-hour session window (Twilio error 63016). Until approved templates are in
   place the welcome will only reach customers who have messaged the business in
   the last 24 hours. Get the two templates approved, then paste their Content
   SIDs into the settings above — the function switches to templates
   automatically and keeps the free-text body as the log record.
5. Set `monthly_draw_prize` to the actual prize before announcing the scheme in
   the showroom.

## Fairness rules built in

- One entry per phone number per month (`uq_review_draw_entry_month_phone`).
- No draw below the entry threshold, and the threshold is stated in the message
  the customer receives.
- A completed draw freezes the entry count it was drawn from.
- Drawing below the threshold needs an explicit **Draw anyway** confirmation and
  is recorded in `monthly_draws.notes`.
