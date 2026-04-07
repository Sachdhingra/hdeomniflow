import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) throw new Error("Unauthorized");

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: isAdmin } = await adminClient.rpc("has_role", {
      _user_id: caller.id,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Only admins can manage users");

    const { action, user_id, password, phone_number } = await req.json();

    switch (action) {
      case "reset_password": {
        if (!user_id || !password) throw new Error("user_id and password required");
        const { error } = await adminClient.auth.admin.updateUserById(user_id, { password });
        if (error) throw error;
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "update_phone": {
        if (!user_id) throw new Error("user_id required");
        // Validate: must be 12 digits starting with 91, or empty to clear
        const cleanPhone = (phone_number || "").replace(/\D/g, "");
        if (cleanPhone && cleanPhone.length !== 12) {
          throw new Error("Phone must be 12 digits (91XXXXXXXXXX)");
        }
        if (cleanPhone && !cleanPhone.startsWith("91")) {
          throw new Error("Phone must start with 91");
        }
        const { error } = await adminClient
          .from("profiles")
          .update({ phone_number: cleanPhone || null })
          .eq("id", user_id);
        if (error) throw error;
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "disable": {
        if (!user_id) throw new Error("user_id required");
        const { error: banErr } = await adminClient.auth.admin.updateUserById(user_id, {
          ban_duration: "876000h",
        });
        if (banErr) throw banErr;
        await adminClient.from("profiles").update({ active: false }).eq("id", user_id);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "enable": {
        if (!user_id) throw new Error("user_id required");
        const { error: unbanErr } = await adminClient.auth.admin.updateUserById(user_id, {
          ban_duration: "none",
        });
        if (unbanErr) throw unbanErr;
        await adminClient.from("profiles").update({ active: true }).eq("id", user_id);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "delete": {
        if (!user_id) throw new Error("user_id required");
        // Clean up references before deleting auth user
        // Nullify assigned leads/jobs so no FK issues
        await Promise.all([
          adminClient.from("leads").update({ assigned_to: null } as any).eq("assigned_to", user_id),
          adminClient.from("leads").update({ delivery_assigned_to: null } as any).eq("delivery_assigned_to", user_id),
          adminClient.from("service_jobs").update({ assigned_agent: null } as any).eq("assigned_agent", user_id),
          adminClient.from("user_roles").delete().eq("user_id", user_id),
          adminClient.from("notifications").delete().eq("user_id", user_id),
        ]);
        // Delete profile (cascade from auth.users won't work since no FK)
        await adminClient.from("profiles").delete().eq("id", user_id);
        // Finally delete auth user
        const { error: delErr } = await adminClient.auth.admin.deleteUser(user_id);
        if (delErr) throw delErr;
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        throw new Error("Invalid action. Use: reset_password, update_phone, disable, enable, delete");
    }
  } catch (err: any) {
    console.error("manage-user error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
