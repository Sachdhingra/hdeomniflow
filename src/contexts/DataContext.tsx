import React, { createContext, useContext, useState, ReactNode } from "react";

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

export type LeadStatus = "new" | "contacted" | "follow_up" | "negotiation" | "won" | "lost";

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
  notes: string;
  source: "sales" | "site_agent";
}

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
  status: "pending" | "assigned" | "in_progress" | "completed";
  assignedAgent: string;
  claimPartNo?: string;
  claimReason?: string;
  claimDueDate?: string;
  completedAt?: string;
  agentReachedAt?: string;
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
}

interface DataContextType {
  leads: Lead[];
  serviceJobs: ServiceJob[];
  siteVisits: SiteVisit[];
  addLead: (lead: Omit<Lead, "id" | "createdAt" | "lastFollowUp">) => void;
  updateLeadStatus: (id: string, status: LeadStatus) => void;
  addServiceJob: (job: Omit<ServiceJob, "id">) => void;
  updateServiceJob: (id: string, updates: Partial<ServiceJob>) => void;
  addSiteVisit: (visit: Omit<SiteVisit, "id">) => void;
}

const DataContext = createContext<DataContextType | null>(null);

// Sample data
const SAMPLE_LEADS: Lead[] = [
  { id: "L001", customerName: "Rajesh Gupta", customerPhone: "9876543210", category: "sofa", valueInRupees: 85000, status: "new", assignedTo: "2", createdAt: "2026-03-25", lastFollowUp: "2026-03-25", notes: "Interested in L-shape sofa", source: "sales" },
  { id: "L002", customerName: "Meena Agarwal", customerPhone: "9876543211", category: "dining", valueInRupees: 120000, status: "follow_up", assignedTo: "2", createdAt: "2026-03-20", lastFollowUp: "2026-03-26", notes: "6-seater dining set", source: "sales" },
  { id: "L003", customerName: "Suresh Reddy", customerPhone: "9876543212", category: "bed", valueInRupees: 65000, status: "negotiation", assignedTo: "2", createdAt: "2026-03-18", lastFollowUp: "2026-03-27", notes: "King size with storage", source: "sales" },
  { id: "L004", customerName: "Anita Desai", customerPhone: "9876543213", category: "kitchen", valueInRupees: 250000, status: "contacted", assignedTo: "2", createdAt: "2026-03-22", lastFollowUp: "2026-03-24", notes: "Full modular kitchen", source: "sales" },
  { id: "L005", customerName: "Vijay Malhotra", customerPhone: "9876543214", category: "almirah", valueInRupees: 45000, status: "won", assignedTo: "2", createdAt: "2026-03-10", lastFollowUp: "2026-03-15", notes: "3-door wardrobe", source: "sales" },
];

const SAMPLE_JOBS: ServiceJob[] = [
  { id: "S001", customerName: "Kiran Bhat", customerPhone: "9876543220", address: "12 MG Road, Bangalore", category: "sofa", description: "Fabric tear repair", dateReceived: "2026-03-26", dateToAttend: "2026-03-28", value: 3500, isFOC: false, status: "assigned", assignedAgent: "4" },
  { id: "S002", customerName: "Pooja Nair", customerPhone: "9876543221", address: "45 Koramangala, Bangalore", category: "bed", description: "Hydraulic mechanism issue", dateReceived: "2026-03-25", dateToAttend: "2026-03-28", value: 0, isFOC: true, status: "pending", assignedAgent: "", claimPartNo: "HYD-2045", claimReason: "Manufacturing defect", claimDueDate: "2026-04-05" },
  { id: "S003", customerName: "Arjun Mehta", customerPhone: "9876543222", address: "78 Indiranagar, Bangalore", category: "kitchen", description: "Hinge replacement", dateReceived: "2026-03-27", dateToAttend: "2026-03-29", value: 1200, isFOC: false, status: "in_progress", assignedAgent: "4" },
];

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const [leads, setLeads] = useState<Lead[]>(SAMPLE_LEADS);
  const [serviceJobs, setServiceJobs] = useState<ServiceJob[]>(SAMPLE_JOBS);
  const [siteVisits, setSiteVisits] = useState<SiteVisit[]>([]);

  const addLead = (lead: Omit<Lead, "id" | "createdAt" | "lastFollowUp">) => {
    const now = new Date().toISOString().split("T")[0];
    setLeads(prev => [...prev, { ...lead, id: `L${String(prev.length + 1).padStart(3, "0")}`, createdAt: now, lastFollowUp: now }]);
  };

  const updateLeadStatus = (id: string, status: LeadStatus) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status, lastFollowUp: new Date().toISOString().split("T")[0] } : l));
  };

  const addServiceJob = (job: Omit<ServiceJob, "id">) => {
    setServiceJobs(prev => [...prev, { ...job, id: `S${String(prev.length + 1).padStart(3, "0")}` }]);
  };

  const updateServiceJob = (id: string, updates: Partial<ServiceJob>) => {
    setServiceJobs(prev => prev.map(j => j.id === id ? { ...j, ...updates } : j));
  };

  const addSiteVisit = (visit: Omit<SiteVisit, "id">) => {
    setSiteVisits(prev => [...prev, { ...visit, id: `V${String(prev.length + 1).padStart(3, "0")}` }]);
  };

  return (
    <DataContext.Provider value={{ leads, serviceJobs, siteVisits, addLead, updateLeadStatus, addServiceJob, updateServiceJob, addSiteVisit }}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
};
