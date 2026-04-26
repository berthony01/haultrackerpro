import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useDriverPoints, tierFor } from '@/hooks/useDriverPoints';

const TIER_RANK: Record<string, number> = { Bronze: 0, Silver: 1, Gold: 2, Platinum: 3 };

function fireConfetti() {
  // Lightweight DOM confetti — no dependency, runs ~1s.
  if (typeof document === 'undefined') return;
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden';
  document.body.appendChild(root);
  const colors = ['#fbbf24', '#3b82f6', '#10b981', '#f97316', '#ec4899'];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('div');
    const left = Math.random() * 100;
    const delay = Math.random() * 0.4;
    const duration = 1.2 + Math.random() * 0.8;
    const size = 6 + Math.random() * 6;
    const color = colors[Math.floor(Math.random() * colors.length)];
    piece.style.cssText = `position:absolute;top:-20px;left:${left}%;width:${size}px;height:${size}px;background:${color};opacity:0.9;border-radius:2px;transform:rotate(${Math.random() * 360}deg);animation:htp-confetti-fall ${duration}s ${delay}s linear forwards`;
    root.appendChild(piece);
  }
  if (!document.getElementById('htp-confetti-style')) {
    const style = document.createElement('style');
    style.id = 'htp-confetti-style';
    style.textContent = `@keyframes htp-confetti-fall{to{transform:translateY(105vh) rotate(720deg);opacity:0}}`;
    document.head.appendChild(style);
  }
  setTimeout(() => root.remove(), 2500);
}

/**
 * Watches the user's tier and fires a one-shot celebration when they cross
 * into a higher tier. State is per-user in localStorage so it never re-fires
 * for the same tier. First-ever load just records the baseline silently.
 */
export function useTierUpDetector() {
  const { user } = useAuth();
  const { data: points } = useDriverPoints();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!user || !points) return;
    const key = `htp:lastTier:${user.id}`;
    const currentTier = tierFor(points.total_points).name;
    const currentRank = TIER_RANK[currentTier] ?? 0;
    const stored = localStorage.getItem(key);

    // First time we ever see this user — record baseline, don't celebrate.
    if (stored === null) {
      localStorage.setItem(key, currentTier);
      return;
    }

    if (stored === currentTier) return;
    const storedRank = TIER_RANK[stored] ?? 0;

    // Only celebrate upward moves, and only once per session per tier.
    if (currentRank > storedRank && handled.current !== currentTier) {
      handled.current = currentTier;
      localStorage.setItem(key, currentTier);
      fireConfetti();
      toast.success(`You're now ${currentTier}! 🎉`, {
        description: 'Keep logging loads and verifying parking to climb higher.',
        duration: 6000,
      });
    } else if (currentRank < storedRank) {
      // Tier shouldn't decrease (total_points is monotonic), but stay in sync.
      localStorage.setItem(key, currentTier);
    }
  }, [user, points]);
}
