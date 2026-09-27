# Project architecture rules

- Lead outreach performance uses inbound message rows as reply truth; outbound response flags are supporting attribution only, because inbound capture is the auditable customer action.
- Automated WhatsApp runs remain capped at one follow-up per lead per 24 hours and must stop after a clear negative reply, preventing repeated unwanted contact.
