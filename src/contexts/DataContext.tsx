import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables, TablesInsert, Enums } from "@/integrations/supabase/types";

export type LeadCategory = Enums<"lead_category">;
export type LeadStatus = Enums<"lead_status">;
export type ServiceJobStatus = Enums<"service_job_status">;
export type ServiceJobType = Enums<"service_job_type">;

export const LEAD_CATEGORIES: { value: LeadCategory; label: string }[] = [
  { value: "sofa", label: "Sofa" },
  { value: "coffee_table", label: "Coffee Table" },
  { value: "almirah", label: "Almirah" },
  { value: "dining", label: "Dining" },
  { value: "mattress", label: "Mattress" },
  { value: "bed", label: "Bed" },
  { value: "kitchen", label: "Kitchen" },
  { value: "chair", label: "Chair" },
  { value: "office_table", label: "Office Table" },
  { value: "others", label: "Others" },
];

export type Lead = Tables<"leads">;
export type ServiceJob = Tables<"service_jobs">;
export type SiteVisit = Tables<"site_visits">;
export type Notification = Tables<"notifications">;
export type Profile = Tables<"profiles">;

const PAGE_SIZE = 20;

// --- Local cache helpers ---
const CACHE_PREFIX = "furncrm_cache_";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function setCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

function getCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > CACHE_TTL) return null;
    return parsed.data as T;
  } catch {
    return null;
  }
}

// --- Summary types for Stage 1 fast load ---
interface SummaryData {
  totalLeads: number;
  totalPipelineValue: number;
  pendingJobs: number;
  overdueLeads: number;
}

interface DataContextType {
  leads: Lead[];
  serviceJobs: ServiceJob[];
  siteVisits: SiteVisit[];
  notifications: Notification[];
  profiles: Profile[];
  loading: boolean;
  summaryLoading: boolean;
  summary: SummaryData;
  error: string | null;
  addLead: (lead: TablesInsert<"leads">) => Promise<void>;
  updateLead: (id: string, updates: Partial<Lead>) => Promise<void>;
  softDeleteLead: (id: string) => Promise<void>;
  restoreLead: (id: string) => Promise<void>;
  permanentDeleteLead: (id: string) => Promise<void>;
  hardDeleteLead: (id: string, reason?: string) => Promise<void>;
  assignDelivery: (leadId: string, deliveryDate: string, deliveryNotes: string, assignedTo: string) => Promise<void>;
  addServiceJob: (job: TablesInsert<"service_jobs">) => Promise<void>;
  updateServiceJob: (id: string, updates: Partial<ServiceJob>) => Promise<void>;
  softDeleteServiceJob: (id: string) => Promise<void>;
  restoreServiceJob: (id: string) => Promise<void>;
  permanentDeleteServiceJob: (id: string) => Promise<void>;
  addSiteVisit: (visit: TablesInsert<"site_visits">) => Promise<void>;
  updateSiteVisit: (id: string, updates: Partial<SiteVisit>) => Promise<void>;
  softDeleteSiteVisit: (id: string) => Promise<void>;
  restoreSiteVisit: (id: string) => Promise<void>;
  permanentDeleteSiteVisit: (id: string) => Promise<void>;
  addNotification: (n: TablesInsert<"notifications">) => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  getProfilesByRole: (role: string) => Profile[];
  refreshAll: () => Promise<void>;
  retryLoad: () => Promise<void>;
  hasMoreLeads: boolean;
  hasMoreJobs: boolean;
  loadMoreLeads: () => Promise<void>;
  loadMoreJobs: () => Promise<void>;
  deletedLeads: Lead[];
  deletedServiceJobs: ServiceJob[];
  deletedSiteVisits: SiteVisit[];
  fetchDeletedRecords: () => Promise<void>;
}

