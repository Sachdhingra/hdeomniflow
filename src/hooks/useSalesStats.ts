import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SalesStats {
  totalLeads: number;
  wonLeads: number;
  wonValue: number;
  pipelineValue: number;
  overdueLeads: number;
  conversionPct: number;
}

interface Filters {
  userId?: string;          // when set, scope to created_by = userId
  categoryFilter?: string;  // 'all' or category value
  statusFilter?: string;    // 'all' or status value
  fromDate?: string;        // YYYY-MM-DD
  toDate?: string;          // YYYY-MM-DD
  phoneSearch?: string;
}

const ZERO: SalesStats = {
  totalLeads: 0, wonLeads: 0, wonValue: 0,
  pipelineValue: 0, overdueLeads: 0, conversionPct: 0,
};

export const useSalesStats = (filters: Filters, deps: any[] = []) => {
  const [stats, setStats] = useState<SalesStats>(ZERO);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      // base filter builder
      const applyFilters = (q: any) => {
        q = q.is("deleted_at", null);
        if (filters.userId) q = q.eq("created_by", filters.userId);
        if (filters.categoryFilter && filters.categoryFilter !== "all")
          q = q.eq("category", filters.categoryFilter as any);
        if (filters.statusFilter && filters.statusFilter !== "all")
          q = q.eq("status", filters.statusFilter as any);
        if (filters.fromDate) q = q.gte("created_at", filters.fromDate);
        if (filters.toDate) q = q.lte("created_at", filters.toDate + "T23:59:59");
        if (filters.phoneSearch?.trim())
          q = q.ilike("customer_phone", `%${filters.phoneSearch.trim()}%`);
        return q;
      };

      // Total + pipeline value: fetch value column for sum + count
      const { data: allRows, count: totalLeads } = await applyFilters(
        supabase.from("leads").select("value_in_rupees, status", { count: "exact" })
      );

      const rows = allRows || [];
      const wonRows = rows.filter((r: any) => r.status === "won");
      const overdueRows = rows.filter((r: any) => r.status === "overdue");
      const wonValue = wonRows.reduce((s: number, r: any) => s + Number(r.value_in_rupees), 0);
      const pipelineValue = rows.reduce((s: number, r: any) => s + Number(r.value_in_rupees), 0);
      const total = totalLeads ?? rows.length;
      const conversionPct = total > 0 ? Math.round((wonRows.length / total) * 100) : 0;

      setStats({
        totalLeads: total,
        wonLeads: wonRows.length,
        wonValue,
        pipelineValue,
        overdueLeads: overdueRows.length,
        conversionPct,
      });
    } catch (e) {
      console.error("useSalesStats error", e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  return { stats, loading, refetch: fetchStats };
};
