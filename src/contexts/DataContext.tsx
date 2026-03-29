import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

export type LeadCategory = "sofa" | "coffee_table" | "almirah" | "dining" | "mattress" | "bed" | "kitchen" | "chair" | "office_table" | "others";

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

export type LeadStatus = "new" | "contacted" | "follow_up" | "negotiation" | "won" | "lost" | "overdue";

export interface Lead {
  id: string;
  customerName: string;
  customerPhone: string;
  category: LeadCategory;
  valueInRupees: number;
  status: LeadStatus;
  assignedTo: string;
  createdAt: string;
  lastFollowUp: string;
  nextFollowUpDate: string;
  nextFollowUpTime: string;
  notes: string;
  source: "sales" | "site_agent";
  createdBy: string;
  updatedBy: string;
  updatedAt: string;
  deliveryDate?: string;
  deliveryNotes?: string;
  deliveryAssignedTo?: string;
}

export type ServiceJobStatus = "pending" | "assigned" | "in_progress" | "completed";
export type DeliveryJobStatus = "pending" | "assigned" | "in_transit" | "delivered";

export interface ServiceJob {
  id: string;
  customerName: string;
  customerPhone: string;
  address: string;
  category: LeadCategory;
  description: string;
  dateReceived: string;
  dateToAttend: string;
  value: number;
  isFOC: boolean;
  status: ServiceJobStatus;
  assignedAgent: string;
  claimPartNo?: string;
  claimReason?: string;
  claimDueDate?: string;
  completedAt?: string;
  agentReachedAt?: string;
  acceptedAt?: string;
  travelStartedAt?: string;
  photos?: string[];
  remarks?: string;
  type: "service" | "delivery";
  sourceLeadId?: string;
}

export interface SiteVisit {
  id: string;
  agentId: string;
  location: string;
  society: string;
  date: string;
  photos: string[];
  notes: string;
  leadsGenerated: number;
  lat?: number;
  lng?: number;
  customerName?: string;
  customerPhone?: string;
  category?: LeadCategory;
  budget?: number;
  followUpDate?: string;
  status?: string;
}

export interface Notification {
  id: string;
  userId: string;
  message: string;
  type: "info" | "warning" | "success" | "delivery";
  read: boolean;
  createdAt: string;
  link?: string;
}

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: "sales" | "service_head" | "field_agent" | "site_agent";
  active: boolean;
}

interface DataContextType {
  leads: Lead[];
  serviceJobs: ServiceJob[];
  siteVisits: SiteVisit[];
  notifications: Notification[];
  staff: StaffMember[];
  addLead: (lead: Omit<Lead, "id" | "createdAt" | "lastFollowUp" | "updatedAt" | "updatedBy">) => void;
  updateLeadStatus: (id: string, status: LeadStatus, userId: string) => void;
  assignDelivery: (leadId: string, deliveryDate: string, deliveryNotes: string, assignedTo: string, userId: string) => void;
  addServiceJob: (job: Omit<ServiceJob, "id">) => void;
  updateServiceJob: (id: string, updates: Partial<ServiceJob>) => void;
  addSiteVisit: (visit: Omit<SiteVisit, "id">) => void;
  addNotification: (n: Omit<Notification, "id" | "createdAt">) => void;
  markNotificationRead: (id: string) => void;
  addStaff: (s: Omit<StaffMember, "id">) => void;
  removeStaff: (id: string) => void;
  getStaffByRole: (role: string) => StaffMember[];
}

const DataContext = createContext<DataContextType | null>(null);

// Sample staff
const SAMPLE_STAFF: StaffMember[] = [
  { id: "2", name: "Rahul Sharma", email: "sales@crm.com", role: "sales", active: true },
  { id: "6", name: "Neha Verma", email: "sales2@crm.com", role: "sales", active: true },
  { id: "3", name: "Priya Patel", email: "service@crm.com", role: "service_head", active: true },
  { id: "4", name: "Amit Kumar", email: "field@crm.com", role: "field_agent", active: true },
  { id: "7", name: "Ravi Joshi", email: "field2@crm.com", role: "field_agent", active: true },
  { id: "5", name: "Vikram Singh", email: "site@crm.com", role: "site_agent", active: true },
];

