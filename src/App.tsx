import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { DataProvider } from "@/contexts/DataContext";
import AppLayout from "@/components/AppLayout";
import Login from "@/pages/Login";
import AdminDashboard from "@/pages/AdminDashboard";
import SalesDashboard from "@/pages/SalesDashboard";
import SalesPipeline from "@/pages/SalesPipeline";
import ServiceDashboard from "@/pages/ServiceDashboard";
import ServiceCalendar from "@/pages/ServiceCalendar";
import ServiceClaims from "@/pages/ServiceClaims";
import FieldAgentDashboard from "@/pages/FieldAgentDashboard";
import SiteAgentDashboard from "@/pages/SiteAgentDashboard";
import NotFound from "@/pages/NotFound";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

const AppRoutes = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Login />;

  const renderRoutes = () => {
    switch (user.role) {
      case "admin":
        return (
          <>
            <Route path="/" element={<AdminDashboard />} />
            <Route path="/sales" element={<SalesDashboard />} />
            <Route path="/service" element={<ServiceDashboard />} />
            <Route path="/field-agents" element={<FieldAgentDashboard />} />
            <Route path="/site-agents" element={<SiteAgentDashboard />} />
          </>
        );
      case "sales":
        return (
          <>
            <Route path="/" element={<SalesDashboard />} />
            <Route path="/leads" element={<SalesDashboard />} />
            <Route path="/pipeline" element={<SalesPipeline />} />
          </>
        );
      case "service_head":
        return (
          <>
            <Route path="/" element={<ServiceDashboard />} />
            <Route path="/service-jobs" element={<ServiceDashboard />} />
            <Route path="/claims" element={<ServiceClaims />} />
            <Route path="/calendar" element={<ServiceCalendar />} />
          </>
        );
      case "field_agent":
        return (
          <>
            <Route path="/" element={<FieldAgentDashboard />} />
            <Route path="/map" element={<FieldAgentDashboard />} />
          </>
        );
      case "site_agent":
        return (
          <>
            <Route path="/" element={<SiteAgentDashboard />} />
            <Route path="/site-visits" element={<SiteAgentDashboard />} />
            <Route path="/my-leads" element={<SalesDashboard />} />
          </>
        );
      default:
        return <Route path="/" element={<NotFound />} />;
    }
  };

  return (
    <AppLayout>
      <Routes>
        {renderRoutes()}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppLayout>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <DataProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </DataProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
