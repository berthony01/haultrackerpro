import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect } from 'react';
import { trackPageView } from '@/lib/analytics';
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useAdmin } from "@/hooks/useAdmin";
import { useRoleIntentReconciler } from "@/hooks/useRoleIntentReconciler";
import { ActingContextProvider } from "@/hooks/useActingContext";
import { ActingAsBanner } from "@/components/assistants/ActingAsBanner";
import { PendingDelegationBanner } from "@/components/agency/PendingDelegationBanner";
import { OwnerQaModeBanner } from "@/components/admin/OwnerQaModeBanner";

import { ErrorBoundary } from "./components/ErrorBoundary";

// Critical path — eagerly loaded
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";

// Lazy import with one-shot retry on chunk-load failure. A failed dynamic
// import (stale build / transient network) used to flash Landing's
// "Start Free…" hero — now we reload once and resume cleanly.
function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  key: string,
) {
  return lazy(() =>
    factory().catch((err) => {
      const flag = `lwr:${key}`;
      try {
        if (!sessionStorage.getItem(flag)) {
          sessionStorage.setItem(flag, '1');
          window.location.reload();
          // Return a never-resolving promise so Suspense keeps the fallback
          // up while the page reloads.
          return new Promise<{ default: T }>(() => {});
        }
      } catch {}
      throw err;
    }),
  );
}

