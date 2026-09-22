#!/usr/bin/env node
/**
 * Submits the kiosk WhatsApp templates to Twilio's Content API and sends them
 * to Meta for approval.
 *
 *   node scripts/submit-whatsapp-templates.mjs              # dry run: prints only
 *   node scripts/submit-whatsapp-templates.mjs --submit      # creates + submits
 *   node scripts/submit-whatsapp-templates.mjs --status      # polls approval state
 *
 * Needs TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in the environment (the same
 * pair already set as Supabase edge-function secrets).
 *
 * When each template is approved, paste its ContentSid into app_settings:
 *   kiosk_welcome_content_sid   ← hde_kiosk_review_invite_v1
 *   kiosk_feedback_content_sid  ← hde_kiosk_feedback_thanks_v1
 *   kiosk_recovery_content_sid  ← hde_kiosk_service_recovery_v1
 *   draw_winner_content_sid     ← hde_draw_winner_v1
 *
 * The bodies below mirror supabase/functions/_shared/kiosk-messages.ts. Keep
 * them in step: the free-text version is what customers get inside the 24-hour
 * window, the template is what they get outside it.
 */

const API = "https://content.twilio.com/v1/Content";

/**
 * Meta's content rules this set is written to satisfy:
 *   • body never starts or ends with a variable, and no two variables touch;
 *   • variables numbered from {{1}} with no gaps;
 *   • the category matches what the message actually does — a review request
 *     and a prize draw are MARKETING however politely they are phrased, and
 *     mislabelling them as UTILITY is a rejection (or a quality strike).
 */
const TEMPLATES = [
  {
    friendly_name: "hde_kiosk_review_invite_v1",
    setting: "kiosk_welcome_content_sid",
    category: "MARKETING",
    variables: { 1: "Rahul", 2: "https://g.page/r/CSD4GHiNc4IUEAE/review" },
    body: `Hi {{1}}! 🙏

Thank you for visiting Home Decor Enterprises today. It was a pleasure having you at our showroom, and thank you for taking a moment to share your feedback.

We read every single response, and we promise to serve you better each day.

⭐ Could you spare 30 seconds to leave us a Google review? For a family-run showroom like ours it makes a real difference:
{{2}}

🎁 Every customer who leaves us a Google review goes into our monthly lucky draw. We pick one winner in the first week of every month and announce it right here on WhatsApp.

Need sizes, prices or delivery dates? Just reply to this message and our team will help you right away.

Home Decor Enterprises
Authorised Godrej Interio showroom, Dehradun`,
  },
  {
    friendly_name: "hde_kiosk_feedback_thanks_v1",
    setting: "kiosk_feedback_content_sid",
    category: "UTILITY",
    variables: { 1: "Rahul" },
    body: `Hi {{1}}, thank you for visiting Home Decor Enterprises today and for taking a moment to share your feedback at our showroom.

We read every single response, and we promise to serve you better each day.

Is there anything we could have done better today? Just reply to this message — it goes straight to our team.

Home Decor Enterprises
Authorised Godrej Interio showroom, Dehradun`,
  },
  {
    friendly_name: "hde_kiosk_service_recovery_v1",
    setting: "kiosk_recovery_content_sid",
    category: "UTILITY",
    variables: { 1: "Rahul" },
    body: `Hi {{1}}, thank you for visiting Home Decor Enterprises today, and thank you for being honest with us about your experience.

We are sorry your visit did not go the way it should have. Your feedback has gone straight to our owner.

Please tell us what went wrong — reply to this message and we will call you back to set it right.

Home Decor Enterprises
Authorised Godrej Interio showroom, Dehradun`,
  },
  {
    friendly_name: "hde_draw_winner_v1",
    setting: "draw_winner_content_sid",
    category: "MARKETING",
    variables: { 1: "Priya", 2: "August 2026", 3: "a ₹2,000 gift voucher" },
    body: `🎉 Congratulations {{1}}!

You have won the Home Decor Enterprises monthly lucky draw for {{2}}. 🏆

Your Google review entered you into the draw, and your name came out on top.

Your prize: {{3}}

Reply to this message and our team will arrange for you to collect it.

Thank you for supporting us 🙏
Home Decor Enterprises`,
  },
];

