# Repair WhatsApp Follow-up Circuit

## Goal
Make the approved YES/NO WhatsApp follow-up work end to end: valid Indian numbers, reliable delivery tracking, captured replies, and immediate routing to the assigned salesperson.

## Confirmed findings
- Meta has approved the active YES/NO follow-up template, and the live sender has a high quality rating.
- The live sender is already pointed at the correct OmniFlow inbound and delivery-status endpoints.
- Twilio received seven missed YES/NO replies, but callback error `11200` prevented OmniFlow from recording them.
- Duplicate country prefixes can produce invalid destinations unless every send path uses one shared Indian-number normalizer.

## Implementation
1. **Standardize phone handling**
   - Use the shared Indian phone normalizer across WhatsApp follow-ups, mirrored notifications, inbound matching, and WhatsApp OTP.
   - Convert valid inputs to exactly `+91` plus the final ten-digit Indian mobile number.
   - Reject invalid numbers before contacting Twilio and retain clear failure details for outreach reporting.

2. **Harden and deploy callbacks**
   - Keep Twilio signature verification, accepting the exact public callback URL Twilio signs.
   - Parse inbound messages and status callbacks independently and log callback receipt, matching, and database failures.
   - Deploy `twilio-webhook`, `twilio-status`, `send-whatsapp`, and the affected OTP function with public webhook JWT settings preserved.

3. **Restore missed replies**
   - Add an idempotent recovery migration for the seven known Twilio replies, keyed by provider message ID.
   - Match each reply to the latest lead by the normalized final ten digits.
   - Apply the same live reply behavior: YES marks the lead interested and urgent; NO pauses automation and requests the reason.
   - Create the corresponding assigned-salesperson notification and lead alert without duplicates.

4. **Verify the complete circuit**
   - Confirm the approved template SID remains active for manual and automatic follow-ups.
   - Test a signed inbound-style callback and a delivery-status callback against the deployed functions.
   - Verify recovered replies appear in lead conversations, Kanban priority states, salesperson alerts, and outreach reply metrics.
   - Confirm future numbers containing repeated `91` prefixes are sent and matched canonically.

## Technical notes
- Recovery will be safe to rerun because `provider_message_id` is unique for inbound messages.
- The admin-only push-notification setup popup will not be changed.
- Provider errors `63049`, `63024`, and `63032` will remain visible as recipient/provider delivery failures rather than being counted as successful outreach.
