# Lead Board + WhatsApp Outreach Control Centre

## Goal
Make the automatic lead engine transparent and safe: show exactly which WhatsApp messages went out, delivery/read/reply performance, where replies arrived, and what needs staff attention.

## What will change

### 1. One reliable WhatsApp conversation record
- Store the Twilio message ID on every lead message, including manual outreach and automatic nurture sends.
- Update delivery, read, failed, and undelivered states by exact message ID rather than guessing from the latest message to a phone number.
- Prevent duplicate lead-message rows currently created by the outreach screen and the sending function.
- Record failed manual outreach in the lead history, not only in the generic provider log.

### 2. Reliable inbound reply capture
- Match inbound WhatsApp replies against all active and historical leads by normalized phone number, not only the latest 50 leads.
- Attach each reply to the correct lead and preserve text/media placeholders, sentiment, intent, concern, and response time.
- Create a visible “new WhatsApp reply” notification for the assigned salesperson/admin.
- Keep unmatched replies in a visible exception list so no customer response disappears silently.

### 3. Lead board visibility
- Add clear WhatsApp indicators on lead cards: last outbound state, new reply, reply time, and needs attention.
- Mark a reply seen when staff opens that lead’s conversation.
- Keep the complete inbound/outbound WhatsApp timeline inside the lead details, including delivery and failure reasons.

### 4. Outreach performance dashboard
- Upgrade Follow-up Outreach with 7-day and 30-day totals for sent, delivered, read, replied, failed, and reply rate.
- Add filters for automatic vs manual outreach, lead stage, salesperson, and date.
- Show recent replies and failed/unmatched messages with direct access to the relevant lead.
- Add a per-lead recent-send check so the same follow-up template cannot be sent twice within 24 hours.

### 5. Automatic engine controls and safety
- Show that the engine is active and display its actual schedule and last successful run.
- Keep the existing twice-daily automatic runs, while making the send rules and latest outcome visible.
- Ensure automatic sends use an approved WhatsApp template outside the 24-hour customer-service window; free-form messages will not be attempted when WhatsApp would reject them.
- Correct unanswered-message counting so leads are escalated only after successful outbound sends, then reset when a reply arrives.

## Technical details
- Add narrowly scoped database fields/indexes for provider message IDs and reply-seen state, with existing role-based access preserved.
- Update `send-whatsapp`, `nurture-engine`, `twilio-webhook`, and `twilio-status` so all paths share the same logging and status model.
- Update the lead board, lead details, outreach page, and automation monitor to read that unified data.
- Deploy the changed cloud functions and verify live webhook, scheduled-run, delivery/read, reply, deduplication, and mobile layouts.

## Current findings to preserve during the fix
- WhatsApp sending itself is operational.
- The nurture engine is active twice daily at 6:00 PM and 8:00 PM India time.
- In the last 30 days, lead history contains 308 outbound records but no inbound records, so inbound webhook routing or matching needs correction and live verification.
