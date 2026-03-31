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

const PAGE_SIZE = 50;

interface DataContextType {
  leads: Lead[];
  serviceJobs: ServiceJob[];
  siteVisits: SiteVisit[];
  notifications: Notification[];
  profiles: Profile[];
  loading: boolean;
  addLead: (lead: TablesInsert<"leads">) => Promise<void>;
  updateLead: (id: string, updates: Partial<Lead>) => Promise<void>;
  softDeleteLead: (id: string) => Promise<void>;
  restoreLead: (id: string) => Promise<void>;
  assignDelivery: (leadId: string, deliveryDate: string, deliveryNotes: string, assignedTo: string) => Promise<void>;
  addServiceJob: (job: TablesInsert<"service_jobs">) => Promise<void>;
  updateServiceJob: (id: string, updates: Partial<ServiceJob>) => Promise<void>;
  softDeleteServiceJob: (id: string) => Promise<void>;
  restoreServiceJob: (id: string) => Promise<void>;
  addSiteVisit: (visit: TablesInsert<"site_visits">) => Promise<void>;
  softDeleteSiteVisit: (id: string) => Promise<void>;
  restoreSiteVisit: (id: string) => Promise<void>;
  addNotification: (n: TablesInsert<"notifications">) => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  getProfilesByRole: (role: string) => Profile[];
  refreshAll: () => Promise<void>;
  // Pagination
  hasMoreLeads: boolean;
  hasMoreJobs: boolean;
  loadMoreLeads: () => Promise<void>;
  loadMoreJobs: () => Promise<void>;
  // Deleted records (admin)
  deletedLeads: Lead[];
  deletedServiceJobs: ServiceJob[];
  deletedSiteVisits: SiteVisit[];
  fetchDeletedRecords: () => Promise<void>;
}

