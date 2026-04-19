import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { DataProvider } from "@/contexts/DataContext";
import AppLayout from "@/components/AppLayout";
import Login from "@/pages/Login";
import { Loader2 } from "lucide-react";

const AdminDashboard = lazy(() => import("@/pages/AdminDashboard"));
const SalesDashboard = lazy(() => import("@/pages/SalesDashboard"));
const SalesPipeline = lazy(() => import("@/pages/SalesPipeline"));
const ServiceDashboard = lazy(() => import("@/pages/ServiceDashboard"));
const ServiceCalendar = lazy(() => import("@/pages/ServiceCalendar"));
const ServiceClaims = lazy(() => import("@/pages/ServiceClaims"));
const FieldAgentDashboard = lazy(() => import("@/pages/FieldAgentDashboard"));
const SiteAgentDashboard = lazy(() => import("@/pages/SiteAgentDashboard"));
const SiteAgentLeads = lazy(() => import("@/pages/SiteAgentLeads"));
const AdminCategories = lazy(() => import("@/pages/AdminCategories"));
const AdminProducts = lazy(() => import("@/pages/AdminProducts"));
const ProductsView = lazy(() => import("@/pages/ProductsView"));
const SalesLeaderboard = lazy(() => import("@/pages/SalesLeaderboard"));
const NotFound = lazy(() => import("@/pages/NotFound"));

const PageLoader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="w-6 h-6 animate-spin text-primary" />
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: true,
      retry: 2,
    },
  },
});

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
            <Route path="/site-agent-leads" element={<SiteAgentLeads />} />
            <Route path="/categories" element={<AdminCategories />} />
            <Route path="/products" element={<AdminProducts />} />
            <Route path="/admin/products" element={<AdminProducts />} />
            <Route path="/sales-leaderboard" element={<SalesLeaderboard />} />
          </>
        );
      case "sales":
        return (
          <>
            <Route path="/" element={<SalesDashboard />} />
            <Route path="/leads" element={<SalesDashboard />} />
            <Route path="/pipeline" element={<SalesPipeline />} />
            <Route path="/products" element={<ProductsView />} />
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
            <Route path="/products" element={<ProductsView />} />
          </>
        );
      default:
        return <Route path="/" element={<NotFound />} />;
    }
  };

  return (
    <AppLayout>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {renderRoutes()}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
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
