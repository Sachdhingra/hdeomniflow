# Repair lead outreach and make it conversion-led

## Goal
Restore reliable daily outreach, show the real results, and give each salesperson a focused list of customers to contact instead of repeatedly messaging everyone.

## Current findings
- The approved YES/NO WhatsApp template is live; Meta approval is not the blocker.
- 355 outbound messages were attempted in 30 days, but only 130 reached customers as delivered/read.
- Four genuine customers replied; the screen incorrectly reports zero because it counts an unreliable outbound flag instead of inbound replies.
- The scheduled engine has returned authorization errors since September 20, so no new automatic messages have gone out.
- 400 open leads have never received an OmniFlow follow-up, while 53 have already been contacted three or more times.
- Most failed deliveries are Meta recipient filtering, so repeatedly sending WhatsApp alone will not recover those customers.

## Changes
1. Repair the 6 PM and 8 PM scheduled authorization and verify a live engine run.
2. Correct performance reporting to count actual inbound replies and unique replying customers; show reached rate and reply rate from reached messages.
3. Prioritize outreach into three actionable groups:
   - New/uncontacted customers with a valid number.
   - Customers who read WhatsApp but did not reply, for a salesperson call.
   - Interested/replied customers requiring immediate salesperson action.
4. Stop blanket daily repetition: contact a customer at most once in 24 hours, escalate after repeated non-response, and avoid continuing automation after a clear NO.
5. Make each lead card show the latest delivery result and the next recommended action: WhatsApp, call, or respond now.
6. Verify the full path with live data: scheduled send, delivery status, reply count, salesperson ownership, and board visibility.

## Technical details
- Use inbound `lead_messages` as the source of truth for replies and associate each reply with the most recent preceding outbound message for campaign reporting.
- Keep the existing approved Twilio template and phone normalization.
- Preserve role-based lead visibility and existing salesperson assignments.
- Do not send a new bulk batch during the repair; the repaired engine will resume only after validation to avoid accidental duplicate messages.
