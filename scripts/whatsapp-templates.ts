/**
 * Create the quick-reply WhatsApp templates in Twilio and submit them to Meta.
 *
 * Everything here is generated from supabase/functions/_shared/quick-reply-flow.ts,
 * so the button id Meta approves is byte-for-byte the payload the webhook
 * matches on. Typing these into the console by hand is the one way this feature
 * silently breaks: an approved template with "QR_WANT_PRICE " (trailing space)
 * looks fine and lands in the lead board as unrecognised free text.
 *
 * Usage:
 *   npx vite-node scripts/whatsapp-templates.ts -- print
 *   TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=... \
 *     npx vite-node scripts/whatsapp-templates.ts -- create --confirm
 *   ... -- submit --confirm      # ask Meta to approve the 4 opening questions
 *   ... -- status                # approval state of every template
 *   ... -- sql                   # UPDATE statements to store the SIDs
 *   npx vite-node scripts/whatsapp-templates.ts -- markdown \
 *     > WHATSAPP_TEMPLATE_SUBMISSIONS.md   # regenerate the submission sheet
 */
import {
  QUICK_REPLY_STEPS,
  TEMPLATE_SAMPLE,
  buildContentApiPayload,
  type QuickReplyStep,
} from "../supabase/functions/_shared/quick-reply-flow.ts";

const API = "https://content.twilio.com/v1";

type ContentResource = { sid: string; friendly_name: string };
type ApprovalState = {
  name?: string;
  status?: string;
  category?: string;
  rejection_reason?: string;
};

function creds(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    console.error(
      "Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN. Find them in the Twilio\n" +
      "console; they are the same credentials the send-whatsapp function uses.",
    );
    process.exit(1);
  }
  return Buffer.from(`${sid}:${token}`).toString("base64");
}

