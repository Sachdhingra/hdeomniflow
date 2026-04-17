import { useMemo, useState } from "react";
import { useData, LEAD_CATEGORIES } from "@/contexts/DataContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, Search, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

const SiteAgentLeads = () => {
  const { leads, profiles, getProfilesByRole } = useData();
  const [search, setSearch] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const siteAgents = getProfilesByRole("site_agent");

  // Group leads by created_by_agent_id (fallback to assigned_to for older site_agent leads)
  const grouped = useMemo(() => {
    const siteLeads = leads.filter(l =>
      l.source === "site_agent" || (l as any).created_by_agent_id
    );
    const map = new Map<string, typeof siteLeads>();
    for (const l of siteLeads) {
      const key = (l as any).created_by_agent_id || l.assigned_to || "unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    }
    return map;
  }, [leads]);

  const filteredAgents = siteAgents.filter(a =>
    !search.trim() || a.name.toLowerCase().includes(search.toLowerCase())
  );

  if (selectedAgent) {
    const agent = profiles.find(p => p.id === selectedAgent);
    const agentLeads = grouped.get(selectedAgent) || [];
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedAgent(null)} className="gap-1">
            <ArrowLeft className="w-4 h-4" /> Back to all agents
          </Button>
        </div>
        <div>
          <h1 className="text-2xl font-bold">{agent?.name || "Agent"}'s Leads</h1>
          <p className="text-sm text-muted-foreground">{agentLeads.length} total leads</p>
        </div>
        <div className="grid gap-3">
          {agentLeads.length === 0 && (
            <p className="text-muted-foreground text-sm">No leads from this agent yet.</p>
          )}
          {agentLeads.map(l => (
            <Card key={l.id} className="shadow-card">
              <CardContent className="p-4 flex gap-3">
                {(l as any).visit_photo && (
                  <img
                    src={(l as any).visit_photo}
                    alt="Visit"
                    className="w-16 h-16 rounded object-cover border border-border shrink-0"
                    loading="lazy"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{l.customer_name}</p>
                      <p className="text-xs text-muted-foreground">{l.customer_phone}</p>
                    </div>
                    <Badge variant="outline" className="capitalize shrink-0">{l.status.replace("_", " ")}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                    <span>{LEAD_CATEGORIES.find(c => c.value === l.category)?.label}</span>
                    <span>•</span>
                    <span>₹{Number(l.value_in_rupees).toLocaleString("en-IN")}</span>
                    <span>•</span>
                    <span>{new Date(l.created_at).toLocaleDateString("en-IN")}</span>
                  </div>
                  {l.notes && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{l.notes}</p>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Site Agent Leads</h1>
        <p className="text-sm text-muted-foreground">Leads grouped by the site agent who originated them</p>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search agents..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filteredAgents.map(agent => {
          const agentLeads = grouped.get(agent.id) || [];
          const won = agentLeads.filter(l => l.status === "won").length;
          const wonValue = agentLeads.filter(l => l.status === "won").reduce((s, l) => s + Number(l.value_in_rupees), 0);
          return (
            <Card key={agent.id} className="shadow-card hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  {agent.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-xl font-bold">{agentLeads.length}</p>
                    <p className="text-xs text-muted-foreground">Leads</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold text-success">{won}</p>
                    <p className="text-xs text-muted-foreground">Won</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold">₹{(wonValue / 1000).toFixed(0)}K</p>
                    <p className="text-xs text-muted-foreground">Value</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => setSelectedAgent(agent.id)}
                  disabled={agentLeads.length === 0}
                >
                  View All Leads
                </Button>
              </CardContent>
            </Card>
          );
        })}
        {filteredAgents.length === 0 && (
          <p className="text-muted-foreground text-sm col-span-full">No site agents found.</p>
        )}
      </div>
    </div>
  );
};

export default SiteAgentLeads;
