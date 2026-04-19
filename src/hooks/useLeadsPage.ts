import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Lead } from "@/contexts/DataContext";

export type LeadWithCreator = Lead & { creator_name?: string | null };

interface Filters {
  userId?: string;
  categoryFilter?: string;
  statusFilter?: string;
  fromDate?: string;
  toDate?: string;
  phoneSearch?: string;
  page: number;
  pageSize: number;
}

export const useLeadsPage = (filters: Filters, deps: any[] = []) => {
  const [leads, setLeads] = useState<LeadWithCreator[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase.from("leads").select("*", { count: "exact" }).is("deleted_at", null);
      if (filters.userId) q = q.eq("created_by", filters.userId);
      if (filters.categoryFilter && filters.categoryFilter !== "all")
        q = q.eq("category", filters.categoryFilter as any);
      if (filters.statusFilter && filters.statusFilter !== "all")
        q = q.eq("status", filters.statusFilter as any);
      if (filters.fromDate) q = q.gte("created_at", filters.fromDate);
      if (filters.toDate) q = q.lte("created_at", filters.toDate + "T23:59:59");
      if (filters.phoneSearch?.trim())
        q = q.ilike("customer_phone", `%${filters.phoneSearch.trim()}%`);

      const from = (filters.page - 1) * filters.pageSize;
      const to = from + filters.pageSize - 1;
      q = q.order("created_at", { ascending: false }).range(from, to);

      const { data, count } = await q;
      const rows = (data ?? []) as Lead[];
      setTotalCount(count ?? 0);

      // Fetch creator names for the page
      const creatorIds = Array.from(new Set(rows.map(r => r.created_by).filter(Boolean)));
      let nameMap = new Map<string, string>();
      if (creatorIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, name")
          .in("id", creatorIds);
        (profs ?? []).forEach(p => nameMap.set(p.id, p.name));
      }
      setLeads(rows.map(r => ({ ...r, creator_name: nameMap.get(r.created_by) ?? null })));
    } catch (e) {
      console.error("useLeadsPage error", e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { fetchPage(); }, [fetchPage]);

  return { leads, totalCount, loading, refetch: fetchPage };
};
