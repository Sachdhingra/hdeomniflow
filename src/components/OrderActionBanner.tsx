import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";

interface StuckOrder { id: string; order_number: string; status: string; created_at: string; approved_at?: string | null; }

const STAGE_DAYS = 2;
const REFRESH_MS = 10 * 60 * 1000;

/**
 * Persistent amber strip shown on every screen (incl. home) for the role that
 * owes the next action on hde orders stuck > 2 days:
 *   accounts/admin      → orders awaiting approval
 *   service_head/admin  → approved / service_assigned orders awaiting service
 * Clicking it goes to the Inventory orders tab.
 */
const OrderActionBanner = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [approvalStuck, setApprovalStuck] = useState<StuckOrder[]>([]);
  const [serviceStuck, setServiceStuck] = useState<StuckOrder[]>([]);

  const role = user?.role as string | undefined;
  const seesApproval = role === "accounts" || role === "admin";
  const seesService = role === "service_head" || role === "admin";

  const load = useCallback(async () => {
    if (!seesApproval && !seesService) return;
    const { data } = await supabase
      .from("hde_orders" as any)
      .select("id, order_number, status, created_at, approved_at")
      .in("status", ["pending_approval", "approved", "service_assigned"]);
    const rows = ((data as any[]) || []) as StuckOrder[];
    const cutoff = Date.now() - STAGE_DAYS * 86400000;
    setApprovalStuck(rows.filter(o =>
      o.status === "pending_approval" && new Date(o.created_at).getTime() < cutoff));
    setServiceStuck(rows.filter(o =>
      (o.status === "approved" || o.status === "service_assigned") &&
      new Date(o.approved_at || o.created_at).getTime() < cutoff));
  }, [seesApproval, seesService]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const parts: string[] = [];
  if (seesApproval && approvalStuck.length > 0)
    parts.push(`${approvalStuck.length} order${approvalStuck.length > 1 ? "s" : ""} awaiting APPROVAL > ${STAGE_DAYS} days`);
  if (seesService && serviceStuck.length > 0)
    parts.push(`${serviceStuck.length} order${serviceStuck.length > 1 ? "s" : ""} awaiting SERVICE > ${STAGE_DAYS} days`);

  if (parts.length === 0) return null;

  return (
    <button
      onClick={() => navigate("/inventory")}
      className="w-full flex items-center gap-2 bg-amber-100 border-b border-amber-300 text-amber-900 px-4 py-2 text-sm font-medium hover:bg-amber-200 transition-colors text-left"
    >
      <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
      <span className="flex-1">{parts.join(" · ")} — tap to review</span>
    </button>
  );
};

export default OrderActionBanner;
