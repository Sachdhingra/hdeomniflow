# WhatsApp Quick-Reply Lead Flow

Customers do not ring the showroom back, and most will not type a reply. They
will tap a button. So every automated WhatsApp message the lead engine sends is
a **quick-reply template with 2–3 buttons**, and every tap comes back to us as
an exact payload — not a sentence we have to guess at.

That single change is what makes the leads board precise: the board reacts to
what the customer actually chose, instead of to a keyword match on free text.

## How a conversation runs

```
Engine (6pm / 8pm IST)          Customer taps              We answer instantly
──────────────────────          ─────────────              ───────────────────
"Still looking for a sofa?"  →  [Yes, still looking]    →  "What would help most?"
                                                        →  [Send price & offers]
                                                           → job for a salesperson
                                [Just browsing]         →  "Want the catalogue?"
                                [Already bought]        →  lead closed, no more messages
```

The reply to a tap goes out **immediately** from the webhook, not on the next
engine run, because the customer is holding their phone right then. Replies to
taps are always inside WhatsApp's 24-hour service window, so they do not need
Meta approval — only the messages that *start* a conversation do.

## Where the flow lives

The flow is code, not configuration:
`supabase/functions/_shared/quick-reply-flow.ts`.

The engine, the inbound webhook and the leads board all read that one file, so
they can never disagree about what a button means. `src/lib/quickReplyFlow.ts`
re-exports it for the React app. `src/test/quickReplyFlow.test.ts` enforces
WhatsApp's limits (≤3 buttons, ≤20-character labels), unique payloads, and that
no button is a dead end.

The only thing configured in the database is each step's **Twilio Content SID**,
because that value is minted in the Twilio console after Meta approves the
template.

## Setting it up (one time)

1. In the **Twilio Console → Content Template Builder**, create one template per
   step below. Choose content type **`twilio/quick-reply`**.
2. Copy the body text exactly, including the `{{1}}`, `{{2}}`, `{{3}}`
   placeholders in the order listed.
3. Add the buttons exactly as listed. **The button ID / payload must match
   character for character** — that string is what the board acts on. A mismatch
   means the tap arrives as unrecognised free text.
4. Submit the templates marked *Submit to Meta for approval*. The rest work
   without approval.
5. Copy each approved template's Content SID (`HX…`) and paste it into
   **Admin → Automation Monitor → Quick-reply conversation**.

Until a SID is pasted, the engine will not send that question. It logs
`quick_reply_template_missing` and falls back to the old plain-text follow-up,
so outreach never silently stops.

## The steps

### Re-engage — still looking?

- **Step key:** `qr_reengage`
- **Approval:** Submit to Meta for approval (business-initiated)
- **Body:** Hi {{1}}! Home Decor Enterprises here (authorised Godrej Interio, {{3}}). Are you still looking for {{2}}? Just tap below — no need to call.
- **Variables:** {{1}} = first name, {{2}} = interest, {{3}} = showroom

| Button text (max 20 chars) | Button ID / payload | What happens |
|---|---|---|
| Yes, still looking | `QR_STILL_LOOKING` | moves to **exploration**; auto-sends *What helps most?* |
| Just browsing | `QR_JUST_BROWSING` | moves to **exploration**; auto-sends *Offer catalogue* |
| Already bought | `QR_ALREADY_BOUGHT` | moves to **cold**; closes the lead as lost |

### What helps most?

- **Step key:** `qr_what_helps`
- **Approval:** No approval needed (only sent within 24h of a customer message)
- **Body:** Great! What would help you most right now, {{1}}?
- **Variables:** {{1}} = first name

| Button text (max 20 chars) | Button ID / payload | What happens |
|---|---|---|
| Send price & offers | `QR_WANT_PRICE` | moves to **evaluation**; **warning** task: Send the price list and running offers on WhatsApp |
| Visit showroom | `QR_WANT_VISIT` | moves to **reassurance**; auto-sends *Showroom visit timing* |
| Call me | `QR_WANT_CALL` | moves to **reassurance**; **critical** task: Customer asked for a call — ring them back today |

### Offer catalogue

- **Step key:** `qr_offer_catalogue`
- **Approval:** No approval needed (only sent within 24h of a customer message)
- **Body:** No problem, {{1}}. Would you like our latest catalogue and this month's offers on {{2}}?
- **Variables:** {{1}} = first name, {{2}} = interest

| Button text (max 20 chars) | Button ID / payload | What happens |
|---|---|---|
| Yes, send it | `QR_CATALOGUE_YES` | moves to **exploration**; **info** task: Send the product catalogue and current offers |
| Remind me later | `QR_REMIND_LATER` | moves to **evaluation**; pauses follow-ups 14 days |
| Stop messages | `QR_STOP_MESSAGES` | moves to **cold**; stops all automated WhatsApp |

### Showroom visit timing

- **Step key:** `qr_visit_when`
- **Approval:** No approval needed (only sent within 24h of a customer message)
- **Body:** Lovely — when would you like to visit our {{1}} showroom?
- **Variables:** {{1}} = showroom

