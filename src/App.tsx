import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { DataProvider } from "@/contexts/DataContext";
import { ChatUnreadProvider } from "@/contexts/ChatUnreadContext";
import { PresenceProvider } from "@/contexts/PresenceContext";
import AppLayout from "@/components/AppLayout";
import Login from "@/pages/Login";
import PWAInstallPrompt from "@/components/PWAInstallPrompt";
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
const LeadsBoard = lazy(() => import("@/pages/LeadsBoard"));
const AdminAutomation = lazy(() => import("@/pages/AdminAutomation"));
const AdminMessageTemplates = lazy(() => import("@/pages/AdminMessageTemplates"));
const AdminFunnelAnalytics = lazy(() => import("@/pages/AdminFunnelAnalytics"));
const AccountsApprovals = lazy(() => import("@/pages/AccountsApprovals"));
const AdminOrdersDashboard = lazy(() => import("@/pages/AdminOrdersDashboard"));
const ChatPage = lazy(() => import("@/pages/ChatPage"));
const AIAssistantPage = lazy(() => import("@/pages/AIAssistantPage"));
const AttendancePage = lazy(() => import("@/pages/AttendancePage"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const FeedbackKiosk = lazy(() => import("@/pages/FeedbackKiosk"));
const FeedbackAnalyticsDashboard = lazy(() => import("@/pages/FeedbackAnalyticsDashboard"));
const AdminSchemeBanners = lazy(() => import("@/pages/AdminSchemeBanners"));
const AdminCompanyPurchases = lazy(() => import("@/pages/AdminCompanyPurchases"));
const ProfileViewScreen = lazy(() => import("@/pages/ProfileViewScreen"));
const ProfileEditScreen = lazy(() => import("@/pages/ProfileEditScreen"));
const StaffDirectory = lazy(() => import("@/pages/StaffDirectory"));
const MonthlyLeaderboard = lazy(() => import("@/pages/MonthlyLeaderboard"));
const EliteCustomers = lazy(() => import("@/pages/EliteCustomers"));
const InventoryManager = lazy(() => import("@/pages/InventoryManager"));
import KioskModeWrapper from "@/components/kiosk/KioskModeWrapper";
import ProfileGate from "@/components/staff/ProfileGate";

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
            <Route path="/leads/board" element={<LeadsBoard />} />
            <Route path="/admin/automation" element={<AdminAutomation />} />
            <Route path="/admin/templates" element={<AdminMessageTemplates />} />
            <Route path="/admin/funnel-analytics" element={<AdminFunnelAnalytics />} />
            <Route path="/accounts/approvals" element={<AccountsApprovals />} />
            <Route path="/admin/orders" element={<AdminOrdersDashboard />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/ai-assistant" element={<AIAssistantPage />} />
            <Route path="/admin/feedback" element={<FeedbackAnalyticsDashboard />} />
            <Route path="/dashboard/feedback-analytics" element={<FeedbackAnalyticsDashboard />} />
            <Route path="/admin/kiosk-banners" element={<AdminSchemeBanners />} />
            <Route path="/accounts/purchases" element={<AdminCompanyPurchases />} />
          </>
        );
      case "accounts":
        return (
          <>
            <Route path="/" element={<AccountsApprovals />} />
            <Route path="/accounts/approvals" element={<AccountsApprovals />} />
            <Route path="/accounts/purchases" element={<AdminCompanyPurchases />} />
            <Route path="/chat" element={<ChatPage />} />
          </>
        );
      case "sales":
        return (
          <>
            <Route path="/" element={<SalesDashboard />} />
            <Route path="/leads" element={<SalesDashboard />} />
            <Route path="/leads/board" element={<LeadsBoard />} />
            <Route path="/pipeline" element={<SalesPipeline />} />
            <Route path="/products" element={<ProductsView />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/ai-assistant" element={<AIAssistantPage />} />
          </>
        );
      case "service_head":
        return (
          <>
            <Route path="/" element={<ServiceDashboard />} />
            <Route path="/service-jobs" element={<ServiceDashboard />} />
            <Route path="/claims" element={<ServiceClaims />} />
            <Route path="/calendar" element={<ServiceCalendar />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/ai-assistant" element={<AIAssistantPage />} />
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
      <ProfileGate>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {renderRoutes()}
            <Route path="/attendance" element={<AttendancePage />} />
            <Route path="/profile" element={<ProfileViewScreen />} />
            <Route path="/profile/edit" element={<ProfileEditScreen />} />
            <Route path="/profile/setup" element={<ProfileEditScreen />} />
            <Route path="/directory" element={<StaffDirectory />} />
            <Route path="/dashboard/leaderboard" element={<MonthlyLeaderboard />} />
            <Route path="/elite-customers" element={<EliteCustomers />} />
            <Route path="/inventory" element={<InventoryManager />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ProfileGate>
    </AppLayout>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner position="top-right" richColors closeButton />
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/feedback" element={<FeedbackKiosk />} />
            <Route path="/feedback/exit" element={<FeedbackKiosk />} />
            <Route
              path="/kiosk/feedback"
              element={
                <KioskModeWrapper enableAutoReset resetTimeoutMinutes={5} resetPath="/kiosk/feedback">
                  <FeedbackKiosk />
                </KioskModeWrapper>
              }
            />
            <Route
              path="/*"
              element={
                <AuthProvider>
                  <DataProvider>
                    <ChatUnreadProvider>
                      <PresenceProvider>
                        <AppRoutes />
                        <PWAInstallPrompt />
                      </PresenceProvider>
                    </ChatUnreadProvider>
                  </DataProvider>
                </AuthProvider>
              }
            />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