const DataContext = createContext<DataContextType | null>(null);

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [serviceJobs, setServiceJobs] = useState<ServiceJob[]>([]);
  const [siteVisits, setSiteVisits] = useState<SiteVisit[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [allRoles, setAllRoles] = useState<{ user_id: string; role: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMoreLeads, setHasMoreLeads] = useState(false);
  const [hasMoreJobs, setHasMoreJobs] = useState(false);
  const [deletedLeads, setDeletedLeads] = useState<Lead[]>([]);
  const [deletedServiceJobs, setDeletedServiceJobs] = useState<ServiceJob[]>([]);
  const [deletedSiteVisits, setDeletedSiteVisits] = useState<SiteVisit[]>([]);
  const leadsPageRef = useRef(0);
  const jobsPageRef = useRef(0);

  const fetchLeads = useCallback(async (reset = true) => {
    const page = reset ? 0 : leadsPageRef.current;
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, count } = await supabase
      .from("leads")
      .select("*", { count: "exact" })
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (data) {
      if (reset) {
        setLeads(data);
        leadsPageRef.current = 1;
      } else {
        setLeads(prev => [...prev, ...data]);
        leadsPageRef.current = page + 1;
      }
      setHasMoreLeads((count || 0) > (page + 1) * PAGE_SIZE);
    }
  }, []);

  const loadMoreLeads = useCallback(async () => {
    await fetchLeads(false);
  }, [fetchLeads]);

  const fetchServiceJobs = useCallback(async (reset = true) => {
    const page = reset ? 0 : jobsPageRef.current;
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, count } = await supabase
      .from("service_jobs")
      .select("*", { count: "exact" })
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (data) {
      if (reset) {
        setServiceJobs(data);
        jobsPageRef.current = 1;
      } else {
        setServiceJobs(prev => [...prev, ...data]);
        jobsPageRef.current = page + 1;
      }
      setHasMoreJobs((count || 0) > (page + 1) * PAGE_SIZE);
    }
  }, []);

  const loadMoreJobs = useCallback(async () => {
    await fetchServiceJobs(false);
  }, [fetchServiceJobs]);

  const fetchSiteVisits = useCallback(async () => {
    const { data } = await supabase.from("site_visits").select("*").is("deleted_at", null).order("created_at", { ascending: false }).limit(PAGE_SIZE);
    if (data) setSiteVisits(data);
  }, []);

  const fetchNotifications = useCallback(async () => {
    const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(PAGE_SIZE);
    if (data) setNotifications(data);
  }, []);

  const fetchProfiles = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("*");
    if (data) setProfiles(data);
    const { data: roles } = await supabase.from("user_roles").select("user_id, role");
    if (roles) setAllRoles(roles);
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

  // Staggered loading: summary first, then details
  const refreshAll = useCallback(async () => {
    setLoading(true);
    // Phase 1: profiles (needed for UI) + leads (main data)
    await Promise.all([fetchProfiles(), fetchLeads()]);
    setLoading(false);
    // Phase 2: secondary data (non-blocking)
    Promise.all([fetchServiceJobs(), fetchSiteVisits(), fetchNotifications()]);
  }, [fetchLeads, fetchServiceJobs, fetchSiteVisits, fetchNotifications, fetchProfiles]);

  useEffect(() => {
    if (user) refreshAll();
  }, [user, refreshAll]);

  // Real-time subscriptions
  useEffect(() => {
    if (!user) return;

    const leadsChannel = supabase.channel("leads-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => fetchLeads())
      .subscribe();

    const jobsChannel = supabase.channel("jobs-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "service_jobs" }, () => fetchServiceJobs())
      .subscribe();

    const notifChannel = supabase.channel("notif-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => fetchNotifications())
      .subscribe();

    const visitsChannel = supabase.channel("visits-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "site_visits" }, () => fetchSiteVisits())
      .subscribe();

    return () => {
      supabase.removeChannel(leadsChannel);
      supabase.removeChannel(jobsChannel);
      supabase.removeChannel(notifChannel);
      supabase.removeChannel(visitsChannel);
    };
  }, [user, fetchLeads, fetchServiceJobs, fetchNotifications, fetchSiteVisits]);

  const addLead = async (lead: TablesInsert<"leads">) => {
    const { error } = await supabase.from("leads").insert(lead);
    if (error) throw error;
  };

  const updateLead = async (id: string, updates: Partial<Lead>) => {
    const { error } = await supabase.from("leads").update({ ...updates, updated_by: user?.id || "" }).eq("id", id);
    if (error) throw error;
  };

  const softDeleteLead = async (id: string) => {
    const { error } = await supabase.from("leads").update({
      deleted_at: new Date().toISOString(),
      deleted_by: user?.id || "",
      updated_by: user?.id || "",
    } as any).eq("id", id);
    if (error) throw error;
    await fetchLeads();
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
    const { error } = await supabase.from("service_jobs").insert(job);
    if (error) throw error;
  };

  const updateServiceJob = async (id: string, updates: Partial<ServiceJob>) => {
    const { error } = await supabase.from("service_jobs").update(updates).eq("id", id);
    if (error) throw error;

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
    const { error } = await supabase.from("service_jobs").update({
      deleted_at: new Date().toISOString(),
      deleted_by: user?.id || "",
    } as any).eq("id", id);
    if (error) throw error;
    await fetchServiceJobs();
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
    const { error } = await supabase.from("site_visits").insert(visit);
    if (error) throw error;
  };

  const softDeleteSiteVisit = async (id: string) => {
    const { error } = await supabase.from("site_visits").update({
      deleted_at: new Date().toISOString(),
      deleted_by: user?.id || "",
    } as any).eq("id", id);
    if (error) throw error;
    await fetchSiteVisits();
  };

  const restoreSiteVisit = async (id: string) => {
    const { error } = await supabase.from("site_visits").update({
      deleted_at: null,
      deleted_by: null,
    } as any).eq("id", id);
    if (error) throw error;
    await Promise.all([fetchSiteVisits(), fetchDeletedRecords()]);
  };

  const addNotification = async (n: TablesInsert<"notifications">) => {
    const { error } = await supabase.from("notifications").insert(n);
    if (error) throw error;
  };

  const markNotificationRead = async (id: string) => {
    await supabase.from("notifications").update({ read: true }).eq("id", id);
  };

  const getProfilesByRole = (role: string): Profile[] => {
    const userIds = allRoles.filter(r => r.role === role).map(r => r.user_id);
    return profiles.filter(p => userIds.includes(p.id) && p.active);
  };

  return (
    <DataContext.Provider value={{
      leads, serviceJobs, siteVisits, notifications, profiles, loading,
      addLead, updateLead, softDeleteLead, restoreLead, assignDelivery,
      addServiceJob, updateServiceJob, softDeleteServiceJob, restoreServiceJob,
      addSiteVisit, softDeleteSiteVisit, restoreSiteVisit,
      addNotification, markNotificationRead,
      getProfilesByRole, refreshAll,
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