| Button text (max 20 chars) | Button ID / payload | What happens |
|---|---|---|
| Today / tomorrow | `QR_VISIT_TODAY` | moves to **decision**; **critical** task: Visit within 24h — confirm the slot and keep the piece ready |
| This weekend | `QR_VISIT_WEEKEND` | moves to **decision**; **warning** task: Weekend visit — confirm the day and block a sales person |
| Not sure yet | `QR_VISIT_UNSURE` | moves to **evaluation**; auto-sends *Offer catalogue* |

### Price feedback

- **Step key:** `qr_price_feedback`
- **Approval:** Submit to Meta for approval (business-initiated)
- **Body:** Hi {{1}}, did the price we shared for {{2}} work for you?
- **Variables:** {{1}} = first name, {{2}} = interest

| Button text (max 20 chars) | Button ID / payload | What happens |
|---|---|---|
| Yes, let's proceed | `QR_PRICE_OK` | moves to **decision**; **critical** task: Customer accepted the price — close the order today |
| Above my budget | `QR_PRICE_HIGH` | moves to **reassurance**; auto-sends *EMI / offer rescue* |
| Need some time | `QR_PRICE_THINKING` | moves to **evaluation**; pauses follow-ups 5 days |

### EMI / offer rescue

- **Step key:** `qr_emi_offer`
- **Approval:** No approval needed (only sent within 24h of a customer message)
- **Body:** Understood, {{1}}. We have easy EMI and seasonal offers on {{2}}. Should I check the best option for you?
- **Variables:** {{1}} = first name, {{2}} = interest

| Button text (max 20 chars) | Button ID / payload | What happens |
|---|---|---|
| Yes, check for me | `QR_EMI_YES` | moves to **decision**; **warning** task: Work out the best EMI / discount option and share it |
| Not right now | `QR_EMI_NO` | moves to **evaluation**; pauses follow-ups 10 days |
| Stop messages | `QR_STOP_MESSAGES` | moves to **cold**; stops all automated WhatsApp |

### After showroom visit

- **Step key:** `qr_post_visit`
- **Approval:** Submit to Meta for approval (business-initiated)
- **Body:** Thanks for visiting us, {{1}}! Did you find what you were looking for?
- **Variables:** {{1}} = first name

| Button text (max 20 chars) | Button ID / payload | What happens |
|---|---|---|
| Yes, liked it | `QR_VISIT_LIKED` | moves to **decision**; **critical** task: Liked it in the showroom — follow up with a quote and close |
| Still deciding | `QR_VISIT_DECIDING` | moves to **reassurance**; auto-sends *EMI / offer rescue* |
| Didn't find it | `QR_VISIT_NOT_FOUND` | moves to **exploration**; **warning** task: Nothing matched in the showroom — suggest alternatives |

### Silent lead nudge

- **Step key:** `qr_nudge`
- **Approval:** Submit to Meta for approval (business-initiated)
- **Body:** Hi {{1}}, one tap is all we need — should we keep your enquiry for {{2}} open?
- **Variables:** {{1}} = first name, {{2}} = interest

| Button text (max 20 chars) | Button ID / payload | What happens |
|---|---|---|
| Yes, keep it open | `QR_KEEP_OPEN` | moves to **exploration**; auto-sends *What helps most?* |
| Not right now | `QR_NOT_NOW` | moves to **cold**; pauses follow-ups 21 days |
| Stop messages | `QR_STOP_MESSAGES` | moves to **cold**; stops all automated WhatsApp |

## What the board shows

On each lead card:

- **Tapped: _<button>_** — the customer's last answer, coloured by what it means
  (green positive, amber "a salesperson owes them something", red negative).
- **→ _task_** — the job the tap created, e.g. *Ring them back today*. Clear it
  with the ✓ on the alert once it is done.
- **Awaiting tap · _question_** — we asked, they have not answered yet.
- **Opted out** / **Snoozed till _date_** — automation is deliberately silent.

Inside the lead, the message timeline shows *Asked: <question>* on the outbound
message and *Tapped: <answer>* on the reply.

## Guard rails

These hold on both paths — the engine's and the instant reply's:

| Rule | Why |
|---|---|
| Never the same question twice in 24 hours | Repetition is what makes people mute a business |
| At most 6 automated messages a day to one lead | A conversation, not a broadcast |
| Business-initiated messages only between 9am and 9pm IST | Replies to a tap ignore this — the customer just messaged us |
| "Stop messages" (tapped or typed) stops everything, permanently | Respect, and WhatsApp policy |
| "Remind me later" pauses follow-ups for the days the flow declares | The customer set the pace |
| A question already asked and unanswered blocks new questions for 72 hours | Let them answer before asking again |
| A step with no Content SID sends nothing | Better a logged gap than a broken message |

Every lead the engine deliberately does *not* message is counted with a reason
in the run summary: `flow_quiet`, `flow_awaiting_tap`, `flow_snoozed`,
`flow_opted_out`, `flow_skipped`, `flow_send_failed`,
`quick_reply_templates_missing`.

## Matching a tap to the right question

When several questions are outstanding, WhatsApp's `OriginalRepliedMessageSid`
tells us exactly which message was answered. We look that SID up against the
outbound message's stored `provider_message_id` and use the step recorded there.
Only if the customer's phone sends no such reference do we fall back to the last
question asked.

Free text is still handled the old way — keyword sentiment and concern analysis
— and a typed `stop` is always honoured. But a typed sentence never gets
interpreted as a button press.