const args = new Set(process.argv.slice(2));
const submit = args.has("--submit");
const statusOnly = args.has("--status");

const sid = process.env.TWILIO_ACCOUNT_SID;
const token = process.env.TWILIO_AUTH_TOKEN;

function auth() {
  if (!sid || !token) {
    console.error(
      "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set.\n" +
        "Find them in the Twilio console, or in Supabase → Edge Functions → Secrets.",
    );
    process.exit(1);
  }
  return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: auth(), ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

function validate(t) {
  const problems = [];
  const used = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const expected = Object.keys(t.variables).map(Number).sort((a, b) => a - b);
  if (String([...new Set(used)].sort((a, b) => a - b)) !== String(expected)) {
    problems.push(`variables in body ${used} do not match samples ${expected}`);
  }
  if (/^\s*\{\{/.test(t.body)) problems.push("body starts with a variable");
  if (/\}\}\s*$/.test(t.body)) problems.push("body ends with a variable");
  if (/\}\}\s*\{\{/.test(t.body)) problems.push("two variables with nothing between them");
  if (t.body.length > 1024) problems.push(`body is ${t.body.length} chars (max 1024)`);
  return problems;
}

async function createAndSubmit(t) {
  const created = await api("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      friendly_name: t.friendly_name,
      language: "en",
      variables: t.variables,
      types: { "twilio/text": { body: t.body } },
    }),
  });
  console.log(`  created ${created.sid}`);

  await api(`/${created.sid}/ApprovalRequests/whatsapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: t.friendly_name, category: t.category }),
  });
  console.log(`  submitted to Meta as ${t.category}`);
  return created.sid;
}

async function listApprovals() {
  const { contents = [] } = await api("?PageSize=100");
  const ours = contents.filter((c) =>
    TEMPLATES.some((t) => t.friendly_name === c.friendly_name),
  );
  if (ours.length === 0) {
    console.log("None of the kiosk templates exist in this Twilio account yet.");
    return;
  }
  for (const c of ours) {
    let status = "unknown";
    try {
      const approval = await api(`/${c.sid}/ApprovalRequests`);
      status = approval?.whatsapp?.status ?? "not submitted";
      if (approval?.whatsapp?.rejection_reason) {
        status += ` (${approval.whatsapp.rejection_reason})`;
      }
    } catch {
      status = "not submitted";
    }
    const setting =
      TEMPLATES.find((t) => t.friendly_name === c.friendly_name)?.setting ?? "";
    console.log(`${c.friendly_name}\n  ${c.sid}  →  ${status}\n  app_settings.${setting}`);
  }
}

async function main() {
  let invalid = false;
  for (const t of TEMPLATES) {
    const problems = validate(t);
    if (problems.length) {
      invalid = true;
      console.error(`✗ ${t.friendly_name}: ${problems.join("; ")}`);
    }
  }
  if (invalid) process.exit(1);

  if (statusOnly) return listApprovals();

  if (!submit) {
    console.log("DRY RUN — nothing sent to Twilio. Re-run with --submit.\n");
    for (const t of TEMPLATES) {
      console.log(`── ${t.friendly_name} [${t.category}] → app_settings.${t.setting}`);
      console.log(t.body);
      console.log(`   (${t.body.length} chars)\n`);
    }
    return;
  }

  for (const t of TEMPLATES) {
    console.log(`${t.friendly_name} [${t.category}]`);
    try {
      await createAndSubmit(t);
    } catch (e) {
      console.error(`  failed: ${e.message}`);
    }
  }
  console.log("\nMeta usually answers within minutes, sometimes up to 24h.");
  console.log("Check with: node scripts/submit-whatsapp-templates.mjs --status");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
