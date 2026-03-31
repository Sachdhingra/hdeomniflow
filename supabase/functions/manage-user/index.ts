import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { action, user_id, password } = await req.json();

    switch (action) {
      case "reset_password": {
        if (!user_id || !password) throw new Error("user_id and password required");
        const { error } = await adminClient.auth.admin.updateUser(user_id, { password });
        if (error) throw error;
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "disable": {
        if (!user_id) throw new Error("user_id required");
        // Ban user in auth
        const { error: banErr } = await adminClient.auth.admin.updateUser(user_id, {
          ban_duration: "876000h", // ~100 years
        });
        if (banErr) throw banErr;
        // Mark inactive in profiles
        await adminClient.from("profiles").update({ active: false }).eq("id", user_id);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "enable": {
        if (!user_id) throw new Error("user_id required");
        const { error: unbanErr } = await adminClient.auth.admin.updateUser(user_id, {
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
        const { error: delErr } = await adminClient.auth.admin.deleteUser(user_id);
        if (delErr) throw delErr;
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "update_email": {
        if (!user_id) throw new Error("user_id required");
        const { email } = await req.json().catch(() => ({}));
        if (!email) throw new Error("email required");
        const { error: emailErr } = await adminClient.auth.admin.updateUser(user_id, { email });
        if (emailErr) throw emailErr;
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        throw new Error("Invalid action. Use: reset_password, disable, enable, delete");
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
