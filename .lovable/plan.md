# Staff push sign-in enrolment

## Goal
Ensure every staff phone signs into OmniFlow and completes notification setup before normal use, while already-registered phones continue without interruption.

## Changes
- Stop the sign-in startup process from unregistering OmniFlow's notification worker.
- Automatically initialise and bind the current signed-in staff account to that phone's push subscription.
- When browser permission or device registration is incomplete, show a persistent setup prompt after sign-in with one clear action and status-specific recovery guidance.
- Do not offer a seven-day dismissal while the device remains unregistered; hide the prompt only after registration succeeds.
- Keep retrying safely when the app returns to the foreground or reconnects.

## Verification
- Confirm the app builds cleanly.
- Test signed-in startup, successful registration state, permission-blocked state, and retry behavior on mobile-sized preview.
- Confirm the notification worker remains registered after authentication starts.