async function twilio<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Basic ${creds()}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* keep the raw body */ }
  if (!res.ok) {
    const p = parsed as { message?: string; code?: number };
    throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status} ${p?.message ?? text}`);
  }
  return parsed as T;
}

/** Every Content resource on the account, keyed by friendly_name. */
async function existingByName(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let path: string | null = "/Content?PageSize=100";
  while (path) {
    const page = await twilio<{ contents: ContentResource[]; meta?: { next_page_url?: string | null } }>(path);
    for (const c of page.contents ?? []) out.set(c.friendly_name, c.sid);
    const next = page.meta?.next_page_url;
    path = next ? next.replace(API, "") : null;
  }
  return out;
}

async function approvalOf(sid: string): Promise<ApprovalState> {
  try {
    const r = await twilio<{ whatsapp?: ApprovalState }>(`/Content/${sid}/ApprovalRequests`);
    return r.whatsapp ?? {};
  } catch {
    return {};
  }
}

const needsApproval = (s: QuickReplyStep) => s.requiresApprovedTemplate;

// ── print ────────────────────────────────────────────────────────────────────
function print() {
  for (const step of QUICK_REPLY_STEPS) {
    const p = buildContentApiPayload(step);
    console.log(`\n${"─".repeat(72)}`);
    console.log(`${step.title}   (${step.key})`);
    console.log(`${"─".repeat(72)}`);
    console.log(`Template name : ${step.templateName}`);
    console.log(`Content type  : twilio/quick-reply`);
    console.log(`Language      : en`);
    console.log(
      `Approval      : ${needsApproval(step)
        ? `SUBMIT TO META — category ${step.metaCategory}`
        : "none needed (only sent within 24h of a customer message)"}`,
    );
    console.log(`\nBody:\n${step.question}`);
    console.log(`\nSample values:`);
    step.variables.forEach((v, i) => console.log(`  {{${i + 1}}}  ${TEMPLATE_SAMPLE[v]}   (${v.replace(/_/g, " ")})`));
    console.log(`\nButtons (title → id, the id must match exactly):`);
    for (const a of p.types["twilio/quick-reply"].actions) {
      console.log(`  ${a.title.padEnd(20)} → ${a.id}`);
    }
  }
  console.log(
    `\n${QUICK_REPLY_STEPS.filter(needsApproval).length} of ${QUICK_REPLY_STEPS.length} ` +
    `templates need Meta approval.\n`,
  );
}

// ── create ───────────────────────────────────────────────────────────────────
async function create(confirmed: boolean) {
  const existing = await existingByName();
  const todo = QUICK_REPLY_STEPS.filter((s) => !existing.has(s.templateName));

  if (todo.length === 0) {
    console.log("All 8 templates already exist in Twilio. Nothing to create.");
    return;
  }
  console.log(`Will create ${todo.length} Content template(s) in Twilio:`);
  for (const s of todo) console.log(`  ${s.templateName}  (${step_label(s)})`);
  if (!confirmed) {
    console.log("\nRe-run with --confirm to actually create them.");
    return;
  }
  for (const step of todo) {
    const created = await twilio<ContentResource>("/Content", {
      method: "POST",
      body: buildContentApiPayload(step),
    });
    console.log(`  created ${step.templateName} → ${created.sid}`);
  }
  console.log("\nNext: `submit --confirm` to send the opening questions to Meta.");
}

const step_label = (s: QuickReplyStep) =>
  needsApproval(s) ? `needs Meta approval, ${s.metaCategory}` : "no approval needed";

// ── submit ───────────────────────────────────────────────────────────────────
async function submit(confirmed: boolean) {
  const existing = await existingByName();
  const todo: QuickReplyStep[] = [];

  for (const step of QUICK_REPLY_STEPS.filter(needsApproval)) {
    const sid = existing.get(step.templateName);
    if (!sid) {
      console.log(`  ${step.templateName}: not created yet — run \`create --confirm\` first`);
      continue;
    }
    const approval = await approvalOf(sid);
    if (approval.status) {
      console.log(`  ${step.templateName}: already ${approval.status}`);
      continue;
    }
    todo.push(step);
  }

  if (todo.length === 0) {
    console.log("Nothing to submit.");
    return;
  }
  console.log(`\nWill submit ${todo.length} template(s) to Meta:`);
  for (const s of todo) console.log(`  ${s.templateName}  category ${s.metaCategory}`);
  if (!confirmed) {
    console.log("\nRe-run with --confirm to submit. Approval usually takes minutes to a day.");
    return;
  }
  for (const step of todo) {
    const sid = existing.get(step.templateName)!;
    await twilio(`/Content/${sid}/ApprovalRequests/whatsapp`, {
      method: "POST",
      body: { name: step.templateName, category: step.metaCategory },
    });
    console.log(`  submitted ${step.templateName}`);
  }
}

// ── status ───────────────────────────────────────────────────────────────────
async function status() {
  const existing = await existingByName();
  console.log(
    "step".padEnd(20) + "template".padEnd(26) + "sid".padEnd(36) + "approval",
  );
  for (const step of QUICK_REPLY_STEPS) {
    const sid = existing.get(step.templateName);
    let state = needsApproval(step) ? "not submitted" : "n/a";
    if (sid && needsApproval(step)) {
      const a = await approvalOf(sid);
      state = a.status ? a.status + (a.rejection_reason ? ` — ${a.rejection_reason}` : "") : "not submitted";
    }
    console.log(
      step.key.padEnd(20) + step.templateName.padEnd(26) + (sid ?? "— not created —").padEnd(36) + state,
    );
  }
}

// ── sql ──────────────────────────────────────────────────────────────────────
async function sql() {
  const existing = await existingByName();
  const missing = QUICK_REPLY_STEPS.filter((s) => !existing.has(s.templateName));
  for (const step of QUICK_REPLY_STEPS) {
    const sid = existing.get(step.templateName);
    if (!sid) continue;
    console.log(
      `UPDATE public.whatsapp_quick_reply_steps SET content_sid = '${sid}', ` +
      `updated_at = now() WHERE step_key = '${step.key}';`,
    );
  }
  if (missing.length) {
    console.log(`\n-- not created yet: ${missing.map((s) => s.templateName).join(", ")}`);
  }
  console.log(
    "\n-- Or paste each SID into Admin → Automation Monitor → Quick-reply conversation.",
  );
}

