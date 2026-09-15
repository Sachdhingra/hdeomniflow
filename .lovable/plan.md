# Repair staff push registration

## Goal
Make an allowed notification permission produce a registered OmniFlow staff device, so staff broadcasts can be sent.

## Changes
- Allow OmniFlow’s push provider scripts, connections, and worker resources through the site security policy.
- Make registration retry when the installed app returns to the foreground, covering devices that granted permission before registration completed.
- Stop hiding registration failures internally so the on-screen notification prompt can accurately guide the user.
- Verify registration behavior, the app check, and the staff-device count without sending a broadcast.

## Technical details
- Keep the existing OneSignal staff app and shared root service worker.
- Preserve authenticated device ownership through the existing `register_staff_push_device` function.
- Do not change notification permissions or customer push behavior.
