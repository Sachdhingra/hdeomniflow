import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listMyLeadsTool from "./tools/list-my-leads";
import getLeadTool from "./tools/get-lead";
import listServiceJobsTool from "./tools/list-service-jobs";

// The OAuth issuer MUST be the direct Supabase host, built from the project ref
// that Vite inlines at build time. See app-mcp-server-authoring knowledge.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "omniflow-mcp",
  title: "OmniFlow MCP",
  version: "0.1.0",
  instructions:
    "OmniFlow (HDE) CRM tools for sales, service, and admin users. Use `whoami` to check the session, `list_my_leads` and `get_lead` for sales pipeline data, and `list_service_jobs` for dispatch/service work. All tools respect the caller's role and row-level access.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoamiTool, listMyLeadsTool, getLeadTool, listServiceJobsTool],
});
