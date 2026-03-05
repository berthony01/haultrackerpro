import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAdmin } from "@/hooks/useAdmin";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Landing from "./pages/Landing";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import FAQ from "./pages/FAQ";
import Features from "./pages/Features";
import Pricing from "./pages/Pricing";
import Admin from "./pages/Admin";
import ResetPassword from "./pages/ResetPassword";
import Install from "./pages/Install";
import TruckDriverTaxDeductions from "./pages/TruckDriverTaxDeductions";
import OwnerOperatorExpenseTracker from "./pages/OwnerOperatorExpenseTracker";
import TruckingProfitCalculator from "./pages/TruckingProfitCalculator";
import TruckerBookkeepingGuide from "./pages/TruckerBookkeepingGuide";
import TruckDriverExpenses from "./pages/TruckDriverExpenses";
import TruckDriverPerDiem from "./pages/TruckDriverPerDiem";
import OwnerOperatorSalary from "./pages/OwnerOperatorSalary";
import TruckingCostPerMile from "./pages/TruckingCostPerMile";
import TruckingExpensesList from "./pages/TruckingExpensesList";
import OwnerOperatorExpensesList from "./pages/OwnerOperatorExpensesList";
import TruckingFinanceGuides from "./pages/TruckingFinanceGuides";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;
  if (!user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { isAdmin, isLoading } = useAdmin();
  if (loading || isLoading) return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground">Loading...</p></div>;
  if (!user || !isAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
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
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
