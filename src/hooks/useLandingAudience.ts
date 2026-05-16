import { useCallback, useEffect, useState } from 'react';

export type LandingAudience = 'driver' | 'recruiter';

const STORAGE_KEY = 'landing.audience';
const QUERY_KEY = 'for';

function readInitial(): LandingAudience {
  if (typeof window === 'undefined') return 'driver';
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get(QUERY_KEY);
    if (fromQuery === 'recruiter' || fromQuery === 'driver') return fromQuery;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'recruiter' || stored === 'driver') return stored;
  } catch {
    // ignore
  }
  return 'driver';
}

export function useLandingAudience() {
  const [audience, setAudienceState] = useState<LandingAudience>(readInitial);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, audience);
    } catch {
      // ignore
    }
  }, [audience]);

  const setAudience = useCallback((next: LandingAudience) => {
    setAudienceState(next);
    if (typeof window !== 'undefined') {
      // Scroll to top so the user sees the new hero
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, []);

  return { audience, setAudience };
}
