import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function clientFor(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_service_jobs",
  title: "List service jobs",
  description:
    "List service and delivery jobs visible to the signed-in user (RLS applied). Optional status/type filters.",
  inputSchema: {
    status: z.string().optional().describe("Job status filter (e.g. pending, assigned, on_route, completed)."),
    type: z.string().optional().describe("Job type filter (service, delivery, self_delivery)."),
    limit: z.number().int().positive().optional().describe("Max rows. Default 25."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, type, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    let q = clientFor(ctx)
      .from("service_jobs")
      .select("id, customer_name, address, status, type, date_to_attend, assigned_agent, description")
      .is("deleted_at", null)
      .order("date_to_attend", { ascending: true, nullsFirst: false })
      .limit(Math.min(limit ?? 25, 100));
    if (status) q = q.eq("status", status);
    if (type) q = q.eq("type", type);
    const { data, error } = await q;
    if (error)
      return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { jobs: data ?? [] },
    };
  },
});