// Everything else — lazy loaded
const Index = lazyWithRetry(() => import("./pages/Index"), "Index");
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const FAQ = lazy(() => import("./pages/FAQ"));
const Features = lazy(() => import("./pages/Features"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Recruiters = lazy(() => import("./pages/Recruiters"));
const Admin = lazy(() => import("./pages/Admin"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Install = lazy(() => import("./pages/Install"));
const OAuthConsent = lazy(() => import("./pages/OAuthConsent"));
const NotFound = lazy(() => import("./pages/NotFound"));
const HowToUseHaulTrackerPro = lazy(() => import("./pages/HowToUseHaulTrackerPro"));
const Parking = lazy(() => import("./pages/Parking"));
const StarterKit = lazy(() => import("./pages/StarterKit"));
const StarterKitThanks = lazy(() => import("./pages/StarterKitThanks"));
const Updates = lazy(() => import("./pages/Updates"));
const RecruiterFAQ = lazy(() => import("./pages/recruiter/RecruiterFAQ"));
const RecruiterFeatures = lazy(() => import("./pages/recruiter/RecruiterFeatures"));
const RecruiterGuide = lazy(() => import("./pages/recruiter/RecruiterGuide"));
const RecruiterUpdates = lazy(() => import("./pages/recruiter/RecruiterUpdates"));
const RecruiterEntryRoute = lazy(() => import("./components/opportunities/recruiter/RecruiterEntryRoute"));
const RecruiterInviteAccept = lazy(() => import("./pages/RecruiterInviteAccept"));
const About = lazy(() => import("./pages/About"));
const CompareVsSpreadsheets = lazy(() => import("./pages/comparisons/HaulTrackerProVsSpreadsheets"));
const CompareVsQuickBooks = lazy(() => import("./pages/comparisons/HaulTrackerProVsQuickBooks"));
const BestProfitTracker = lazy(() => import("./pages/comparisons/BestTruckDriverProfitTracker"));
const ResourceArticlesAdmin = lazy(() => import("./pages/admin/ResourceArticlesAdmin"));
const ContentCalendarAdmin = lazy(() => import("./pages/admin/ContentCalendarAdmin"));
const OwnerQaCenter = lazy(() => import("./pages/OwnerQaCenter"));
const ResourceArticleDynamic = lazy(() => import("./pages/resources/ResourceArticleDynamic"));
const AssistantDashboard = lazy(() => import("./pages/AssistantDashboard"));
const AssistantInviteAccept = lazy(() => import("./pages/AssistantInviteAccept"));
const AssistantLimitedSettings = lazy(() => import("./pages/AssistantLimitedSettings"));
const AgencyDashboard = lazy(() => import("./pages/AgencyDashboard"));
const AgencyInviteAccept = lazy(() => import("./pages/AgencyInviteAccept"));
const AgencyRequestPublic = lazy(() => import("./pages/AgencyRequestPublic"));
const DriverDelegationApprovals = lazy(() => import("./pages/DriverDelegationApprovals"));
const DriverAssistantControl = lazy(() => import("./pages/DriverAssistantControl"));
const DriverWorkItems = lazy(() => import("./pages/DriverWorkItems"));
const AgencySlugRedirect = lazy(() => import("./pages/AgencySlugRedirect"));
const AssistantsAgencies = lazy(() => import("./pages/AssistantsAgencies"));
const CapabilityLauncher = lazy(() => import("./pages/CapabilityLauncher"));
const ProfessionalProfile = lazy(() => import("./pages/ProfessionalProfile"));
const Docs = lazy(() => import("./pages/Docs"));
const DocsArticle = lazy(() => import("./pages/DocsArticle"));
const LegalCenter = lazy(() => import("./pages/LegalCenter"));

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

// Contract Protection SEO pillar pages
const TruckingContractReview = lazy(() => import("./pages/TruckingContractReview"));
const OwnerOperatorContractReview = lazy(() => import("./pages/OwnerOperatorContractReview"));
const LeasePurchaseContractRedFlags = lazy(() => import("./pages/LeasePurchaseContractRedFlags"));
const TruckingEscrowAgreementReview = lazy(() => import("./pages/TruckingEscrowAgreementReview"));
const TenNinetyNineTruckDriverContractProtection = lazy(() => import("./pages/TenNinetyNineTruckDriverContractProtection"));
const AiContractReviewForTruckers = lazy(() => import("./pages/AiContractReviewForTruckers"));

// Resource hub + guides
const ResourcesHub = lazy(() => import("./pages/resources/ResourcesHub"));
const ResProfitTracking = lazy(() => import("./pages/resources/ProfitTrackingGuide"));
const ResLoadProfit = lazy(() => import("./pages/resources/LoadProfitCalculatorGuide"));
const ResRealRpm = lazy(() => import("./pages/resources/RealRpmGuide"));
const Res1099Expenses = lazy(() => import("./pages/resources/ExpenseTrackingGuide1099"));
const ResContractClarity = lazy(() => import("./pages/resources/ContractClarityGuide"));
const ResParking = lazy(() => import("./pages/resources/ParkingTrackerGuide"));
const ResDriverReferral = lazy(() => import("./pages/resources/DriverReferralGuide"));
const ResRecruiterTools = lazy(() => import("./pages/resources/RecruiterToolsGuide"));

const queryClient = new QueryClient();

function PageFallback() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <p className="text-muted-foreground">Loading...</p>
    </div>
  );
}

import { resolvePostAuthDestination, buildAuthUrl } from '@/lib/authNavigation';

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageFallback />;
  if (user) return <Navigate to={resolvePostAuthDestination(location.search)} replace />;
  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageFallback />;
  if (!user) {
    const nextPath = `${location.pathname}${location.search}`;
    return <Navigate to={buildAuthUrl(nextPath)} replace />;
  }
  return <>{children}</>;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageFallback />;
  if (user) return <Navigate to={resolvePostAuthDestination(location.search)} replace />;
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

function RoleIntentReconcilerMount() {
  // Lives inside AuthProvider + QueryClientProvider so it can read auth state
  // and invalidate the user-role queries after upserting intended_role.
  useRoleIntentReconciler();
  return null;
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <ActingContextProvider>
            <PageViewTracker />
            <RoleIntentReconcilerMount />
            <OwnerQaModeBanner />
            <ActingAsBanner />
            <PendingDelegationBanner />

            <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<PublicRoute><Landing /></PublicRoute>} />
              <Route path="/dashboard" element={<ProtectedRoute><Index /></ProtectedRoute>} />
              <Route path="/landing" element={<Navigate to="/" replace />} />
              {/* Legacy/preview aliases — keep deep links and stale preview URLs working */}
              <Route path="/index" element={<Navigate to="/" replace />} />
              <Route path="/index.html" element={<Navigate to="/" replace />} />
              <Route path="/auth" element={<AuthRoute><Auth /></AuthRoute>} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/docs" element={<Docs />} />
              <Route path="/docs/:articleSlug" element={<DocsArticle />} />
              <Route path="/legal" element={<LegalCenter />} />
              <Route path="/faq" element={<FAQ />} />
              <Route path="/features" element={<Features />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/recruiters" element={<Recruiters />} />
              <Route path="/about" element={<About />} />
              <Route path="/assistants-agencies" element={<AssistantsAgencies />} />
              <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/install" element={<Install />} />
              <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
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
              <Route path="/trucking-contract-review" element={<TruckingContractReview />} />
              <Route path="/owner-operator-contract-review" element={<OwnerOperatorContractReview />} />
              <Route path="/lease-purchase-contract-red-flags" element={<LeasePurchaseContractRedFlags />} />
              <Route path="/trucking-escrow-agreement-review" element={<TruckingEscrowAgreementReview />} />
              <Route path="/1099-truck-driver-contract-protection" element={<TenNinetyNineTruckDriverContractProtection />} />
              <Route path="/ai-contract-review-for-truckers" element={<AiContractReviewForTruckers />} />
              <Route path="/how-to-use-haultrackerpro" element={<HowToUseHaulTrackerPro />} />
              <Route path="/parking" element={<ProtectedRoute><Parking /></ProtectedRoute>} />
              <Route path="/starter-kit" element={<StarterKit />} />
              <Route path="/starter-kit/thanks" element={<StarterKitThanks />} />
              <Route path="/updates" element={<ProtectedRoute><Updates /></ProtectedRoute>} />
              <Route path="/recruiter/faq" element={<RecruiterFAQ />} />
              <Route path="/recruiter/features" element={<RecruiterFeatures />} />
              <Route path="/recruiter/guide" element={<RecruiterGuide />} />
              <Route path="/recruiter/updates" element={<RecruiterUpdates />} />
              <Route path="/resources" element={<ResourcesHub />} />
              <Route path="/resources/truck-driver-profit-tracking" element={<ResProfitTracking />} />
              <Route path="/resources/load-profit-calculator" element={<ResLoadProfit />} />
              <Route path="/resources/real-rpm-trucking" element={<ResRealRpm />} />
              <Route path="/resources/1099-truck-driver-expenses" element={<Res1099Expenses />} />
              <Route path="/resources/trucking-contract-clarity" element={<ResContractClarity />} />
              <Route path="/resources/truck-parking-tracker" element={<ResParking />} />
              <Route path="/resources/driver-referral-tracking" element={<ResDriverReferral />} />
              <Route path="/resources/trucking-recruiter-tools" element={<ResRecruiterTools />} />
              <Route path="/haultrackerpro-vs-spreadsheets" element={<CompareVsSpreadsheets />} />
              <Route path="/haultrackerpro-vs-quickbooks" element={<CompareVsQuickBooks />} />
              <Route path="/best-truck-driver-profit-tracker" element={<BestProfitTracker />} />
              <Route path="/admin/resource-articles" element={<AdminRoute><ResourceArticlesAdmin /></AdminRoute>} />
              <Route path="/admin/content-calendar" element={<AdminRoute><ContentCalendarAdmin /></AdminRoute>} />
              {/* TG-2E3-O12: owner-only QA control center. Page itself enforces super_admin. */}
              <Route path="/owner-qa" element={<AdminRoute><OwnerQaCenter /></AdminRoute>} />
              {/* Dynamic published-article fallback. Registered AFTER all static /resources/* routes
                  so existing static guides always win. Published articles only — drafts are blocked by RLS. */}
              <Route path="/resources/:slug" element={<ResourceArticleDynamic />} />
              <Route path="/start" element={<ProtectedRoute><CapabilityLauncher /></ProtectedRoute>} />
              {/* First-class recruiter hub URL. Forwards into the existing
                  recruiter access surface inside the dashboard shell so the
                  hub stays a single source of truth. */}
              <Route path="/recruiter" element={<ProtectedRoute><RecruiterEntryRoute /></ProtectedRoute>} />
              <Route path="/recruiter/manage" element={<ProtectedRoute><Navigate to="/dashboard?page=recruiter-access:manager" replace /></ProtectedRoute>} />
              <Route path="/recruiter/applications" element={<ProtectedRoute><Navigate to="/dashboard?page=recruiter-access:applications" replace /></ProtectedRoute>} />
              <Route path="/recruiter/reports" element={<ProtectedRoute><Navigate to="/dashboard?page=recruiter-access:reports" replace /></ProtectedRoute>} />
              <Route path="/recruiter/onboarding" element={<ProtectedRoute><Navigate to="/dashboard?page=recruiter-access:onboarding" replace /></ProtectedRoute>} />
              <Route path="/recruiter/invite/:token" element={<RecruiterInviteAccept />} />
              <Route path="/professional-profile" element={<ProtectedRoute><ProfessionalProfile /></ProtectedRoute>} />
              <Route path="/assistant" element={<ProtectedRoute><AssistantDashboard /></ProtectedRoute>} />
              <Route path="/assistant/invite/:token" element={<AssistantInviteAccept />} />
              <Route path="/assistant/settings" element={<ProtectedRoute><AssistantLimitedSettings /></ProtectedRoute>} />
              <Route path="/agency" element={<ProtectedRoute><AgencyDashboard /></ProtectedRoute>} />
              <Route path="/agency/invite/:token" element={<AgencyInviteAccept />} />
              <Route path="/agency/request/:agencyId" element={<AgencyRequestPublic />} />
              <Route path="/driver/agency-approvals" element={<ProtectedRoute><DriverDelegationApprovals /></ProtectedRoute>} />
              <Route path="/driver/assistant-control" element={<ProtectedRoute><DriverAssistantControl /></ProtectedRoute>} />
              <Route path="/driver/work-items" element={<ProtectedRoute><DriverWorkItems /></ProtectedRoute>} />
              <Route path="/driver/work-items/:id" element={<ProtectedRoute><DriverWorkItems /></ProtectedRoute>} />
              <Route path="/a/:slug" element={<AgencySlugRedirect />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
            </ActingContextProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
