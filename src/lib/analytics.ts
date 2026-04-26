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

// ─── LEAD MAGNET FUNNEL ─────────────────────────────────
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
