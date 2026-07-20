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
  name: "list_my_leads",
  title: "List my leads",
  description:
    "List leads visible to the signed-in user, respecting RLS. Optionally filter by status and limit.",
  inputSchema: {
    status: z
      .string()
      .optional()
      .describe("Optional lead status filter (e.g. new, contacted, won, lost)."),
    limit: z.number().int().positive().optional().describe("Max rows to return. Default 25."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = clientFor(ctx);
    let q = supabase
      .from("leads")
      .select("id, customer_name, phone, status, source, created_at, assigned_to")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(Math.min(limit ?? 25, 100));
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error)
      return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { leads: data ?? [] },
    };
  },
});