const DataContext = createContext<DataContextType | null>(null);

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>(() => getCache<Lead[]>("leads") || []);
  const [serviceJobs, setServiceJobs] = useState<ServiceJob[]>(() => getCache<ServiceJob[]>("serviceJobs") || []);
  const [siteVisits, setSiteVisits] = useState<SiteVisit[]>(() => getCache<SiteVisit[]>("siteVisits") || []);
  const [notifications, setNotifications] = useState<Notification[]>(() => getCache<Notification[]>("notifications") || []);
  const [profiles, setProfiles] = useState<Profile[]>(() => getCache<Profile[]>("profiles") || []);
  const [allRoles, setAllRoles] = useState<{ user_id: string; role: string }[]>(() => getCache<any[]>("roles") || []);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summary, setSummary] = useState<SummaryData>(() => getCache<SummaryData>("summary") || { totalLeads: 0, totalPipelineValue: 0, pendingJobs: 0, overdueLeads: 0 });
  const [error, setError] = useState<string | null>(null);
  const [hasMoreLeads, setHasMoreLeads] = useState(false);
  const [hasMoreJobs, setHasMoreJobs] = useState(false);
  const [deletedLeads, setDeletedLeads] = useState<Lead[]>([]);
  const [deletedServiceJobs, setDeletedServiceJobs] = useState<ServiceJob[]>([]);
  const [deletedSiteVisits, setDeletedSiteVisits] = useState<SiteVisit[]>([]);
  const leadsPageRef = useRef(0);
  const jobsPageRef = useRef(0);
  const fetchingRef = useRef(false);

  // --- Stage 1: Fast summary using RPC ---
  const fetchSummary = useCallback(async () => {
    try {
      setSummaryLoading(true);
      const { data, error: rpcError } = await supabase.rpc("get_dashboard_summary");
      if (rpcError) throw rpcError;
      const d = data as any;
      const s: SummaryData = {
        totalLeads: d?.total_leads || 0,
        totalPipelineValue: d?.total_pipeline_value || 0,
        pendingJobs: d?.pending_jobs || 0,
        overdueLeads: d?.overdue_leads || 0,
      };
      setSummary(s);
      setCache("summary", s);
      setError(null);
    } catch (err: any) {
      // Non-fatal: leads/jobs still load independently
      console.warn("Dashboard summary fetch failed:", err?.message);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  // --- Stage 2: Role-based data fetching ---
  const fetchLeads = useCallback(async (reset = true) => {
    if (!user) return;
    try {
      const page = reset ? 0 : leadsPageRef.current;
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from("leads")
        .select("*", { count: "exact" })
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .range(from, to);

      // Role-based filtering is handled by RLS, but we can optimize
      // by not fetching data we don't need
      const { data, count, error: fetchError } = await query;
      if (fetchError) throw fetchError;

      if (data) {
        if (reset) {
          setLeads(data);
          leadsPageRef.current = 1;
          setCache("leads", data);
        } else {
          setLeads(prev => {
            const updated = [...prev, ...data];
            setCache("leads", updated);
            return updated;
          });
          leadsPageRef.current = page + 1;
        }
        setHasMoreLeads((count || 0) > (page + 1) * PAGE_SIZE);
      }
      setError(null);
    } catch (err: any) {
      setError("Failed to load leads. Tap retry.");
    }
  }, [user]);

  const loadMoreLeads = useCallback(async () => {
    await fetchLeads(false);
  }, [fetchLeads]);

  const fetchServiceJobs = useCallback(async (reset = true) => {
    if (!user) return;
    try {
      const page = reset ? 0 : jobsPageRef.current;
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, count, error: fetchError } = await supabase
        .from("service_jobs")
        .select("*", { count: "exact" })
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .range(from, to);

      if (fetchError) throw fetchError;

      if (data) {
        if (reset) {
          setServiceJobs(data);
          jobsPageRef.current = 1;
          setCache("serviceJobs", data);
        } else {
          setServiceJobs(prev => {
            const updated = [...prev, ...data];
            setCache("serviceJobs", updated);
            return updated;
          });
          jobsPageRef.current = page + 1;
        }
        setHasMoreJobs((count || 0) > (page + 1) * PAGE_SIZE);
      }
      setError(null);
    } catch (err: any) {
      setError("Failed to load service jobs. Tap retry.");
    }
  }, [user]);

  const loadMoreJobs = useCallback(async () => {
    await fetchServiceJobs(false);
  }, [fetchServiceJobs]);

  const fetchSiteVisits = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error: fetchError } = await supabase
        .from("site_visits")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (fetchError) throw fetchError;
      if (data) {
        setSiteVisits(data);
        setCache("siteVisits", data);
      }
    } catch {}
  }, [user]);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (data) {
        setNotifications(data);
        setCache("notifications", data);
      }
    } catch {}
  }, [user]);

  const fetchProfiles = useCallback(async () => {
    try {
      const [profilesRes, rolesRes] = await Promise.all([
        supabase.from("profiles").select("*"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (profilesRes.data) {
        setProfiles(profilesRes.data);
        setCache("profiles", profilesRes.data);
      }
      if (rolesRes.data) {
        setAllRoles(rolesRes.data);
        setCache("roles", rolesRes.data);
      }
    } catch {}
  }, []);

  const fetchDeletedRecords = useCallback(async () => {
    const [leadsRes, jobsRes, visitsRes] = await Promise.all([
      supabase.from("leads").select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false }),
      supabase.from("service_jobs").select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false }),
      supabase.from("site_visits").select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false }),
    ]);
    if (leadsRes.data) setDeletedLeads(leadsRes.data);
    if (jobsRes.data) setDeletedServiceJobs(jobsRes.data);
    if (visitsRes.data) setDeletedSiteVisits(visitsRes.data);
  }, []);

  // 3-stage loading
  const refreshAll = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setError(null);

    try {
      // Stage 1: Summary + profiles (instant)
      setSummaryLoading(true);
      await Promise.all([fetchSummary(), fetchProfiles()]);
      setSummaryLoading(false);

      // Stage 2: Recent data (background, non-blocking for UI)
      setLoading(true);
      await fetchLeads();
      setLoading(false);

      // Stage 3: Secondary data (fully background)
      fetchServiceJobs();
      fetchSiteVisits();
      fetchNotifications();
    } catch (err: any) {
      setError("Something went wrong. Tap retry.");
      setLoading(false);
      setSummaryLoading(false);
    } finally {
      fetchingRef.current = false;
    }
  }, [fetchSummary, fetchProfiles, fetchLeads, fetchServiceJobs, fetchSiteVisits, fetchNotifications]);

  const retryLoad = useCallback(async () => {
    setError(null);
    await refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (user) refreshAll();
  }, [user, refreshAll]);

  // Auto-mark overdue leads (client-side, runs after leads load)
  useEffect(() => {
    if (!user || leads.length === 0) return;
    const todayStr = new Date().toISOString().split("T")[0];
    const overdueLeads = leads.filter(l =>
      l.next_follow_up_date &&
      l.next_follow_up_date < todayStr &&
      !["won", "lost", "overdue"].includes(l.status)
    );
    if (overdueLeads.length > 0) {
      // Batch update overdue leads
      overdueLeads.forEach(l => {
        supabase.from("leads").update({ status: "overdue" as any, updated_by: user.id }).eq("id", l.id)
          .then(() => {});
      });
      // Optimistic local update
      setLeads(prev => prev.map(l =>
        overdueLeads.some(o => o.id === l.id) ? { ...l, status: "overdue" as any } : l
      ));
    }
  }, [leads, user]);

  // Auto-refresh on tab visibility change
  useEffect(() => {
    if (!user) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshAll();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [user, refreshAll]);

  // Polling fallback: refresh every 30s as safety net
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") refreshAll();
    }, 30000);
    return () => clearInterval(interval);
  }, [user, refreshAll]);

  // Real-time subscriptions — debounced to avoid rapid refetches
  useEffect(() => {
    if (!user) return;

    let leadsTimeout: NodeJS.Timeout;
    let jobsTimeout: NodeJS.Timeout;
    let summaryTimeout: NodeJS.Timeout;

    const debouncedSummary = () => {
      clearTimeout(summaryTimeout);
      summaryTimeout = setTimeout(() => fetchSummary(), 1500);
    };

    const leadsChannel = supabase.channel("leads-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => {
        clearTimeout(leadsTimeout);
        leadsTimeout = setTimeout(() => fetchLeads(), 800);
        debouncedSummary();
      })
      .subscribe();

    const jobsChannel = supabase.channel("jobs-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "service_jobs" }, () => {
        clearTimeout(jobsTimeout);
        jobsTimeout = setTimeout(() => fetchServiceJobs(), 800);
        debouncedSummary();
      })
      .subscribe();

    const notifChannel = supabase.channel("notif-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => fetchNotifications())
      .subscribe();

    const visitsChannel = supabase.channel("visits-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "site_visits" }, () => fetchSiteVisits())
      .subscribe();

    return () => {
      clearTimeout(leadsTimeout);
      clearTimeout(jobsTimeout);
      clearTimeout(summaryTimeout);
      supabase.removeChannel(leadsChannel);
      supabase.removeChannel(jobsChannel);
      supabase.removeChannel(notifChannel);
      supabase.removeChannel(visitsChannel);
    };
  }, [user, fetchLeads, fetchServiceJobs, fetchNotifications, fetchSiteVisits, fetchSummary]);

  const addLead = async (lead: TablesInsert<"leads">) => {
    const { data, error } = await supabase.from("leads").insert(lead).select().single();
    if (error) throw error;
    // Optimistic: prepend to local state immediately
    if (data) setLeads(prev => [data, ...prev]);
  };

  const updateLead = async (id: string, updates: Partial<Lead>) => {
    // Optimistic update
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...updates, updated_by: user?.id || "" } : l));
    const { error } = await supabase.from("leads").update({ ...updates, updated_by: user?.id || "" }).eq("id", id);
    if (error) { await fetchLeads(); throw error; }
  };

  const softDeleteLead = async (id: string) => {
    // Optimistic: remove from view immediately
    setLeads(prev => prev.filter(l => l.id !== id));
    const { error } = await supabase.from("leads").update({
      deleted_at: new Date().toISOString(),
      deleted_by: user?.id || "",
      updated_by: user?.id || "",
    } as any).eq("id", id);
    if (error) { await fetchLeads(); throw error; }
  };

  const restoreLead = async (id: string) => {
    const { error } = await supabase.from("leads").update({
      deleted_at: null,
      deleted_by: null,
      updated_by: user?.id || "",
    } as any).eq("id", id);
    if (error) throw error;
    await Promise.all([fetchLeads(), fetchDeletedRecords()]);
  };

  const assignDelivery = async (leadId: string, deliveryDate: string, deliveryNotes: string, assignedTo: string) => {
    await supabase.from("leads").update({
      delivery_date: deliveryDate,
      delivery_notes: deliveryNotes,
      delivery_assigned_to: assignedTo,
      updated_by: user?.id || "",
    }).eq("id", leadId);

    const lead = leads.find(l => l.id === leadId);
    if (lead) {
      await supabase.from("service_jobs").insert({
        customer_name: lead.customer_name,
        customer_phone: lead.customer_phone,
        address: deliveryNotes,
        category: lead.category,
        description: `Delivery for ${lead.category} - ₹${Number(lead.value_in_rupees).toLocaleString("en-IN")}`,
        date_to_attend: deliveryDate,
        value: lead.value_in_rupees,
        is_foc: false,
        status: "pending",
        type: "delivery",
        source_lead_id: leadId,
      });

      const serviceHeads = allRoles.filter(r => r.role === "service_head");
      for (const sh of serviceHeads) {
        await supabase.from("notifications").insert({
          user_id: sh.user_id,
          message: `New delivery assigned: ${lead.customer_name} - ${lead.category} (₹${Number(lead.value_in_rupees).toLocaleString("en-IN")})`,
          type: "delivery",
        });
      }
    }
  };

  const addServiceJob = async (job: TablesInsert<"service_jobs">) => {
    const { data, error } = await supabase.from("service_jobs").insert(job).select().single();
    if (error) throw error;
    if (data) setServiceJobs(prev => [data, ...prev]);
  };

  const updateServiceJob = async (id: string, updates: Partial<ServiceJob>) => {
    // Optimistic update
    setServiceJobs(prev => prev.map(j => j.id === id ? { ...j, ...updates } : j));
    const { error } = await supabase.from("service_jobs").update(updates).eq("id", id);
    if (error) { await fetchServiceJobs(); throw error; }

    const job = serviceJobs.find(j => j.id === id);
    if (job) {
      if (updates.agent_reached_at) {
        const serviceHeads = allRoles.filter(r => r.role === "service_head");
        for (const sh of serviceHeads) {
          await supabase.from("notifications").insert({
            user_id: sh.user_id,
            message: `Agent reached site: ${job.customer_name} at ${job.address}`,
            type: "info",
          });
        }
      }
      if (updates.status === "completed") {
        const serviceHeads = allRoles.filter(r => r.role === "service_head");
        for (const sh of serviceHeads) {
          await supabase.from("notifications").insert({
            user_id: sh.user_id,
            message: `Job completed: ${job.customer_name} - ${job.description}`,
            type: "success",
          });
        }
      }
      if (updates.assigned_agent) {
        await supabase.from("notifications").insert({
          user_id: updates.assigned_agent,
          message: `New job assigned: ${job.customer_name} at ${job.address}`,
          type: "info",
        });
      }
    }
  };

  const softDeleteServiceJob = async (id: string) => {
    setServiceJobs(prev => prev.filter(j => j.id !== id));
    const { error } = await supabase.from("service_jobs").update({
      deleted_at: new Date().toISOString(),
      deleted_by: user?.id || "",
    } as any).eq("id", id);
    if (error) { await fetchServiceJobs(); throw error; }
  };

  const restoreServiceJob = async (id: string) => {
    const { error } = await supabase.from("service_jobs").update({
      deleted_at: null,
      deleted_by: null,
    } as any).eq("id", id);
    if (error) throw error;
    await Promise.all([fetchServiceJobs(), fetchDeletedRecords()]);
  };

  const addSiteVisit = async (visit: TablesInsert<"site_visits">) => {
    const { data, error } = await supabase.from("site_visits").insert(visit).select().single();
    if (error) throw error;
    if (data) setSiteVisits(prev => [data, ...prev]);
  };

  const updateSiteVisit = async (id: string, updates: Partial<SiteVisit>) => {
    setSiteVisits(prev => prev.map(v => v.id === id ? { ...v, ...updates } : v));
    const { error } = await supabase.from("site_visits").update(updates).eq("id", id);
    if (error) { await fetchSiteVisits(); throw error; }
  };

  const softDeleteSiteVisit = async (id: string) => {
    setSiteVisits(prev => prev.filter(v => v.id !== id));
    const { error } = await supabase.from("site_visits").update({
      deleted_at: new Date().toISOString(),
      deleted_by: user?.id || "",
    } as any).eq("id", id);
    if (error) { await fetchSiteVisits(); throw error; }
  };

  const restoreSiteVisit = async (id: string) => {
    const { error } = await supabase.from("site_visits").update({
      deleted_at: null,
      deleted_by: null,
    } as any).eq("id", id);
    if (error) throw error;
    await Promise.all([fetchSiteVisits(), fetchDeletedRecords()]);
  };

  const permanentDeleteLead = async (id: string) => {
    const { error } = await supabase.from("leads").delete().eq("id", id);
    if (error) throw error;
    setDeletedLeads(prev => prev.filter(l => l.id !== id));
  };

  // Hard delete with audit log + storage cleanup of visit_photo
  const hardDeleteLead = async (id: string, reason?: string) => {
    // Snapshot from active leads or fetch
    let snapshot: any = leads.find(l => l.id === id);
    if (!snapshot) {
      const { data } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
      snapshot = data;
    }

    // Insert audit log first (so even if delete fails, we have intent — but we only commit on success)
    const { error: delErr } = await supabase.from("leads").delete().eq("id", id);
    if (delErr) throw delErr;

    // Audit log (best-effort — do not fail the delete if logging fails)
    try {
      await supabase.from("deletion_logs").insert({
        table_name: "leads",
        record_id: id,
        deleted_by: user?.id || "",
        record_snapshot: snapshot || null,
        reason: reason || null,
      });
    } catch (e) {
      console.warn("deletion_logs insert failed", e);
    }

    // Cleanup visit_photo from storage if present
    const photoUrl: string | null = snapshot?.visit_photo || null;
    if (photoUrl && photoUrl.includes("/field-agent-photos/")) {
      try {
        const path = photoUrl.split("/field-agent-photos/")[1]?.split("?")[0];
        if (path) await supabase.storage.from("field-agent-photos").remove([path]);
      } catch (e) {
        console.warn("storage cleanup failed", e);
      }
    }

    // Optimistic local update
    setLeads(prev => prev.filter(l => l.id !== id));
    setDeletedLeads(prev => prev.filter(l => l.id !== id));
  };

  const permanentDeleteServiceJob = async (id: string) => {
    const { error } = await supabase.from("service_jobs").delete().eq("id", id);
    if (error) throw error;
    setDeletedServiceJobs(prev => prev.filter(j => j.id !== id));
  };

  const permanentDeleteSiteVisit = async (id: string) => {
    const { error } = await supabase.from("site_visits").delete().eq("id", id);
    if (error) throw error;
    setDeletedSiteVisits(prev => prev.filter(v => v.id !== id));
  };

  const addNotification = async (n: TablesInsert<"notifications">) => {
    const { error } = await supabase.from("notifications").insert(n);
    if (error) throw error;
  };

  const markNotificationRead = async (id: string) => {
    // Optimistic update: mark as read immediately
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    await supabase.from("notifications").update({ read: true }).eq("id", id);
  };

  const getProfilesByRole = (role: string): Profile[] => {
    const userIds = allRoles.filter(r => r.role === role).map(r => r.user_id);
    return profiles.filter(p => userIds.includes(p.id) && p.active);
  };

  return (
    <DataContext.Provider value={{
      leads, serviceJobs, siteVisits, notifications, profiles, loading,
      summaryLoading, summary, error,
      addLead, updateLead, softDeleteLead, restoreLead, permanentDeleteLead, hardDeleteLead, assignDelivery,
      addServiceJob, updateServiceJob, softDeleteServiceJob, restoreServiceJob, permanentDeleteServiceJob,
      addSiteVisit, updateSiteVisit, softDeleteSiteVisit, restoreSiteVisit, permanentDeleteSiteVisit,
      addNotification, markNotificationRead,
      getProfilesByRole, refreshAll, retryLoad,
      hasMoreLeads, hasMoreJobs, loadMoreLeads, loadMoreJobs,
      deletedLeads, deletedServiceJobs, deletedSiteVisits, fetchDeletedRecords,
    }}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
};
