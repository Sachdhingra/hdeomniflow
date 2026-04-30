// Daily Excel Report - sent every day at 8 PM IST to all admin users
// Triggered by pg_cron with x-internal-secret header
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import ExcelJS from "https://esm.sh/exceljs@4.4.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const GMAIL_API_KEY = Deno.env.get("GOOGLE_MAIL_API_KEY");
const DAILY_REPORT_SECRET = Deno.env.get("DAILY_REPORT_SECRET");

const HEADER_FILL = (color: string) => ({
  type: "pattern" as const,
  pattern: "solid" as const,
  fgColor: { argb: color },
});

const fmtDateDDMMYYYY = (d: Date) => {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
};

const fmtFileDate = (d: Date) => {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
};

function styleHeader(row: any, color: string) {
  row.eachCell((cell: any) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
    cell.fill = HEADER_FILL(color);
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    };
  });
}

function autoSize(sheet: any) {
  sheet.columns.forEach((col: any) => {
    let max = 10;
    col.eachCell?.({ includeEmpty: false }, (cell: any) => {
      const v = cell.value == null ? "" : String(cell.value);
      if (v.length > max) max = Math.min(60, v.length + 2);
    });
    col.width = max;
  });
}

function statusColor(status: string): string | null {
  const s = (status || "").toLowerCase();
  if (s === "won" || s === "converted" || s === "completed" || s === "sent" || s === "delivered" || s === "read") return "FFC6EFCE";
  if (s === "new" || s === "pending" || s === "follow_up") return "FFFFEB9C";
  if (s === "lost" || s === "failed" || s === "rejected" || s === "overdue") return "FFFFC7CE";
  return null;
}

