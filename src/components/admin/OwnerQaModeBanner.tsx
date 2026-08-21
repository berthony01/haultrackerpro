/**
 * Phase TG-2E3-O2 — Owner QA Mode banner.
 *
 * Renders ONLY for a resolved super_admin with an active server QA session.
 * Never rendered for normal users, non-super admins, or the actual account.
 */

import { useMemo } from 'react';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOwnerQaPersona } from '@/hooks/useOwnerQaPersona';

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return '';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'expiring';
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `${minutes} min left`;
}

export function OwnerQaModeBanner() {
  const { isOwner, isActive, label, expiresAt, disable, isMutating } =
    useOwnerQaPersona();

  const expiryCopy = useMemo(() => formatExpiry(expiresAt), [expiresAt]);

  if (!isOwner || !isActive || !label) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="owner-qa-mode-banner"
      className="sticky top-0 z-50 w-full border-b border-primary/40 bg-primary/15 px-3 py-2 text-sm text-foreground"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
        <FlaskConical className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="font-semibold uppercase tracking-wide text-primary">
          QA Mode
        </span>
        <span className="font-medium">{label}</span>
        {expiryCopy && (
          <span className="text-muted-foreground">· {expiryCopy}</span>
        )}
        <span className="text-muted-foreground">
          · Testing entitlements only — real billing is unchanged
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={isMutating}
          onClick={() => void disable()}
        >
          Exit to Actual Account
        </Button>
      </div>
    </div>
  );
}

export default OwnerQaModeBanner;
