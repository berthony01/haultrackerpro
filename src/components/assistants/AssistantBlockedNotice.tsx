import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  firstAllowedAssistantPage,
  type AssistantPermissions,
} from '@/lib/assistantPermissions';

interface Props {
  driverName: string;
  permissions: AssistantPermissions | null | undefined;
  onGoToAllowed: (page: string) => void;
  onExit: () => void;
}

/**
 * Shown when an assistant lands on a page they are not permitted to view for
 * the currently selected driver. Provides explicit context (whose account they
 * tried to access) plus two clear escape hatches instead of a silent redirect.
 */
export default function AssistantBlockedNotice({
  driverName,
  permissions,
  onGoToAllowed,
  onExit,
}: Props) {
  const allowed = firstAllowedAssistantPage(permissions);
  return (
    <div className="container mx-auto max-w-lg px-4 py-10">
      <Card>
        <CardContent className="space-y-4 py-6">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 mt-0.5 text-amber-500 shrink-0" />
            <div>
              <p className="font-medium">
                You do not have permission to access this area for {driverName}.
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Ask {driverName} to grant the relevant permission, or switch back to
                an area you can manage.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onGoToAllowed(allowed)}>
              Go to allowed area
            </Button>
            <Button size="sm" variant="outline" onClick={onExit}>
              Back to assistant dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