async function buildWorkbook(supabase: any) {
  const now = new Date();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const monthAgo = new Date(now.getTime() - 30 * 86400000);

  const [leadsRes, jobsRes, msgsRes, profilesRes] = await Promise.all([
    supabase.from("leads").select("*").is("deleted_at", null).order("created_at", { ascending: false }).limit(5000),
    supabase.from("service_jobs").select("*").is("deleted_at", null).order("created_at", { ascending: false }).limit(5000),
    supabase.from("lead_messages").select("*").gte("sent_at", monthAgo.toISOString()).order("sent_at", { ascending: false }).limit(10000),
    supabase.from("profiles").select("id, name, email"),
  ]);

  const leads = leadsRes.data || [];
  const jobs = jobsRes.data || [];
  const msgs = msgsRes.data || [];
  const profiles = profilesRes.data || [];
  const profMap = new Map(profiles.map((p: any) => [p.id, p]));

  const wb = new ExcelJS.Workbook();
  wb.creator = "OmniFlow";
  wb.created = now;

  // ---------------- SHEET 1: SUMMARY ----------------
  const sum = wb.addWorksheet("Summary");
  sum.mergeCells("A1:B1");
  sum.getCell("A1").value = `OmniFlow Daily Report — ${fmtDateDDMMYYYY(now)}`;
  sum.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  sum.getCell("A1").fill = HEADER_FILL("FF1F4E78");
  sum.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };
  sum.getRow(1).height = 28;

  const newLeadsToday = leads.filter((l: any) => new Date(l.created_at) >= todayStart).length;
  const wonToday = leads.filter((l: any) => l.status === "won" && new Date(l.updated_at) >= todayStart).length;
  const wonWeek = leads.filter((l: any) => l.status === "won" && new Date(l.updated_at) >= weekAgo).length;
  const sentToday = msgs.filter((m: any) => m.message_type === "outbound" && m.sent_at && new Date(m.sent_at) >= todayStart).length;
  const respToday = msgs.filter((m: any) => m.message_type === "inbound" && m.sent_at && new Date(m.sent_at) >= todayStart);
  let avgRespMin = 0;
  if (respToday.length > 0) {
    // approximate using lead.response_time_minutes when available
    const leadIds = new Set(respToday.map((r: any) => r.lead_id));
    const samples = leads.filter((l: any) => leadIds.has(l.id) && l.response_time_minutes != null).map((l: any) => l.response_time_minutes);
    if (samples.length) avgRespMin = Math.round(samples.reduce((a: number, b: number) => a + b, 0) / samples.length);
  }

  sum.addRow([]);
  const metrics: [string, string | number][] = [
    ["Date", fmtDateDDMMYYYY(now)],
    ["New Leads Today", newLeadsToday],
    ["Conversions Today", wonToday],
    ["Conversions This Week", wonWeek],
    ["Messages Sent Today", sentToday],
    ["Avg Response Time Today", avgRespMin ? `${avgRespMin} mins` : "N/A"],
  ];
  metrics.forEach(([k, v]) => {
    const r = sum.addRow([k, v]);
    r.getCell(1).font = { bold: true };
    r.getCell(1).fill = HEADER_FILL("FFD9E1F2");
    r.getCell(2).alignment = { horizontal: "right" };
  });
  sum.getColumn(1).width = 30;
  sum.getColumn(2).width = 24;

  // ---------------- SHEET 2: ALL LEADS ----------------
  const lead = wb.addWorksheet("All Leads");
  lead.columns = [
    { header: "Name", key: "name" },
    { header: "Phone", key: "phone" },
    { header: "Amount (₹)", key: "amount" },
    { header: "Status", key: "status" },
    { header: "Category", key: "category" },
    { header: "Neighborhood", key: "neighborhood" },
    { header: "Style", key: "style" },
    { header: "Psychology Stage", key: "stage" },
    { header: "Quality Score", key: "score" },
    { header: "Sales Owner", key: "owner" },
    { header: "Follow-up Date", key: "followup" },
    { header: "Created", key: "created" },
  ];
  styleHeader(lead.getRow(1), "FF1F4E78");
  leads.forEach((l: any) => {
    const owner = profMap.get(l.assigned_to) || profMap.get(l.created_by);
    const score = (l.score_breakdown && l.score_breakdown.total) || l.conversion_probability || 0;
    const r = lead.addRow({
      name: l.customer_name,
      phone: l.customer_phone,
      amount: Number(l.value_in_rupees || 0),
      status: l.status,
      category: l.category,
      neighborhood: l.neighborhood || "",
      style: l.preferred_style || "",
      stage: l.journey_stage || "",
      score,
      owner: owner ? (owner as any).name : "",
      followup: l.next_follow_up_date ? fmtDateDDMMYYYY(new Date(l.next_follow_up_date)) : "",
      created: fmtDateDDMMYYYY(new Date(l.created_at)),
    });
    r.getCell("amount").numFmt = '"₹"#,##0';
    const c = statusColor(l.status);
    if (c) r.getCell("status").fill = { type: "pattern", pattern: "solid", fgColor: { argb: c } };
  });
  lead.autoFilter = { from: "A1", to: { row: 1, column: lead.columnCount } };
  lead.views = [{ state: "frozen", ySplit: 1 }];
  autoSize(lead);

  // ---------------- SHEET 3: SERVICE JOBS ----------------
  const sjob = wb.addWorksheet("Service Jobs");
  sjob.columns = [
    { header: "Customer", key: "name" },
    { header: "Phone", key: "phone" },
    { header: "Amount (₹)", key: "amount" },
    { header: "Type", key: "type" },
    { header: "Status", key: "status" },
    { header: "Scheduled Date", key: "sched" },
    { header: "Assigned Agent", key: "agent" },
    { header: "Field Remarks", key: "remarks" },
    { header: "Created", key: "created" },
  ];
  styleHeader(sjob.getRow(1), "FF548235");
  jobs.forEach((j: any) => {
    const agent = profMap.get(j.assigned_agent);
    const r = sjob.addRow({
      name: j.customer_name,
      phone: j.customer_phone,
      amount: Number(j.value || 0),
      type: j.type,
      status: j.status,
      sched: j.date_to_attend ? fmtDateDDMMYYYY(new Date(j.date_to_attend)) : "",
      agent: agent ? (agent as any).name : "",
      remarks: j.remarks || "",
      created: fmtDateDDMMYYYY(new Date(j.created_at)),
    });
    r.getCell("amount").numFmt = '"₹"#,##0';
    const c = statusColor(j.status);
    if (c) r.getCell("status").fill = { type: "pattern", pattern: "solid", fgColor: { argb: c } };
  });
  sjob.autoFilter = { from: "A1", to: { row: 1, column: sjob.columnCount } };
  sjob.views = [{ state: "frozen", ySplit: 1 }];
  autoSize(sjob);

  // ---------------- SHEET 4: WHATSAPP MESSAGES ----------------
  const ms = wb.addWorksheet("WhatsApp Messages");
  ms.columns = [
    { header: "Type", key: "type" },
    { header: "Status", key: "status" },
    { header: "Customer Responded", key: "resp" },
    { header: "Response Time (min)", key: "rtime" },
    { header: "Sent At", key: "sent" },
    { header: "Delivered At", key: "deliv" },
  ];
  styleHeader(ms.getRow(1), "FF6F2DA8");
  // build response-time map per lead (latest known)
  const leadRespMap = new Map(leads.map((l: any) => [l.id, l.response_time_minutes]));
  msgs.forEach((m: any) => {
    const r = ms.addRow({
      type: m.message_type,
      status: m.status,
      resp: m.response_received ? "Yes" : "No",
      rtime: leadRespMap.get(m.lead_id) ?? "",
      sent: m.sent_at ? new Date(m.sent_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "",
      deliv: m.delivered_at ? new Date(m.delivered_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "",
    });
    const c = statusColor(m.status);
    if (c) r.getCell("status").fill = { type: "pattern", pattern: "solid", fgColor: { argb: c } };
  });
  ms.autoFilter = { from: "A1", to: { row: 1, column: ms.columnCount } };
  ms.views = [{ state: "frozen", ySplit: 1 }];
  autoSize(ms);

  // ---------------- SHEET 5: ANALYTICS ----------------
  const an = wb.addWorksheet("Analytics");
  an.mergeCells("A1:D1");
  an.getCell("A1").value = "Psychology Stage Breakdown";
  an.getCell("A1").font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  an.getCell("A1").fill = HEADER_FILL("FF1F4E78");
  an.getCell("A1").alignment = { horizontal: "center" };

  const stageHeader = an.addRow(["Stage", "Total Leads", "Converted (Won)", "Conversion Rate"]);
  styleHeader(stageHeader, "FF1F4E78");
  const stages = ["problem", "exploration", "evaluation", "reassurance", "decision"];
  stages.forEach((st) => {
    const inStage = leads.filter((l: any) => l.journey_stage === st);
    const won = inStage.filter((l: any) => l.status === "won").length;
    const rate = inStage.length ? `${Math.round((won / inStage.length) * 100)}%` : "0%";
    an.addRow([st, inStage.length, won, rate]);
  });

  an.addRow([]);
  an.mergeCells(`A${an.rowCount + 1}:D${an.rowCount + 1}`);
  const tpHdr = an.addRow(["Team Performance"]);
  tpHdr.getCell(1).font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  tpHdr.getCell(1).fill = HEADER_FILL("FF548235");
  tpHdr.getCell(1).alignment = { horizontal: "center" };

  const teamHeader = an.addRow(["Sales Person", "Total Leads", "Converted", "Conversion Rate"]);
  styleHeader(teamHeader, "FF548235");
  const byOwner = new Map<string, { total: number; won: number; name: string }>();
  leads.forEach((l: any) => {
    const oid = l.assigned_to || l.created_by;
    if (!oid) return;
    const p = profMap.get(oid) as any;
    const name = p?.name || "Unknown";
    const cur = byOwner.get(oid) || { total: 0, won: 0, name };
    cur.total++;
    if (l.status === "won") cur.won++;
    byOwner.set(oid, cur);
  });
  Array.from(byOwner.values())
    .sort((a, b) => b.won - a.won)
    .forEach((p) => {
      const rate = p.total ? `${Math.round((p.won / p.total) * 100)}%` : "0%";
      an.addRow([p.name, p.total, p.won, rate]);
    });

  an.columns.forEach((c: any) => (c.width = 24));

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

function buildRawEmail(to: string, subject: string, bodyText: string, filename: string, fileB64: string): string {
  const boundary = "omniflow_boundary_" + Math.random().toString(36).slice(2);
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    bodyText,
    "",
    `--${boundary}`,
    "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${filename}"`,
    "",
    fileB64.replace(/(.{76})/g, "$1\r\n"),
    "",
    `--${boundary}--`,
  ];
  const raw = lines.join("\r\n");
  // base64url encode
  return btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sendGmail(to: string, subject: string, body: string, filename: string, fileBytes: Uint8Array) {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
  if (!GMAIL_API_KEY) throw new Error("GOOGLE_MAIL_API_KEY not configured (Gmail connector)");

  // base64-encode attachment
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < fileBytes.length; i += chunk) {
    bin += String.fromCharCode(...fileBytes.subarray(i, i + chunk));
  }
  const fileB64 = btoa(bin);
  const raw = buildRawEmail(to, subject, body, filename, fileB64);

  const res = await fetch("https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": GMAIL_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gmail send failed [${res.status}]: ${t}`);
  }
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth: shared internal secret (cron) OR authenticated admin
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const headerSecret = req.headers.get("x-internal-secret");
  let authorized = false;

  if (headerSecret) {
    const { data: ok } = await supabase.rpc("verify_daily_report_secret", { _token: headerSecret });
    if (ok === true) authorized = true;
  }
  if (!authorized && DAILY_REPORT_SECRET && headerSecret && headerSecret === DAILY_REPORT_SECRET) {
    authorized = true;
  }
  if (!authorized) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const token = authHeader.replace("Bearer ", "");
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claimsData } = await userClient.auth.getClaims(token);
      const userId = claimsData?.claims?.sub;
      if (userId) {
        const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
        if (isAdmin === true) authorized = true;
      }
    }
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Find admin recipients
    const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
    const adminIds = (roles || []).map((r: any) => r.user_id);
    if (adminIds.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "No admin users found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: adminProfiles } = await supabase
      .from("profiles")
      .select("id, name, email")
      .in("id", adminIds)
      .eq("active", true);
    const recipients = (adminProfiles || []).filter((p: any) => p.email);

    if (recipients.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "No admin emails available" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileBytes = await buildWorkbook(supabase);
    const today = new Date();
    const filename = `OmniFlow_Report_${fmtFileDate(today)}.xlsx`;
    const subject = `📊 OmniFlow Daily Report - ${fmtDateDDMMYYYY(today)}`;
    const body =
`Hi,

Your automated OmniFlow daily report is attached.

Included in this Excel workbook:
• Summary — today's key metrics (new leads, conversions, messages, response time)
• All Leads — full lead database with quality scores and psychology stages
• Service Jobs — deliveries and service jobs with assigned agents
• WhatsApp Messages — last 30 days of customer conversations
• Analytics — psychology stage breakdown and team performance

Generated automatically at 8:00 PM IST.

— OmniFlow`;

    const results: { email: string; ok: boolean; error?: string }[] = [];
    for (const r of recipients) {
      try {
        await sendGmail((r as any).email, subject, body, filename, fileBytes);
        results.push({ email: (r as any).email, ok: true });
      } catch (e: any) {
        results.push({ email: (r as any).email, ok: false, error: e.message });
      }
    }

    await supabase.from("automation_logs").insert({
      event_type: "daily_excel_report",
      success: results.every((r) => r.ok),
      details: {
        recipients: results.length,
        sent: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
      },
      error_message: results.find((r) => !r.ok)?.error || null,
    });

    return new Response(
      JSON.stringify({
        success: true,
        total: results.length,
        sent: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("daily-excel-report error:", error);
    await supabase.from("automation_logs").insert({
      event_type: "daily_excel_report",
      success: false,
      error_message: error.message,
    });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
