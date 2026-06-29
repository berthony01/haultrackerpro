import { Navigate, useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { useActingContext } from '@/hooks/useActingContext';
import { hasPerm } from '@/lib/assistantPermissions';
import { CostProfileSettings } from '@/components/CostProfileSettings';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ShieldCheck, Lock } from 'lucide-react';

/**
 * Limited settings surface for an acting assistant.
 *
 * Phase 1 scope: cost profile only.
 * Billing, subscription, account deletion, recruiter settings, notifications,
 * and full settings are NOT reachable from this page. Server-side RLS on
 * `cost_profile` independently enforces that an assistant can only read/write
 * the driver they are currently acting for and only when `manage_settings_limited`
 * is granted.
 */
export default function AssistantLimitedSettings() {
  const { actingDriver, isActingAsAssistant, permissions } = useActingContext();
  const navigate = useNavigate();

  if (!isActingAsAssistant || !actingDriver) {
    return <Navigate to="/assistant" replace />;
  }
  if (!hasPerm(permissions, 'manage_settings_limited')) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <AppShell>
    <div className="container mx-auto max-w-3xl px-4 py-6 space-y-6">
      <header className="space-y-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/dashboard')}
          className="-ml-2"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          Limited settings
        </h1>
        <p className="text-sm text-muted-foreground">
          You're acting for{' '}
          <span className="font-medium">{actingDriver.driver_name || actingDriver.driver_email}</span>.
          You can edit their cost profile here. Billing, subscription, account, recruiter,
          and notification settings are off-limits and only the driver can change them.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cost profile</CardTitle>
        </CardHeader>
        <CardContent>
          <CostProfileSettings />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            Restricted to the driver
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
            <li>Billing, plan, and payment method</li>
            <li>Account deletion and email</li>
            <li>Subscription and Pro upgrades</li>
            <li>Recruiter settings</li>
            <li>Notification preferences</li>
            <li>Inviting or revoking other assistants</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
