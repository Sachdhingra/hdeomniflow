# Omni-channel sales bot: setup

One answer engine for every customer inbox. The bot answers from the Godrej Interio range as published on the HDE website (hdefurniture.netlify.app, generated from interio.com), so its products and prices match the site.

## What is built

| Piece | Path | Role |
|---|---|---|
| Catalogue | `supabase/functions/_shared/omni-bot/catalog.ts` | Reads `/assets/js/catalog.js` from the website, ranks products (Hinglish-aware) |
| Prompt | `supabase/functions/_shared/omni-bot/prompt.ts` | Channel-neutral sales instructions and HDE store facts |
| Engine | `supabase/functions/_shared/omni-bot/core.ts` | Claude tool loop: `search_products`, `get_product_details`, `send_enquiry` |
| Bot API | `supabase/functions/omni-bot/index.ts` | Shared-secret endpoint. Keeps 24h memory, opt-out, rate limit, one enquiry per sender |
| Instagram adapter | `supabase/functions/instagram-webhook/index.ts` | Meta webhook: verifies signature, asks the bot, sends the DM reply |
| WhatsApp adapter | `supabase/functions/_shared/omni-bot/whatsapp.ts`, called from `interakt-webhook` | Replies to non-lead customers on the numbers listed in `OMNI_BOT_PHONE_NUMBER_IDS` (currently +91 98371 15799) via Meta's WhatsApp Cloud API |
| Tables | `supabase/migrations/20261107100000_omni_bot_tables.sql` | `omni_bot_senders`, `omni_bot_messages`; service role only |
| Tests | `supabase/functions/_shared/omni-bot/omni-bot_test.ts` | 13 unit tests (catalogue, engine, enquiry rules, Meta signature) |

Enquiries go to the existing `website-lead` function (source `chat`), so they land with the sales team exactly like website chat enquiries.

Adding another channel means writing a small adapter that POSTs `{channel, sender_id, text}` to `omni-bot` with the `x-omni-secret` header and sends back the `reply`.

## Secrets (Supabase project secrets)

| Name | Used by | Notes |
|---|---|---|
| `OMNI_BOT_SECRET` | `omni-bot`, `instagram-webhook` | New. Long random string. Fails closed if missing. |
| `ANTHROPIC_API_KEY` | `omni-bot` | Already used by `website-agent` |
| `AGENT_MODEL` | `omni-bot` | Optional. Default `claude-sonnet-5-5` |
| `META_APP_SECRET` | `instagram-webhook` | Meta app secret; checks `X-Hub-Signature-256` |
| `IG_VERIFY_TOKEN` | `instagram-webhook` | Any string; enter the same in Meta's webhook settings |
| `IG_PAGE_ACCESS_TOKEN` | `instagram-webhook` | Page or Instagram-account token with messaging permission |
| `SITE_URL` | `omni-bot` | Optional. Default `https://hdefurniture.netlify.app` |
| `OMNI_BOT_SECRET` (also on `interakt-webhook`) | `interakt-webhook` | Same value as above |
| `OMNI_BOT_PHONE_NUMBER_IDS` | `interakt-webhook` | Meta Phone Number ID(s) the bot may answer on, comma-separated. For +91 98371 15799 use its ID from Meta Business Manager (WhatsApp > API Setup). Empty = bot off |
| `WHATSAPP_ACCESS_TOKEN` | `interakt-webhook` | Meta system-user token with `whatsapp_business_messaging`. Keep it in Supabase secrets only |

## Deploy (not yet done)

1. `supabase db push` to apply both migrations (`20261107100000`, `20261107110000`).
2. Set the secrets above.
3. `supabase functions deploy omni-bot instagram-webhook interakt-webhook`
4. Meta: add the Instagram product to the app, subscribe the page to `messages`, and set the callback URL to `https://<project>.supabase.co/functions/v1/instagram-webhook` with `IG_VERIFY_TOKEN`.
5. Test: send a DM to the business account asking for a sofa. The reply should name a product with its MRP and link.

## Behaviour rules

- `STOP` or `UNSUBSCRIBE` opts the sender out. They get no further replies.
- At most 30 customer messages per sender per hour.
- Meta redelivers webhooks. Each customer message is stored with its provider id, so a repeat is ignored and gets no second reply.
- One enquiry per sender. Invalid mobile numbers are refused.
- The bot never quotes discounts, final prices, stock or delivery dates. The consultant gives those.
- Prices are Godrej Interio MRP from the catalogue.

## Not done yet (decisions for the owner)

- **WhatsApp scope.** The bot answers customers who are not leads, on the showroom number via Meta's Cloud API. Lead conversations are not answered by the bot, so salespeople keep control of them. If you also want the bot to answer leads, that needs a rule for handing back to the salesperson.
- **Store facts still show 99172 33664.** The bot's prompt tells customers to call or WhatsApp +91 99172 33664. If 98371 15799 is now the WhatsApp contact, change it in `_shared/omni-bot/prompt.ts` and `omni-bot/index.ts`, and the same line in `website-agent`.
- **Twilio is not used.** The Twilio WhatsApp path is down on the account, so it is not wired to the bot. The existing staff and lead messages that still go through `send-whatsapp` (Twilio) will also fail until that is moved to the Meta API. That is a separate piece of work.
- **WeChat (`wechaty`) is not wired in.** Wechaty drives a logged-in personal WeChat account through an unofficial protocol. That risks account restriction, and it is not something to put customer service on. If WeChat matters, the official route is a WeChat Official Account with its API. That is a separate decision.
- **"Omni" and other channels** are not defined yet. Each needs its own adapter and credentials.
- **Catalogue scope.** The bot answers from the website catalogue only. Products not published on the website are not known to it. The `godrej_products` table in Omniflow is not used yet.
- **Duplicate store facts.** `website-agent` keeps its own copy of the store facts. Keep both in step when they change.
- **Not run against live services.** The edge functions were syntax-checked, and the logic is unit tested (21 tests). They have not been deployed or called from Supabase, Meta or Twilio.
