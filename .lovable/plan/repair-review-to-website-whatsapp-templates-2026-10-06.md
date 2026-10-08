# Repair review-to-website WhatsApp templates

## Outcome
Make the kiosk feedback, Google-review draw, website enquiry, and follow-up WhatsApp paths use approved templates and record delivery outcomes reliably.

## Changes
- Repair the live kiosk queue schema so it matches the deployed feedback sender and can distinguish welcome and draw-winner messages.
- Create and connect the complete rating-aware kiosk template set: positive feedback includes the review ask; neutral and negative feedback do not.
- Create the monthly draw-winner template and store all approved template IDs in app settings.
- Keep website enquiries routed to the assigned salesperson or showroom through the approved staff alert template; verify recent delivery records.
- Harden template configuration checks so missing IDs fail visibly instead of silently falling back to business-initiated plain text.
- Validate template approval states, queue processing, function logs, and the preview build. No bulk customer messages will be sent during testing.

## Technical details
- Add an additive database migration for the missing queue columns, indexes, settings, and current trigger/schedule definitions.
- Update `feedback-whatsapp` to select the rating-appropriate Content SID and reject unconfigured business-initiated sends.
- Use Twilio Content API approval records as the source of truth for template status.
