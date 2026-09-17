# Staff push setup (OmniFlow)

Staff alerts — chat messages, lead assignments, order updates — reach a phone
with the app closed by going out through OneSignal. This is what has to be
configured for that to work, and the failure mode when it is not.

## The rule that drives everything

**OneSignal binds one site origin per web-push app.** An app whose origin is a
different site cannot subscribe a device on OmniFlow's origin. The SDK fetches
the app config, sees the origin does not match the page, and stops before it
builds its subscription internals — then the next `login()` or `optIn()`
dereferences those internals and dies inside the minified CDN bundle:

```
Device registration did not complete: Cannot read properties of undefined (reading 'Qe')
```

That message means the app ID is wrong (or its origin is), not that the phone
or the browser permission is at fault. It is unrelated to
`Notification.permission`, which is why staff saw "Permission is allowed" and
still never registered.

OmniFlow therefore needs its **own** OneSignal app. It cannot share the Insider
customer app (`4e6e57c1-7555-4f05-81e2-efdb9d6e19d4`), whose origin is
`https://homedecorinsider.lovable.app`. That app ID is rejected by name in both
`src/lib/push.ts` and `supabase/functions/send-staff-push/index.ts`.

## What to configure

| Where | Name | Value |
| --- | --- | --- |
| `.env` (public, ships in the bundle) | `VITE_ONESIGNAL_STAFF_APP_ID` | Staff OneSignal app ID |
| Supabase edge-function secrets | `ONESIGNAL_STAFF_APP_ID` | The **same** app ID |
| Supabase edge-function secrets | `ONESIGNAL_STAFF_API_KEY` | That app's REST API key |
| Supabase vault or `app.loyalty_cron_secret` | `LOYALTY_CRON_SECRET` | Must match the edge function's env var |

The two app IDs must name the same app. A device subscribes against the
client's app, so a mismatch means every send targets player IDs the sending app
has never heard of, and OneSignal answers `invalid_player_ids` — a silent
failure, since the triggers deliberately never abort the write that caused them.

In the OneSignal dashboard the staff app's **Web Push** platform must have its
site origin set to exactly the URL staff open, scheme included, with no
trailing path.

## Checking it end to end

1. A staff member opens the app. `staff_push_devices` should gain a row for
   their `user_id` with `push_enabled = true`.
2. No row, and the in-app banner names the reason — it reports the first
   failure now, not a generic wrapper.
3. For detail on a real phone, set `localStorage.omniflow_push_debug = "1"` in
   the browser console and reload; the OneSignal SDK then logs at trace level.

## Why a send can still go nowhere

- `push_automation_settings.staff_alerts` is off — `_staff_push_enabled()`
  short-circuits both triggers.
- `LOYALTY_CRON_SECRET` differs between the database and the edge function —
  `send-staff-push` answers 401 and `_invoke_staff_push` only raises a warning.
- The `net.http_post` target in the trigger points at a different Supabase
  project than the one actually running the app.
