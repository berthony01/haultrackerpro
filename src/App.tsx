import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect } from 'react';
import { trackPageView } from '@/lib/analytics';
import { useAuth } from "@/hooks/useAuth";
import { useAdmin } from "@/hooks/useAdmin";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Critical path — eagerly loaded
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";

// Everything else — lazy loaded
const Index = lazy(() => import("./pages/Index"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const FAQ = lazy(() => import("./pages/FAQ"));
const Features = lazy(() => import("./pages/Features"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Admin = lazy(() => import("./pages/Admin"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Install = lazy(() => import("./pages/Install"));
const NotFound = lazy(() => import("./pages/NotFound"));
const HowToUseHaulTrackerPro = lazy(() => import("./pages/HowToUseHaulTrackerPro"));

// SEO content pages
const TruckDriverTaxDeductions = lazy(() => import("./pages/TruckDriverTaxDeductions"));
const OwnerOperatorExpenseTracker = lazy(() => import("./pages/OwnerOperatorExpenseTracker"));
const TruckingProfitCalculator = lazy(() => import("./pages/TruckingProfitCalculator"));
const TruckerBookkeepingGuide = lazy(() => import("./pages/TruckerBookkeepingGuide"));
const TruckDriverExpenses = lazy(() => import("./pages/TruckDriverExpenses"));
const TruckDriverPerDiem = lazy(() => import("./pages/TruckDriverPerDiem"));
const OwnerOperatorSalary = lazy(() => import("./pages/OwnerOperatorSalary"));
const TruckingCostPerMile = lazy(() => import("./pages/TruckingCostPerMile"));
const TruckingExpensesList = lazy(() => import("./pages/TruckingExpensesList"));
const OwnerOperatorExpensesList = lazy(() => import("./pages/OwnerOperatorExpensesList"));
const TruckingFinanceGuides = lazy(() => import("./pages/TruckingFinanceGuides"));
const FuelCostPerMileTrucking = lazy(() => import("./pages/FuelCostPerMileTrucking"));
const TruckingMaintenanceCostPerMile = lazy(() => import("./pages/TruckingMaintenanceCostPerMile"));
const TruckDriverFuelExpenses = lazy(() => import("./pages/TruckDriverFuelExpenses"));
const TruckingExpenseCategories = lazy(() => import("./pages/TruckingExpenseCategories"));
const OwnerOperatorTaxWriteOffs = lazy(() => import("./pages/OwnerOperatorTaxWriteOffs"));
const TruckerFuelCostCalculator = lazy(() => import("./pages/TruckerFuelCostCalculator"));
const TruckingMileageExpenseGuide = lazy(() => import("./pages/TruckingMileageExpenseGuide"));
const TruckerCostPerMileBreakdown = lazy(() => import("./pages/TruckerCostPerMileBreakdown"));
const OwnerOperatorOperatingCosts = lazy(() => import("./pages/OwnerOperatorOperatingCosts"));
const TruckDriverOperatingExpenses = lazy(() => import("./pages/TruckDriverOperatingExpenses"));
const TruckingCostPerMileCalculator = lazy(() => import("./pages/TruckingCostPerMileCalculator"));
const TruckingLoadProfitCalculator = lazy(() => import("./pages/TruckingLoadProfitCalculator"));
const ToolsLoadProfitCalculator = lazy(() => import("./pages/tools/LoadProfitCalculator"));
const ToolsFuelCostPerMile = lazy(() => import("./pages/tools/FuelCostPerMileCalculator"));

const queryClient = new QueryClient();

const PageFallback = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <p className="text-muted-foreground">Loading...</p>
  </div>
);

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <PageFallback />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <PageFallback />;
  if (!user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <PageFallback />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { isAdmin, isLoading } = useAdmin();
  if (loading || isLoading) return <PageFallback />;
  if (!user || !isAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function PageViewTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageView(location.pathname + location.search);
  }, [location]);
  return null;
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <PageViewTracker />
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<PublicRoute><Landing /></PublicRoute>} />
              <Route path="/dashboard" element={<ProtectedRoute><Index /></ProtectedRoute>} />
              <Route path="/landing" element={<Navigate to="/" replace />} />
              <Route path="/auth" element={<AuthRoute><Auth /></AuthRoute>} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/faq" element={<FAQ />} />
              <Route path="/features" element={<Features />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/install" element={<Install />} />
              <Route path="/truck-driver-tax-deductions" element={<TruckDriverTaxDeductions />} />
              <Route path="/owner-operator-expense-tracker" element={<OwnerOperatorExpenseTracker />} />
              <Route path="/trucking-profit-calculator" element={<TruckingProfitCalculator />} />
              <Route path="/trucker-bookkeeping-guide" element={<TruckerBookkeepingGuide />} />
              <Route path="/truck-driver-expenses" element={<TruckDriverExpenses />} />
              <Route path="/truck-driver-per-diem" element={<TruckDriverPerDiem />} />
              <Route path="/owner-operator-salary" element={<OwnerOperatorSalary />} />
              <Route path="/trucking-cost-per-mile" element={<TruckingCostPerMile />} />
              <Route path="/trucking-expenses-list" element={<TruckingExpensesList />} />
              <Route path="/owner-operator-expenses-list" element={<OwnerOperatorExpensesList />} />
              <Route path="/trucking-finance-guides" element={<TruckingFinanceGuides />} />
              <Route path="/fuel-cost-per-mile-trucking" element={<FuelCostPerMileTrucking />} />
              <Route path="/trucking-maintenance-cost-per-mile" element={<TruckingMaintenanceCostPerMile />} />
              <Route path="/truck-driver-fuel-expenses" element={<TruckDriverFuelExpenses />} />
              <Route path="/trucking-expense-categories" element={<TruckingExpenseCategories />} />
              <Route path="/owner-operator-tax-write-offs" element={<OwnerOperatorTaxWriteOffs />} />
              <Route path="/trucker-fuel-cost-calculator" element={<TruckerFuelCostCalculator />} />
              <Route path="/trucking-mileage-expense-guide" element={<TruckingMileageExpenseGuide />} />
              <Route path="/trucker-cost-per-mile-breakdown" element={<TruckerCostPerMileBreakdown />} />
              <Route path="/owner-operator-operating-costs" element={<OwnerOperatorOperatingCosts />} />
              <Route path="/truck-driver-operating-expenses" element={<TruckDriverOperatingExpenses />} />
              <Route path="/trucking-cost-per-mile-calculator" element={<TruckingCostPerMileCalculator />} />
              <Route path="/trucking-load-profit-calculator" element={<TruckingLoadProfitCalculator />} />
              <Route path="/tools/load-profit-calculator" element={<ToolsLoadProfitCalculator />} />
              <Route path="/tools/fuel-cost-per-mile" element={<ToolsFuelCostPerMile />} />
              <Route path="/how-to-use-haultrackerpro" element={<HowToUseHaulTrackerPro />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
