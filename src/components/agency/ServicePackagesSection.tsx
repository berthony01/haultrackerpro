import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Package, Pencil, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  useAgencyPackageMutations,
  useAgencyPackages,
  type ServicePackage,
} from '@/hooks/useAgencyWorkflow';
import { useAgencyEntitlement } from '@/hooks/useAgencyEntitlement';
import {
  ASSISTANT_PERMISSION_KEYS,
  PERMISSION_LABELS,
  type AssistantPermissionKey,
  type AssistantPermissions,
} from '@/lib/assistantPermissions';

export function ServicePackagesSection({ agencyId }: { agencyId: string }) {
  const { data: packages, isLoading } = useAgencyPackages(agencyId);
  const { entitlement } = useAgencyEntitlement(agencyId);
  const billingCancelled = entitlement.status === 'cancelled';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            Service packages
          </CardTitle>
          <PackageEditorDialog agencyId={agencyId} disabled={billingCancelled} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Drivers can request your active packages through the “Share request link” in the
          Overview tab.
        </p>

        {billingCancelled && (
          <p className="text-xs text-muted-foreground">
            Agency billing is not active. Start or restart billing from Overview before creating a
            new service package. Existing packages can still be edited or deactivated.
          </p>
        )}


        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !packages || packages.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">No packages yet.</p>
            <p>
              Common starter packages: <em>Basic Load Entry</em>, <em>Expense and Fuel Tracking</em>,{' '}
              <em>Monthly Bookkeeping Support</em>, <em>Full Back Office Management</em>.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {packages.map((pk) => (
              <PackageRow key={pk.id} pkg={pk} agencyId={agencyId} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PackageRow({ pkg, agencyId }: { pkg: ServicePackage; agencyId: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium truncate">{pkg.name}</p>
            {!pkg.is_active && <Badge variant="outline">Inactive</Badge>}
          </div>
          {pkg.description && (
            <p className="text-xs text-muted-foreground mt-1">{pkg.description}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {pkg.price_display_text && <span>💵 {pkg.price_display_text}</span>}
            {pkg.billing_frequency_display_text && (
              <span>🗓 {pkg.billing_frequency_display_text}</span>
            )}
          </div>
        </div>
        <PackageEditorDialog agencyId={agencyId} existing={pkg} />
      </div>
    </div>
  );
}

function PackageEditorDialog({
  agencyId,
  existing,
  disabled,
}: {
  agencyId: string;
  existing?: ServicePackage;
  disabled?: boolean;
}) {

  const { create, update } = useAgencyPackageMutations();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [price, setPrice] = useState(existing?.price_display_text ?? '');
  const [freq, setFreq] = useState(existing?.billing_frequency_display_text ?? '');
  const [isActive, setIsActive] = useState(existing?.is_active ?? true);
  const [perms, setPerms] = useState<AssistantPermissions>(existing?.recommended_permissions ?? {});

  const togglePerm = (k: AssistantPermissionKey) =>
    setPerms((p) => ({ ...p, [k]: !p[k] }));

  async function save() {
    try {
      if (existing) {
        await update.mutateAsync({
          id: existing.id,
          agency_id: agencyId,
          name,
          description,
          price_display_text: price,
          billing_frequency_display_text: freq,
          recommended_permissions: perms,
          is_active: isActive,
        });
        toast({ title: 'Package updated' });
      } else {
        await create.mutateAsync({
          agency_id: agencyId,
          name,
          description,
          price_display_text: price,
          billing_frequency_display_text: freq,
          recommended_permissions: perms,
        });
        toast({ title: 'Package created' });
      }
      setOpen(false);
    } catch (e: any) {
      toast({ title: 'Could not save package', description: e?.message, variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {existing ? (
          <Button variant="ghost" size="sm">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="mr-1 h-4 w-4" />
            New package
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit package' : 'New service package'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Price (display)</Label>
              <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="$150" />
            </div>
            <div className="space-y-2">
              <Label>Billing frequency</Label>
              <Input
                value={freq}
                onChange={(e) => setFreq(e.target.value)}
                placeholder="per month"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Recommended permissions (suggestion only)</Label>
            <div className="grid grid-cols-1 gap-2 rounded-md border p-3">
              {ASSISTANT_PERMISSION_KEYS.map((k) => (
                <label
                  key={k}
                  className="flex items-center justify-between gap-3 text-sm cursor-pointer"
                >
                  <span>{PERMISSION_LABELS[k]}</span>
                  <Switch checked={!!perms[k]} onCheckedChange={() => togglePerm(k)} />
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              The driver still has to approve every assistant individually.
            </p>
          </div>
          {existing && (
            <label className="flex items-center justify-between text-sm">
              <span>Active (visible to drivers)</span>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={create.isPending || update.isPending || name.trim().length < 2}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
