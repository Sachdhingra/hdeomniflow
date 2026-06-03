## Goal
Upgrade OmniFlow chat from basic DM/realtime to a full-featured workspace messenger, and make new-message arrival impossible to miss.

I'll split delivery into 4 turns so each turn stays reviewable (each phase = 1 migration + matching UI). After you approve this plan, I'll start Turn 1 immediately. You can pause between turns.

---

## Turn 1 — Loud Ding-Dong + Visual Flash + Unread Badges (quick wins)
No DB changes.
- Replace soft 880Hz sine in `ChatNotifier.tsx` with a two-tone (E5→C5) ding-dong, ~3× louder, with subtle reverb tail.
- Add a full-screen `ChatArrivalFlash` overlay: 600ms pulsing border + floating sender pill at top-center on every incoming message (everywhere in app, not just /chat).
- Sidebar chat nav already has unread count via `ChatUnreadContext` — surface it more prominently (red pill, pulse on increment) and add per-channel unread badges in `ChatPage` channel list.

## Turn 2 — Phase 1 Essentials (presence, read receipts, search, pinned)
One migration:
- `user_presence` (user_id PK, status, last_activity)
- `message_reads` (message_id, user_id, read_at) — unique pair
- `pinned_messages` (channel_id, message_id, pinned_by, pinned_at) — max 5 enforced in client
- Index on `chat_messages(channel_id, body)` for search
- RLS + GRANTs for all
UI:
- Presence dot (🟢🟡🔴) on sender avatars in chat list + DM directory, driven by Realtime presence channel + 5-min idle timer
- ✓ / ✓✓ / ✓✓(blue) ticks on outbound messages based on `message_reads`
- Pinned bar at top of each channel with pin/unpin actions (admin + sender can pin)
- Search bar in `ChatPage` filtering by keyword, sender, date

## Turn 3 — Phase 2 Essentials (reactions, mentions, edit/delete, typing, away)
One migration:
- `message_reactions` (message_id, user_id, emoji) unique triple
- `user_status` (user_id PK, is_away, away_message)
- Add `chat_messages.edited_at`, `parent_message_id`, `mentions text[]`
UI:
- Hover reaction picker (👍❤️😂🎉⏰🚨) with aggregated counts
- @mention autocomplete from `allProfiles`; mentioned users get a notification row + louder ping
- Edit (15-min window) / Delete buttons on own messages; "Edited" tag
- Typing indicator via Realtime broadcast channel (no DB)
- Away message editor in profile menu; shown as banner when DM'ing an away user
- Markdown rendering: **bold**, *italic*, `code`, > quote, - lists

## Turn 4 — Phase 3 (threads, channel polish, export, moderation)
One migration:
- Use `parent_message_id` from Turn 3 for threads
- `chat_moderation_log` (action, target_message, moderator, reason)
UI:
- Thread side-panel opened from any message's "Reply in thread"
- Channels page: create/join/leave (admin can create); default channels already exist
- Export channel as CSV/PDF (client-side, admin only)
- Admin moderation: delete any message, mute user (writes to `user_status`), view log

---

## Technical notes
- Realtime: enable `supabase_realtime` publication for new tables that need live updates (`message_reactions`, `message_reads`, `pinned_messages`, `user_presence`).
- Presence: use Supabase Realtime Presence channel (`chat-presence`) rather than DB polling for 🟢/🟡 — DB row only stores last_activity for stale fallback.
- Audio: keep WebAudio (no asset upload needed) — two oscillators E5(659Hz) then C5(523Hz), gain 0.45, 180ms apart, with 0.6s exponential decay. Respects existing `sharedAudioCtx`.
- Visual flash: portal-mounted div, `pointer-events-none`, uses `--primary` token + tailwind keyframes.
- All new tables: `authenticated` SELECT/INSERT/DELETE scoped via `is_chat_member()` security definer; `service_role` ALL.

## Scope guardrails
- Won't touch `src/integrations/supabase/client.ts` or `types.ts` (auto-gen).
- Won't change auth, leads, service jobs, inventory, or any non-chat module.
- Will pause and ping you for confirmation between each turn unless you say "keep going".

Ready to start Turn 1 on approval.