const SAMPLE_LEADS: Lead[] = [
  { id: "L001", customerName: "Rajesh Gupta", customerPhone: "9876543210", category: "sofa", valueInRupees: 85000, status: "new", assignedTo: "2", createdAt: "2026-03-25", lastFollowUp: "2026-03-25", nextFollowUpDate: "2026-03-30", nextFollowUpTime: "10:00", notes: "Interested in L-shape sofa", source: "sales", createdBy: "2", updatedBy: "2", updatedAt: "2026-03-25" },
  { id: "L002", customerName: "Meena Agarwal", customerPhone: "9876543211", category: "dining", valueInRupees: 120000, status: "follow_up", assignedTo: "2", createdAt: "2026-03-20", lastFollowUp: "2026-03-26", nextFollowUpDate: "2026-03-27", nextFollowUpTime: "14:00", notes: "6-seater dining set", source: "sales", createdBy: "2", updatedBy: "2", updatedAt: "2026-03-26" },
  { id: "L003", customerName: "Suresh Reddy", customerPhone: "9876543212", category: "bed", valueInRupees: 65000, status: "negotiation", assignedTo: "6", createdAt: "2026-03-18", lastFollowUp: "2026-03-27", nextFollowUpDate: "2026-03-28", nextFollowUpTime: "11:00", notes: "King size with storage", source: "sales", createdBy: "6", updatedBy: "6", updatedAt: "2026-03-27" },
  { id: "L004", customerName: "Anita Desai", customerPhone: "9876543213", category: "kitchen", valueInRupees: 250000, status: "contacted", assignedTo: "2", createdAt: "2026-03-22", lastFollowUp: "2026-03-24", nextFollowUpDate: "2026-03-26", nextFollowUpTime: "16:00", notes: "Full modular kitchen", source: "sales", createdBy: "2", updatedBy: "2", updatedAt: "2026-03-24" },
  { id: "L005", customerName: "Vijay Malhotra", customerPhone: "9876543214", category: "almirah", valueInRupees: 45000, status: "won", assignedTo: "2", createdAt: "2026-03-10", lastFollowUp: "2026-03-15", nextFollowUpDate: "", nextFollowUpTime: "", notes: "3-door wardrobe", source: "sales", createdBy: "2", updatedBy: "2", updatedAt: "2026-03-15" },
];

