# Fix Twilio test delivery

## Outcome
Make the admin test send behave like a real business-initiated WhatsApp message and report its actual delivery result.

## Changes
- Replace the plain-text test with the already approved YES/NO WhatsApp template.
- Keep the test recipient and message clearly identifiable in message history.
- Stop presenting Twilio acceptance as delivery; show that the message was submitted and direct the final delivered/failed status through the existing callback tracking.
- Verify recent actual sends against final Twilio statuses and test the updated flow.

## Technical details
- Update the Automation Monitor test action to call `send-whatsapp` with the approved Content SID and valid variables.
- Preserve the existing `twilio-status` callback path and `message_logs` status updates.
- No credential, schedule, or customer-message changes are included.
