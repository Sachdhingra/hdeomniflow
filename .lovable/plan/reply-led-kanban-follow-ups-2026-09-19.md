# Reply-led Kanban follow-ups

## Goal
Make every follow-up easy to answer, recognize clear customer intent, and immediately place interested customers in front of their assigned salesperson.

## Customer follow-up
- Replace the generic follow-up with a short, product-specific question asking the customer to reply **YES** or **NO**.
- Keep the current approved message active until the new WhatsApp template is approved, so outreach is not interrupted.
- Apply the same reply-led wording to manual outreach and automatic Kanban follow-ups.
- Keep the existing 24-hour duplicate-send protection.

## Reply logic
- Treat exact replies such as Yes/Haan/Interested as positive interest, without loose substring matches.
- Treat No/Nahi/Not interested as a negative reply.
- For a negative reply, send one short follow-up asking whether the reason is **price, timing, or product**, then pause further automatic nudges until the salesperson reviews it.
- Continue recording longer questions and objections with the existing conversation analysis.

## Salesperson action flow
- Route every matched reply to `assigned_to`, falling back to the lead creator only when unassigned.
- Positive replies create a high-priority app alert and phone push for that salesperson, linked to the lead.
- Positive replies move to the front of their Kanban stage with a prominent **Interested — reply now** badge.
- Negative replies show **Reason requested** and remain visible for review rather than being closed or moved to Lost.
- Opening the lead marks the reply seen and resolves its reply alert as today.

## Reliability
- Use one shared inbound intent result across Twilio reply logging, lead status updates, alerts, and the Kanban display.
- Do not mark negative replies as active interest or automatically revive dead leads.
- Prevent duplicate unresolved reply alerts and duplicate “reason” questions.
- Preserve reply ownership so other salespeople do not receive another salesperson’s customer alert.

## Verification
- Test Yes, No, Hinglish variants, questions, and unrelated short replies.
- Verify assigned salesperson alert, phone push request, priority ordering, badge state, and negative-reason follow-up.
- Deploy the WhatsApp webhook and notification function changes, then confirm the app check is clean on desktop and mobile.