const SAMPLE_JOBS: ServiceJob[] = [
  { id: "S001", customerName: "Kiran Bhat", customerPhone: "9876543220", address: "12 MG Road, Bangalore", category: "sofa", description: "Fabric tear repair", dateReceived: "2026-03-26", dateToAttend: "2026-03-28", value: 3500, isFOC: false, status: "assigned", assignedAgent: "4", type: "service" },
  { id: "S002", customerName: "Pooja Nair", customerPhone: "9876543221", address: "45 Koramangala, Bangalore", category: "bed", description: "Hydraulic mechanism issue", dateReceived: "2026-03-25", dateToAttend: "2026-03-28", value: 0, isFOC: true, status: "pending", assignedAgent: "", claimPartNo: "HYD-2045", claimReason: "Manufacturing defect", claimDueDate: "2026-04-05", type: "service" },
  { id: "S003", customerName: "Arjun Mehta", customerPhone: "9876543222", address: "78 Indiranagar, Bangalore", category: "kitchen", description: "Hinge replacement", dateReceived: "2026-03-27", dateToAttend: "2026-03-29", value: 1200, isFOC: false, status: "in_progress", assignedAgent: "4", type: "service" },
];

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const [leads, setLeads] = useState<Lead[]>(SAMPLE_LEADS);
  const [serviceJobs, setServiceJobs] = useState<ServiceJob[]>(SAMPLE_JOBS);
  const [siteVisits, setSiteVisits] = useState<SiteVisit[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>(SAMPLE_STAFF);

  // Auto-mark overdue leads
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      setLeads(prev => prev.map(lead => {
        if (lead.status === "won" || lead.status === "lost" || lead.status === "overdue") return lead;
        if (!lead.nextFollowUpDate || !lead.nextFollowUpTime) return lead;
        const followUpDateTime = new Date(`${lead.nextFollowUpDate}T${lead.nextFollowUpTime}`);
        if (now > followUpDateTime) {
          return { ...lead, status: "overdue" as LeadStatus };
        }
        return lead;
      }));
    }, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const addLead = (lead: Omit<Lead, "id" | "createdAt" | "lastFollowUp" | "updatedAt" | "updatedBy">) => {
    const now = new Date().toISOString().split("T")[0];
    setLeads(prev => [...prev, {
      ...lead,
      id: `L${String(prev.length + 1).padStart(3, "0")}`,
      createdAt: now,
      lastFollowUp: now,
      updatedAt: now,
      updatedBy: lead.createdBy,
    }]);
  };

  const updateLeadStatus = (id: string, status: LeadStatus, userId: string) => {
    const now = new Date().toISOString().split("T")[0];
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status, lastFollowUp: now, updatedAt: now, updatedBy: userId } : l));
  };

  const assignDelivery = (leadId: string, deliveryDate: string, deliveryNotes: string, assignedTo: string, userId: string) => {
    const now = new Date().toISOString().split("T")[0];
    // Update lead with delivery info
    setLeads(prev => prev.map(l => l.id === leadId ? {
      ...l, deliveryDate, deliveryNotes, deliveryAssignedTo: assignedTo,
      updatedAt: now, updatedBy: userId,
    } : l));

    // Find the lead to create delivery job
    const lead = leads.find(l => l.id === leadId);
    if (lead) {
      const jobId = `D${String(serviceJobs.length + 1).padStart(3, "0")}`;
      setServiceJobs(prev => [...prev, {
        id: jobId,
        customerName: lead.customerName,
        customerPhone: lead.customerPhone,
        address: deliveryNotes,
        category: lead.category,
        description: `Delivery for ${lead.category} - ₹${lead.valueInRupees.toLocaleString("en-IN")}`,
        dateReceived: now,
        dateToAttend: deliveryDate,
        value: lead.valueInRupees,
        isFOC: false,
        status: "pending",
        assignedAgent: "",
        type: "delivery",
        sourceLeadId: leadId,
      }]);

      // Notify service head
      addNotification({
        userId: "3", // service head
        message: `New delivery assigned: ${lead.customerName} - ${lead.category} (₹${lead.valueInRupees.toLocaleString("en-IN")})`,
        type: "delivery",
        read: false,
      });
    }
  };

  const addServiceJob = (job: Omit<ServiceJob, "id">) => {
    setServiceJobs(prev => [...prev, { ...job, id: `S${String(prev.length + 1).padStart(3, "0")}` }]);
  };

  const updateServiceJob = (id: string, updates: Partial<ServiceJob>) => {
    setServiceJobs(prev => prev.map(j => j.id === id ? { ...j, ...updates } : j));

    // Auto-notifications
    if (updates.agentReachedAt) {
      const job = serviceJobs.find(j => j.id === id);
      if (job) {
        addNotification({
          userId: "3",
          message: `Agent reached site: ${job.customerName} at ${job.address}`,
          type: "info",
          read: false,
        });
      }
    }
    if (updates.status === "completed") {
      const job = serviceJobs.find(j => j.id === id);
      if (job) {
        addNotification({
          userId: "3",
          message: `Job completed: ${job.customerName} - ${job.description}`,
          type: "success",
          read: false,
        });
      }
    }
    if (updates.assignedAgent && updates.assignedAgent !== "") {
      const job = serviceJobs.find(j => j.id === id);
      if (job) {
        addNotification({
          userId: updates.assignedAgent,
          message: `New job assigned: ${job.customerName} at ${job.address}`,
          type: "info",
          read: false,
        });
      }
    }
  };

  const addSiteVisit = (visit: Omit<SiteVisit, "id">) => {
    setSiteVisits(prev => [...prev, { ...visit, id: `V${String(prev.length + 1).padStart(3, "0")}` }]);
  };

  const addNotification = (n: Omit<Notification, "id" | "createdAt">) => {
    setNotifications(prev => [...prev, { ...n, id: `N${String(prev.length + 1).padStart(3, "0")}`, createdAt: new Date().toISOString() }]);
  };

  const markNotificationRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const addStaff = (s: Omit<StaffMember, "id">) => {
    setStaff(prev => [...prev, { ...s, id: String(Math.max(...prev.map(p => Number(p.id)), 0) + 1) }]);
  };

  const removeStaff = (id: string) => {
    setStaff(prev => prev.map(s => s.id === id ? { ...s, active: false } : s));
  };

  const getStaffByRole = (role: string) => staff.filter(s => s.role === role && s.active);

  return (
    <DataContext.Provider value={{
      leads, serviceJobs, siteVisits, notifications, staff,
      addLead, updateLeadStatus, assignDelivery,
      addServiceJob, updateServiceJob, addSiteVisit,
      addNotification, markNotificationRead,
      addStaff, removeStaff, getStaffByRole,
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
