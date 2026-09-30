# Add the YES lead-to-deal pipeline

## Goal
Turn every customer who replies YES into a visible, owned sales journey with stage dates, a due next step, and a complete path to Won or Lost.

## Pipeline
`YES received → Contacted → Visit booked → Quote sent → Negotiation → Won / Lost`

## What will change
1. Add a dedicated **Lead-to-Deal** page for Admin and Sales, with one column per stage and access from the main navigation.
2. Include only genuine interested leads (`follow_up_reply_state = interested`), preserving the assigned salesperson and current customer/product/value details.
3. Show on every deal card:
   - YES-received date and current-stage date
   - assigned salesperson
   - requested product and expected value
   - next-step text and due date
   - overdue state and latest customer reply
4. Let Admin and the assigned salesperson move a deal, set its next step/date, call the customer, open full lead details, and mark Won or Lost.
5. Add a compact deal timeline so each stage change records when it happened, who changed it, and the next step at that time.
6. Advance stages partly automatically:
   - a genuine YES creates **YES received**
   - a recorded customer contact moves it to **Contacted**
   - an existing site visit moves it to **Visit booked**
   - an existing quote moves it to **Quote sent**
   - lead status `negotiation` moves it to **Negotiation**
   - lead status `won`/`converted` or `lost` closes it accordingly
7. Backfill current YES leads into the new pipeline without changing their normal lead status or sending any customer messages.

## Technical details
- Add a deal record and immutable stage-history records linked to the existing lead; apply authenticated grants and row-level access matching existing lead ownership, with Admin access to all.
- Use database triggers for reliable YES creation and status/visit/quote advancement; manual changes remain available for corrections.
- Keep inbound WhatsApp rows as the source of truth for YES and latest replies.
- Preserve the current 24-hour outreach cap and stop-after-NO behavior.
- Add the new page to existing role routes and navigation; reuse current lead details and design-system controls.
- Verify Admin and Sales visibility, manual stage/next-step updates, automatic advancement, overdue display, and mobile/desktop layouts.
