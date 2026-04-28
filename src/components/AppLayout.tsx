import { ReactNode, useState } from "react";
import { useAuth, UserRole } from "@/contexts/AuthContext";
import { useData } from "@/contexts/DataContext";
import { NavLink, useLocation } from "react-router-dom";
import {
  Building2, LayoutDashboard, Users, Wrench, Navigation, MapPin,
  LogOut, Menu, X, ChevronRight, CalendarDays, BarChart3,
  ClipboardList, FileText, MapPinned, FolderTree, Package, KanbanSquare, Bot, ShieldCheck, MessageSquare
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import NotificationPanel from "@/components/NotificationPanel";
import NetworkStatusBadge from "@/components/NetworkStatusBadge";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number;
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  sales: "Sales",
  service_head: "Service Head",
  field_agent: "Field Agent",
  site_agent: "Site Agent",
  accounts: "Accounts",
};

const AppLayout = ({ children }: { children: ReactNode }) => {
  const { user, logout, forceLogout } = useAuth();
  const { notifications, error, summary } = useData();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (!user) return null;

  const overdueCount = summary.overdueLeads;
  const pendingJobCount = summary.pendingJobs;
  const myUnread = notifications.filter(n => (n.user_id === user.id || user.role === "admin") && !n.read).length;

  const NAV_ITEMS: Record<UserRole, NavItem[]> = {
    admin: [
      { to: "/", label: "Dashboard", icon: <LayoutDashboard className="w-5 h-5" /> },
      { to: "/sales", label: "Sales", icon: <Users className="w-5 h-5" />, badge: overdueCount || undefined },
      { to: "/leads/board", label: "Leads Board", icon: <KanbanSquare className="w-5 h-5" /> },
      { to: "/service", label: "Service", icon: <Wrench className="w-5 h-5" />, badge: pendingJobCount || undefined },
      { to: "/accounts/approvals", label: "Accounts Approvals", icon: <ShieldCheck className="w-5 h-5" /> },
      { to: "/field-agents", label: "Field Agents", icon: <Navigation className="w-5 h-5" /> },
      { to: "/site-agents", label: "Site Agents", icon: <MapPin className="w-5 h-5" /> },
      { to: "/categories", label: "Categories", icon: <FolderTree className="w-5 h-5" /> },
      { to: "/products", label: "Products", icon: <Package className="w-5 h-5" /> },
      { to: "/admin/automation", label: "Automation", icon: <Bot className="w-5 h-5" /> },
    ],
    sales: [
      { to: "/", label: "Dashboard", icon: <LayoutDashboard className="w-5 h-5" />, badge: overdueCount || undefined },
      { to: "/leads", label: "My Leads", icon: <ClipboardList className="w-5 h-5" /> },
      { to: "/leads/board", label: "Leads Board", icon: <KanbanSquare className="w-5 h-5" /> },
      { to: "/pipeline", label: "Pipeline", icon: <BarChart3 className="w-5 h-5" /> },
      { to: "/products", label: "Products", icon: <Package className="w-5 h-5" /> },
    ],
    service_head: [
      { to: "/", label: "Dashboard", icon: <LayoutDashboard className="w-5 h-5" />, badge: pendingJobCount || undefined },
      { to: "/service-jobs", label: "Service Jobs", icon: <Wrench className="w-5 h-5" /> },
      { to: "/claims", label: "Claims", icon: <FileText className="w-5 h-5" /> },
      { to: "/calendar", label: "Calendar", icon: <CalendarDays className="w-5 h-5" /> },
    ],
    field_agent: [
      { to: "/", label: "My Jobs", icon: <Wrench className="w-5 h-5" /> },
      { to: "/map", label: "Map", icon: <MapPinned className="w-5 h-5" /> },
    ],
    site_agent: [
      { to: "/", label: "Dashboard", icon: <LayoutDashboard className="w-5 h-5" /> },
      { to: "/site-visits", label: "Site Visits", icon: <MapPin className="w-5 h-5" /> },
      { to: "/my-leads", label: "My Leads", icon: <ClipboardList className="w-5 h-5" /> },
      { to: "/products", label: "Products", icon: <Package className="w-5 h-5" /> },
    ],
    accounts: [
      { to: "/", label: "Approvals", icon: <ShieldCheck className="w-5 h-5" /> },
      { to: "/accounts/approvals", label: "All Approvals", icon: <ClipboardList className="w-5 h-5" /> },
    ],
  };

  const navItems = NAV_ITEMS[user.role];

  return (
    <div className="min-h-screen flex bg-background">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-foreground/20 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`fixed lg:sticky top-0 left-0 h-screen w-64 gradient-sidebar z-50 flex flex-col transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
        <div className="p-4 flex items-center gap-2 border-b border-sidebar-border">
          <div className="gradient-primary rounded-lg p-1.5">
            <Building2 className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold text-sidebar-foreground tracking-tight">FurnCRM</span>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden ml-auto text-sidebar-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                }`
              }
            >
              {item.icon}
              {item.label}
              {item.badge && item.badge > 0 && (
                <Badge className="ml-auto bg-destructive text-destructive-foreground text-xs px-1.5 py-0">{item.badge}</Badge>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-primary-foreground text-sm font-bold">
              {user.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">{user.name}</p>
              <p className="text-xs text-sidebar-foreground/50">{ROLE_LABELS[user.role]}</p>
            </div>
            <div className="flex flex-col gap-1">
              <button onClick={logout} className="text-sidebar-foreground/50 hover:text-sidebar-foreground" title="Logout">
                <LogOut className="w-4 h-4" />
              </button>
              <button onClick={forceLogout} className="text-destructive/50 hover:text-destructive" title="Force Logout (clears all data)">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 bg-card/80 backdrop-blur-sm border-b border-border px-4 py-3 flex items-center gap-3">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-foreground">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1" />
          <NetworkStatusBadge />
          <NotificationPanel />
        </header>
        <main className="flex-1 p-4 lg:p-6 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
