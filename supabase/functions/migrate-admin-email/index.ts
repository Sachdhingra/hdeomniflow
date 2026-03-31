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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Update the existing admin user's email to username-based format
    const userId = "a0327b66-28f7-4c7e-821d-d4d0c855094c";
    
    const { error } = await adminClient.auth.admin.updateUser(userId, {
      email: "admin@furncrm.local",
      email_confirm: true,
    });
    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true, message: "Admin email migrated to admin@furncrm.local. Login with username: Admin" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
