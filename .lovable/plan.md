# Fix notification activation

## Goal
Make the notification setup button connect the staff phone instead of reporting that the notification service is already initialized.

## Changes
- Use one shared initialization attempt for the notification provider, including React development remounts and button retries.
- Treat an already-running provider as ready rather than as a failed registration.
- Prevent overlapping automatic, focus, and button-triggered registration attempts.
- Keep the existing permission guidance and staff-device ownership checks.

## Verification
- Confirm the app builds cleanly.
- Verify repeated setup attempts do not initialize the provider twice.
- Verify the button reaches device subscription and save steps without the shown error.
