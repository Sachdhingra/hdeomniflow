import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const today = new Date().toISOString().split("T")[0];

    // Fetch all roles and profiles
    const [rolesRes, profilesRes] = await Promise.all([
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("profiles").select("id, name, email, phone_number").eq("active", true),
    ]);

    const roles = rolesRes.data || [];
    const profiles = profilesRes.data || [];

    // Fetch today's data
    const [leadsRes, jobsRes] = await Promise.all([
      supabase.from("leads").select("*").is("deleted_at", null),
      supabase.from("service_jobs").select("*").is("deleted_at", null),
    ]);

    const allLeads = leadsRes.data || [];
    const allJobs = jobsRes.data || [];

    const todayLeads = allLeads.filter((l: any) => l.created_at?.startsWith(today));
    const todayJobs = allJobs.filter((j: any) => j.created_at?.startsWith(today));

    const messages: { phone: string; name: string; text: string; status: string }[] = [];

    for (const role of roles) {
      const profile = profiles.find((p: any) => p.id === role.user_id);
      if (!profile) continue;

      let text = "";

      if (role.role === "sales" || role.role === "site_agent") {
        const myLeads = allLeads.filter((l: any) => l.assigned_to === role.user_id || l.created_by === role.user_id);
        const myTodayLeads = todayLeads.filter((l: any) => l.assigned_to === role.user_id || l.created_by === role.user_id);
        const wonLeads = myLeads.filter((l: any) => l.status === "won");
        const wonValue = wonLeads.reduce((s: number, l: any) => s + Number(l.value_in_rupees || 0), 0);
        const overdueLeads = myLeads.filter((l: any) => l.status === "overdue");
        const pendingLeads = myLeads.filter((l: any) => !["won", "lost"].includes(l.status));
        const followUpsDone = myLeads.filter((l: any) => l.last_follow_up?.startsWith(today)).length;

        text = `📊 Daily Summary - ${profile.name}\n` +
          `Leads Added Today: ${myTodayLeads.length}\n` +
          `Follow-ups Done: ${followUpsDone}\n` +
          `Pending: ${pendingLeads.length}\n` +
          `Won: ${wonLeads.length} (₹${wonValue.toLocaleString("en-IN")})\n` +
          `Overdue: ${overdueLeads.length}`;
      } else if (role.role === "service_head") {
        const todayAssigned = todayJobs.filter((j: any) => j.status !== "pending");
        const completed = allJobs.filter((j: any) => j.status === "completed" && j.completed_at?.startsWith(today));
        const pending = allJobs.filter((j: any) => j.status === "pending");
        const rescheduled = allJobs.filter((j: any) => j.status === "rescheduled");

        text = `📊 Daily Summary - Service\n` +
          `Jobs Assigned Today: ${todayAssigned.length}\n` +
          `Jobs Completed: ${completed.length}\n` +
          `Jobs Pending: ${pending.length}\n` +
          `Rescheduled: ${rescheduled.length}`;
      } else if (role.role === "admin") {
        const totalValue = todayLeads.reduce((s: number, l: any) => s + Number(l.value_in_rupees || 0), 0);
        const serviceRevenue = allJobs
          .filter((j: any) => j.type === "service" && j.status === "completed" && !j.is_foc && j.completed_at?.startsWith(today))
          .reduce((s: number, j: any) => s + Number(j.value || 0), 0);
        const pendingTasks = allJobs.filter((j: any) => j.status === "pending").length +
          allLeads.filter((l: any) => l.status === "overdue").length;

        text = `📊 Admin Daily Summary\n` +
          `Total Leads Added: ${todayLeads.length}\n` +
          `Total Sales Value: ₹${totalValue.toLocaleString("en-IN")}\n` +
          `Service Revenue: ₹${serviceRevenue.toLocaleString("en-IN")}\n` +
          `Pending Tasks: ${pendingTasks}`;
      }

      if (text) {
        // Store as notification
        await supabase.from("notifications").insert({
          user_id: role.user_id,
          message: text,
          type: "summary",
        });

        // Use phone_number from profile (mandatory for messaging)
        const phone = (profile as any).phone_number || "";
        if (!phone) {
          console.warn(`Skipping WhatsApp for ${profile.name}: no phone_number`);
          messages.push({ phone: "", name: profile.name, text, status: "skipped_no_phone" });
          continue;
        }

        // Call send-whatsapp function for actual delivery
        try {
          const waRes = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({
              phone,
              message: text,
              user_id: role.user_id,
              user_name: profile.name,
            }),
          });
          const waData = await waRes.json();
          messages.push({ phone, name: profile.name, text, status: waData.success ? "sent" : "failed" });
        } catch (waErr: any) {
          console.error(`WhatsApp send failed for ${profile.name}:`, waErr);
          messages.push({ phone, name: profile.name, text, status: "failed" });
        }
      }
    }

    return new Response(JSON.stringify({ success: true, sent: messages.length, messages }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Daily summary error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
