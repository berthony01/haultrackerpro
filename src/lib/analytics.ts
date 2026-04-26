// Google Analytics 4 helper utilities
// All functions are safe to call even if GA is not loaded (SSR, ad blockers, etc.)

export const GA_MEASUREMENT_ID = 'G-VTDZSSY5Q6'; // Replace with your real GA4 Measurement ID

// Type-safe gtag wrapper
function gtag(...args: any[]) {
  try {
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag(...args);
    }
  } catch {
    // Silently fail — analytics should never break the app
  }
}

// ─── PAGE VIEWS ───────────────────────────────────────────
export function trackPageView(path: string, title?: string) {
  gtag('event', 'page_view', {
    page_path: path,
    page_title: title || document.title,
  });
}

// ─── CONVERSION EVENTS ───────────────────────────────────
export function trackSignUp(method: string = 'email') {
  gtag('event', 'sign_up', {
    method,
  });
}

export function trackLogin(method: string = 'email') {
  gtag('event', 'login', {
    method,
  });
}

export function trackBeginTrial() {
  gtag('event', 'begin_trial', {
    currency: 'USD',
    value: 0,
  });
}

export function trackBeginCheckout(planKey: string, value: number) {
  gtag('event', 'begin_checkout', {
    currency: 'USD',
    value,
    items: [{ item_id: planKey, item_name: planKey === 'pro_yearly' ? 'Pro Annual' : 'Pro Monthly' }],
  });
}

export function trackPurchase(planKey: string, value: number) {
  gtag('event', 'purchase', {
    currency: 'USD',
    value,
    items: [{ item_id: planKey, item_name: planKey === 'pro_yearly' ? 'Pro Annual' : 'Pro Monthly' }],
  });
}

// ─── ENGAGEMENT EVENTS ───────────────────────────────────

export function trackCalculatorUsed(calculatorName: string) {
  gtag('event', 'calculator_used', {
    calculator_name: calculatorName,
  });
}

export function trackCtaClick(ctaLabel: string, ctaLocation: string) {
  gtag('event', 'cta_click', {
    cta_label: ctaLabel,
    cta_location: ctaLocation,
  });
}

export function trackLoadLogged(loadNumber: number) {
  gtag('event', 'load_logged', {
    load_number: loadNumber,
  });
}

export function trackExpenseLogged() {
  gtag('event', 'expense_logged');
}

export function trackProFeatureHit(featureName: string) {
  gtag('event', 'pro_feature_hit', {
    feature_name: featureName,
  });
}

// ─── PROFIT INTELLIGENCE SURFACE ─────────────────────────
export function trackDemoUseMyNumbers(score: number, verdict: string) {
  gtag('event', 'demo_use_my_numbers', { score, verdict });
}

export function trackPricingProfitIntelClick() {
  gtag('event', 'pricing_profit_intel_click');
}

export function trackFaqShareLinkCopied(faqId: string) {
  gtag('event', 'faq_share_link_copied', { faq_id: faqId });
}

export function trackLandingFaqDeepLink(target: string) {
  gtag('event', 'landing_faq_deep_link', { target });
}

// ─── LEAD MAGNET FUNNEL (legacy — kept for backward-compat with existing GA reports) ─────
export function trackLeadMagnetView(source: string) {
  gtag('event', 'lead_magnet_view', { source });
}

export function trackLeadMagnetSubmit() {
  gtag('event', 'lead_magnet_submit');
}

export function trackLeadMagnetDownload() {
  gtag('event', 'lead_magnet_download');
}

export function trackLeadMagnetSignupClick() {
  gtag('event', 'lead_magnet_signup_click');
}

// ─── SESSION-SCOPED GUARD ───────────────────────────────────────────────────
// Ensures a tracking callback fires at most once per browser session for a
// given event key. Uses sessionStorage and fails silently if unavailable
// (private mode, disabled storage, SSR, etc.) — never throws.
export function trackOncePerSession(eventKey: string, callback: () => void) {
  const storageKey = `htp_event_${eventKey}`;
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      callback();
      return;
    }
    if (window.sessionStorage.getItem(storageKey) === 'true') return;
    window.sessionStorage.setItem(storageKey, 'true');
    callback();
  } catch {
    // Storage failed — fire once anyway so we don't lose the event entirely.
    try { callback(); } catch { /* noop */ }
  }
}

// ─── STARTER KIT FUNNEL (standardized event names) ──────────────────────────
export function trackStarterKitViewed(source?: string) {
  gtag('event', 'starter_kit_page_viewed', { source });
}

export function trackStarterKitCTAClicked(source: 'landing' | 'pricing' | 'footer' | string) {
  gtag('event', 'starter_kit_cta_clicked', { source });
}

export function trackStarterKitFormSubmitted() {
  gtag('event', 'starter_kit_form_submitted');
}

export function trackStarterKitDownloadClicked(source?: 'starter_kit' | 'thanks') {
  gtag('event', 'starter_kit_download_clicked', { source });
}

export function trackStarterKitSignupClicked() {
  gtag('event', 'starter_kit_signup_clicked');
}
