/**
 * Phase TG-2E3-O2 — Owner QA Mode panel (mounted inside /admin).
 *
 * Super-admin only. Selecting a persona calls the server RPC; the server
 * remains the source of truth for both UI and server-side plan gates.
 */

import { useMemo, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useOwnerQaPersona } from '@/hooks/useOwnerQaPersona';
import {
  OWNER_QA_ACTUAL_ACCOUNT,
  OWNER_QA_AGENCY_PERSONAS,
  OWNER_QA_DRIVER_PERSONAS,
  OWNER_QA_PERSONA_LABELS,
  OWNER_QA_RECRUITER_PERSONAS,
  isValidOwnerQaSelection,
  type OwnerQaDomain,
  type OwnerQaPersona,
} from '@/lib/billing/ownerQaPersona';

/** Select values are `${domain}:${persona}` so the pair stays explicit. */
function encode(domain: OwnerQaDomain, persona: OwnerQaPersona) {
  return `${domain}:${persona}`;
}

function decode(value: string): { domain: OwnerQaDomain; persona: OwnerQaPersona } | null {
  const [domain, persona] = value.split(':');
  if (!isValidOwnerQaSelection(domain, persona)) return null;
  return { domain: domain as OwnerQaDomain, persona: persona as OwnerQaPersona };
}

export function OwnerQaModePanel() {
  const {
    isOwner,
    isActive,
    domain,
    persona,
    label,
    expiresAt,
    setPersona,
    disable,
    isLoading,
    isMutating,
    error,
  } = useOwnerQaPersona();

  const [pending, setPending] = useState<string | null>(null);

  const currentValue = useMemo(() => {
    if (isActive && domain && persona) return encode(domain, persona);
    return OWNER_QA_ACTUAL_ACCOUNT;
  }, [isActive, domain, persona]);

  if (!isOwner) return null;

  const pendingSelection = pending ? decode(pending) : null;

  const confirmChange = async () => {
    if (!pending) return;
    try {
      if (pending === OWNER_QA_ACTUAL_ACCOUNT) {
        await disable();
        toast.success('Returned to actual account');
      } else if (pendingSelection) {
        await setPersona(pendingSelection.domain, pendingSelection.persona);
        toast.success(
          `QA Mode: ${OWNER_QA_PERSONA_LABELS[pendingSelection.persona]}`,
        );
      }
    } catch {
      toast.error('Could not update QA Mode.');
    } finally {
      setPending(null);
    }
  };

  return (
    <Card data-testid="owner-qa-mode-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4 text-primary" aria-hidden="true" />
          Owner QA Mode
          {isActive && label && (
            <Badge variant="secondary" className="ml-1">
              {label}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Testing mode. This changes the <strong>effective plan entitlements
          for this owner account only</strong>, on the server as well as the UI,
          so paid limits can be tested honestly. It does <strong>not</strong>{' '}
          change Stripe, subscriptions, or any billing record, and it does{' '}
          <strong>not</strong> bypass security, workspace membership,
          permission, or relationship checks — those still apply exactly as
          they do for every other account. Sessions expire automatically after
          about 60 minutes.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="owner-qa-persona-select">
            QA persona
          </label>
          <Select
            value={currentValue}
            disabled={isLoading || isMutating}
            onValueChange={(v) => setPending(v)}
          >
            <SelectTrigger id="owner-qa-persona-select" className="w-[300px]">
              <SelectValue placeholder="Actual Account" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={OWNER_QA_ACTUAL_ACCOUNT}>
                Actual Account (QA off)
              </SelectItem>
              <SelectGroup>
                <SelectLabel>Driver</SelectLabel>
                {OWNER_QA_DRIVER_PERSONAS.map((p) => (
                  <SelectItem key={p} value={encode('driver', p)}>
                    {OWNER_QA_PERSONA_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Recruiter</SelectLabel>
                {OWNER_QA_RECRUITER_PERSONAS.map((p) => (
                  <SelectItem key={p} value={encode('recruiter', p)}>
                    {OWNER_QA_PERSONA_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Agency</SelectLabel>
                {OWNER_QA_AGENCY_PERSONAS.map((p) => (
                  <SelectItem key={p} value={encode('agency', p)}>
                    {OWNER_QA_PERSONA_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          {isActive && (
            <Button
              variant="outline"
              size="sm"
              disabled={isMutating}
              onClick={() => setPending(OWNER_QA_ACTUAL_ACCOUNT)}
            >
              Exit to Actual Account
            </Button>
          )}
        </div>

        {isActive && expiresAt && (
          <p className="text-xs text-muted-foreground">
            QA session expires at {new Date(expiresAt).toLocaleTimeString()}.
          </p>
        )}

        {error && (
          <p className="text-xs text-destructive">
            QA Mode is unavailable right now.
          </p>
        )}
      </CardContent>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending === OWNER_QA_ACTUAL_ACCOUNT
                ? 'Return to actual account?'
                : 'Switch QA persona?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending === OWNER_QA_ACTUAL_ACCOUNT
                ? 'Your real plan entitlements will apply again immediately.'
                : `Server-side paid limits for this owner account will behave as ${
                    pendingSelection
                      ? OWNER_QA_PERSONA_LABELS[pendingSelection.persona]
                      : ''
                  } for about 60 minutes. Real billing records are not modified.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmChange()}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default OwnerQaModePanel;
