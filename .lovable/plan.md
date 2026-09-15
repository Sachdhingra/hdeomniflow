# Make staff notifications one-click and reliable

## Goal
Replace the fragile automatic retry loop with one clear activation action that either connects the phone or gives a useful recovery message promptly.

## Changes
- Keep background reconciliation only for phones that are already connected; never trigger the browser permission flow automatically.
- Make the visible button the single setup entry point: start the provider, request permission, subscribe, and save the phone against the signed-in staff member.
- Add time limits and subscription-state listeners so setup cannot remain on “Connecting device…” indefinitely.
- Reuse the existing notification worker safely and identify the signed-in staff account with the push provider.
- Remove focus/visibility retry races and show concise status-specific guidance when the browser blocks or cannot complete setup.

## Verification
- Confirm the app builds cleanly.
- Test default, granted, denied, timeout, and successful subscription states on a phone-sized preview.
- Confirm repeated taps share one attempt and an already-connected phone is restored without another prompt.