// ── markdown ─────────────────────────────────────────────────────────────────
/** Regenerates WHATSAPP_TEMPLATE_SUBMISSIONS.md straight from the flow. */
function markdown() {
  const approval = QUICK_REPLY_STEPS.filter(needsApproval);
  const noApproval = QUICK_REPLY_STEPS.filter((s) => !needsApproval(s));
  const out: string[] = [];

  out.push("# WhatsApp Templates to Submit for Approval");
  out.push("");
  out.push(
    "<!-- Generated by `npm run wa:templates -- markdown`. Edit the flow in",
  );
  out.push("     supabase/functions/_shared/quick-reply-flow.ts, not this file. -->");
  out.push("");
  out.push(
    `Only **${approval.length} of the ${QUICK_REPLY_STEPS.length}** quick-reply templates need ` +
    "Meta's approval — the ones that *start* a conversation. The other " +
    `${noApproval.length} are only ever sent as an instant reply to a tap, which is inside ` +
    "WhatsApp's 24-hour customer-service window, so they need no approval.",
  );
  out.push("");
  out.push("## The fastest, safest route");
  out.push("");
  out.push("```bash");
  out.push("export TWILIO_ACCOUNT_SID=AC…");
  out.push("export TWILIO_AUTH_TOKEN=…");
  out.push("");
  out.push("npm run wa:templates -- create --confirm   # build all 8 in Twilio");
  out.push("npm run wa:templates -- submit --confirm   # send the 4 above to Meta");
  out.push("npm run wa:templates -- status            # check approval");
  out.push("npm run wa:templates -- sql               # SIDs, ready to store");
  out.push("```");
  out.push("");
  out.push(
    "This builds each template from the flow definition, so the **button id Meta " +
    "approves is byte-for-byte the payload the lead board matches on**. Typing them " +
    "by hand is the one way this feature breaks quietly: an approved button id with " +
    "a trailing space looks correct in the console and arrives as unrecognised free text.",
  );
  out.push("");
  out.push("If you would rather use the console, every field is written out below.");
  out.push("");
  out.push("## Templates needing approval");
  out.push("");

  for (const step of approval) {
    const p = buildContentApiPayload(step);
    out.push(`### ${step.title}`);
    out.push("");
    out.push("| Field | Value |");
    out.push("|---|---|");
    out.push(`| Template name | \`${step.templateName}\` |`);
    out.push(`| Category | **${step.metaCategory}** |`);
    out.push("| Language | English (`en`) |");
    out.push("| Content type | `twilio/quick-reply` |");
    out.push("| Header / Footer | none |");
    out.push("");
    out.push("**Body**");
    out.push("");
    out.push("```");
    out.push(step.question);
    out.push("```");
    out.push("");
    out.push("**Sample values** (Meta requires one per placeholder)");
    out.push("");
    out.push("| Placeholder | Sample | Filled at send time with |");
    out.push("|---|---|---|");
    step.variables.forEach((v, i) => {
      const source = v === "first_name"
        ? "the lead's first name"
        : v === "interest"
          ? "what they liked or asked about"
          : "the showroom city";
      out.push(`| \`{{${i + 1}}}\` | ${TEMPLATE_SAMPLE[v]} | ${source} |`);
    });
    out.push("");
    out.push("**Quick-reply buttons**");
    out.push("");
    out.push("| Button text | Button id — must match exactly |");
    out.push("|---|---|");
    for (const a of p.types["twilio/quick-reply"].actions) {
      out.push(`| ${a.title} | \`${a.id}\` |`);
    }
    out.push("");
  }

  out.push("## Created, but not submitted");
  out.push("");
  out.push(
    "These still need to exist in Twilio (the `create` step above makes them), " +
    "but no approval request is sent:",
  );
  out.push("");
  out.push("| Template name | Step |");
  out.push("|---|---|");
  for (const step of noApproval) {
    out.push(`| \`${step.templateName}\` | ${step.title} |`);
  }
  out.push("");
  out.push("## On the category choice");
  out.push("");
  out.push(
    "Category is not paperwork — it decides throttling. A MARKETING template sent to " +
    "many recipients gets rate-limited by Meta (Twilio error 63049), which is why this " +
    "account's Insider notification template was already moved to UTILITY.",
  );
  out.push("");
  out.push("| Template | Submitted as | Why |");
  out.push("|---|---|---|");
  out.push(
    "| `hde_qr_still_looking` | MARKETING | Re-opening a dormant enquiry is promotional. No way around it. |",
  );
  out.push(
    "| `hde_qr_keep_enquiry_open` | MARKETING | Same — we are the ones restarting the conversation. |",
  );
  out.push(
    "| `hde_qr_price_feedback` | UTILITY | Follows up a price **the customer asked us for** " +
    "by tapping \u201CSend price & offers\u201D. |",
  );
  out.push(
    "| `hde_qr_post_visit` | UTILITY | Feedback after a visit the customer made. |",
  );
  out.push("");
  out.push(
    "Be aware: Meta can reclassify the two UTILITY ones to MARKETING on review. That " +
    "does not break anything — the template still works — but those two would then be " +
    "subject to marketing limits. `npm run wa:templates -- status` shows the category " +
    "Meta actually assigned.",
  );
  out.push("");
  out.push("## Why these should pass review");
  out.push("");
  out.push(
    "Meta rejects templates for a short list of reasons. `src/test/quickReplyFlow.test.ts` " +
    "enforces the mechanical ones on every commit:",
  );
  out.push("");
  out.push("| Rejection reason | How these avoid it |");
  out.push("|---|---|");
  out.push("| Body starts or ends with a variable | Tested — none do |");
  out.push("| Two variables next to each other | Tested — none do |");
  out.push("| Missing or unrealistic sample values | Every placeholder has a real sample |");
  out.push("| Body over 1024 characters | Tested — longest is well under |");
  out.push("| More than 3 quick-reply buttons, or labels over 20 characters | Tested |");
  out.push("| Vague or generic content | Each names the business, the product and one clear question |");
  out.push("| Missing business identity | The opening template names Home Decor Enterprises and the Godrej Interio authorisation |");
  out.push(
    "| No way to opt out | \u201CStop messages\u201D is a button on the recurring templates, " +
    "and a typed `stop` is always honoured |",
  );
  out.push("");
  out.push("## After approval");
  out.push("");
  out.push(
    "Store each Content SID (`HX…`) against its step — `npm run wa:templates -- sql`, or " +
    "paste them in **Admin → Automation Monitor → Quick-reply conversation**. Until a SID " +
    "is stored, the engine sends nothing for that question and logs " +
    "`quick_reply_template_missing`.",
  );
  out.push("");
  out.push("See `WHATSAPP_QUICK_REPLY_FLOW.md` for what each button does to the lead board.");
  out.push("");

  console.log(out.join("\n"));
}

const argv = process.argv.slice(2);
const command = argv.find((a) => !a.startsWith("--")) ?? "print";
const confirmed = argv.includes("--confirm");

const run = async () => {
  switch (command) {
    case "print": return print();
    case "create": return create(confirmed);
    case "submit": return submit(confirmed);
    case "status": return status();
    case "sql": return sql();
    case "markdown": return markdown();
    default:
      console.error(
        `Unknown command "${command}". Use: print | create | submit | status | sql | markdown`,
      );
      process.exit(1);
  }
};

run().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
