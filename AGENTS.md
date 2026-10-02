# Project architecture rules

- Lead outreach performance uses inbound message rows as reply truth; outbound response flags are supporting attribution only, because inbound capture is the auditable customer action.
- Automated WhatsApp runs remain capped at one follow-up per lead per 24 hours and must stop after a clear negative reply, preventing repeated unwanted contact.

- Lead-to-deal progression is stored separately from broad lead status, because commercial stage dates and next actions require their own auditable lifecycle.
- Signed-out kiosk review confirmations pass through a validating edge function; the elevated database action is service-role-only to protect customer records.
