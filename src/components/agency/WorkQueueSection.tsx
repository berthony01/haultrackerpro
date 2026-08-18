import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ListTodo, Plus, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useActingContext } from '@/hooks/useActingContext';
import { hasPerm } from '@/lib/assistantPermissions';
import { useToast } from '@/hooks/use-toast';
import {
  useAgencyClients,
  useAgencyWorkItems,
  useWorkItemMutations,
  type AgencyWorkItemStatus,
  type AgencyWorkItemType,
  type AgencyWorkItemPriority,
  type WorkItemRow,
} from '@/hooks/useAgencyWorkflow';
import { useAgencyMembers } from '@/hooks/useAgency';

const STATUSES: AgencyWorkItemStatus[] = [
  'open',
  'in_progress',
  'waiting_on_driver',
  'completed',
  'cancelled',
];
const TYPES: AgencyWorkItemType[] = [
  'load_entry',
  'expense_entry',
  'fuel_entry',
  'report_review',
  'monthly_closeout',
  'document_followup',
  'other',
];
const PRIORITIES: AgencyWorkItemPriority[] = ['low', 'normal', 'high'];

const WORK_ITEM_TYPE_LABELS: Record<AgencyWorkItemType, string> = {
  load_entry: 'Log load for client',
  expense_entry: 'Log expense for client',
  fuel_entry: 'Log fuel for client',
  report_review: 'Review reports',
  monthly_closeout: 'Monthly closeout',
  document_followup: 'Document follow-up',
  other: 'Other',
};

function workItemTypeLabel(t: AgencyWorkItemType): string {
  return WORK_ITEM_TYPE_LABELS[t] ?? t.replace(/_/g, ' ');
}


export function WorkQueueSection({
  agencyId,
  focusedWorkItemId,
  canViewAllWorkItems,
  canManageWorkItems,
}: {
  agencyId: string;
  focusedWorkItemId?: string | null;
  /**
   * AM-1C-E: exact AM-1B workspace permissions. Role labels grant no Work Item
   * authority. Neither boolean implies the other.
   * - `work_items_view_all`: broad driver/member filter controls.
   * - `work_items_manage`: create + full management.
   */
  canViewAllWorkItems: boolean;
  canManageWorkItems: boolean;
}) {
  const [status, setStatus] = useState<AgencyWorkItemStatus | 'all'>('open');
  const [driverId, setDriverId] = useState<string | 'all'>('all');
  const [memberId, setMemberId] = useState<string | 'all'>('all');
  // The list query stays available to every agency member: the backend returns
  // either the broad set (via `work_items_view_all`) or the preserved
  // assigned-member subset. Broad filters are only sent with view-all.
  const { data: items, isLoading } = useAgencyWorkItems(agencyId, {
    status: status === 'all' ? undefined : status,
    driverId: canViewAllWorkItems && driverId !== 'all' ? driverId : undefined,
    memberId: canViewAllWorkItems && memberId !== 'all' ? memberId : undefined,
  });
  const { data: clients } = useAgencyClients(agencyId);
  const { data: members } = useAgencyMembers(agencyId);
  const [createOpen, setCreateOpen] = useState(false);

  // Auto-scroll to a notification-deep-linked work item once it loads.
  useEffect(() => {
    if (!focusedWorkItemId || !items) return;
    const el = document.getElementById(`work-item-${focusedWorkItemId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusedWorkItemId, items]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-primary" />
            Work queue
          </CardTitle>
          {canManageWorkItems && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              New task
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {canViewAllWorkItems
            ? "These are tasks your agency owes a client — not the client's own loads, expenses, or fuel records. Opening one routes you into that client's account using the delegation permissions they granted you."
            : "You'll only see work items assigned to you. Driver account access still requires driver-approved delegation."}
        </p>
        <div className={canViewAllWorkItems ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-1 gap-2'}>


          <Select value={status} onValueChange={(v) => setStatus(v as any)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canViewAllWorkItems && (
            <>
              <Select value={driverId} onValueChange={(v) => setDriverId(v as any)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All drivers</SelectItem>
                  {(clients ?? []).map((c) => (
                    <SelectItem key={c.driver_user_id} value={c.driver_user_id}>
                      {c.driver_name || c.driver_email || c.driver_user_id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={memberId} onValueChange={(v) => setMemberId(v as any)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All members</SelectItem>
                  {(members ?? [])
                    .filter((m) => m.member_user_id)
                    .map((m) => (
                      <SelectItem key={m.id} value={m.member_user_id!}>
                        {m.invite_email}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !items || items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No work items.</p>
        ) : (
          <div className="space-y-2">
            {items.map((it) => (
              <WorkItemRowView key={it.id} item={it} highlighted={focusedWorkItemId === it.id} />
            ))}
          </div>
        )}

        {canManage && (
          <CreateWorkItemDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            agencyId={agencyId}
          />
        )}
      </CardContent>
    </Card>
  );
}

function WorkItemRowView({ item, highlighted }: { item: WorkItemRow; highlighted?: boolean }) {
  const { update } = useWorkItemMutations();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { managedDrivers, beginActingAs } = useActingContext();
  const delegation = managedDrivers.find((d) => d.driver_user_id === item.driver_user_id) ?? null;
  const perms = delegation?.permissions ?? null;

  const go = (page: string) => {
    beginActingAs(item.driver_user_id);
    navigate(`/dashboard?page=${page}`);
  };

  const links: Array<{ key: string; label: string; onClick: () => void }> = [];
  if (delegation) {
    links.push({ key: 'manage', label: 'Start managing', onClick: () => go('dashboard') });
    if (hasPerm(perms, 'manage_loads')) links.push({ key: 'load', label: 'Add load', onClick: () => go('add') });
    if (hasPerm(perms, 'manage_expenses')) links.push({ key: 'exp', label: 'Add expense', onClick: () => go('add_expense') });
    // Fuel routes to the existing fuel-log flow (applyFuelLogPolicy reconciles totals).
    if (hasPerm(perms, 'manage_fuel')) links.push({ key: 'fuel', label: 'Add fuel log', onClick: () => go('add_fuel') });
    if (hasPerm(perms, 'view_reports')) links.push({ key: 'rep', label: 'View reports', onClick: () => go('reports') });
    if (hasPerm(perms, 'manage_settings_limited')) links.push({ key: 'set', label: 'Limited settings', onClick: () => { beginActingAs(item.driver_user_id); navigate('/assistant/settings'); } });
  }

  return (
    <div id={`work-item-${item.id}`} className={`rounded-md border p-3 text-sm space-y-1 ${highlighted ? 'ring-2 ring-primary border-primary' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium truncate">{item.title}</p>
          <p className="text-xs text-muted-foreground truncate">
            {item.driver_email || item.driver_user_id.slice(0, 8)} ·{' '}
            {workItemTypeLabel(item.type)}
          </p>
          {item.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
              {item.description}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant="outline">{item.status.replace(/_/g, ' ')}</Badge>
          <span className="text-xs text-muted-foreground">
            {item.assigned_member_email ?? 'Unassigned'}
          </span>
          {item.due_date && (
            <span className="text-xs text-muted-foreground">Due {item.due_date}</span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pt-1 items-center">
        <Select
          value={item.status}
          onValueChange={async (v) => {
            try {
              await update.mutateAsync({
                id: item.id,
                status: v as AgencyWorkItemStatus,
              });
              toast({ title: 'Status updated' });
            } catch (e: any) {
              toast({ title: 'Error', description: e?.message, variant: 'destructive' });
            }
          }}
        >
          <SelectTrigger className="h-7 text-xs w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {delegation
          ? links.map((l) => (
              <Button
                key={l.key}
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs gap-1"
                onClick={l.onClick}
              >
                <ExternalLink className="h-3 w-3" /> {l.label}
              </Button>
            ))
          : (
            <p className="text-xs text-muted-foreground">
              You're assigned this work item, but you don't currently have driver account access. Ask the driver to approve a delegation to manage their records.
            </p>
          )}
      </div>
    </div>
  );
}

function CreateWorkItemDialog({
  open,
  onOpenChange,
  agencyId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  agencyId: string;
}) {
  const { data: clients } = useAgencyClients(agencyId);
  const { data: members } = useAgencyMembers(agencyId);
  const { create } = useWorkItemMutations();
  const { toast } = useToast();
  const [driverId, setDriverId] = useState<string>('');
  const [memberId, setMemberId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<AgencyWorkItemType>('other');
  const [priority, setPriority] = useState<AgencyWorkItemPriority>('normal');
  const [dueDate, setDueDate] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New work item</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Driver client</Label>
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a client driver" />
              </SelectTrigger>
              <SelectContent>
                {(clients ?? []).map((c) => (
                  <SelectItem key={c.driver_user_id} value={c.driver_user_id}>
                    {c.driver_name || c.driver_email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!clients?.length && (
              <p className="text-xs text-muted-foreground">
                You don't have any approved client drivers yet.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
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
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as AgencyWorkItemType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {workItemTypeLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as AgencyWorkItemPriority)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Assign to member</Label>
              <Select value={memberId} onValueChange={setMemberId}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  {(members ?? [])
                    .filter((m) => m.status === 'active' && m.member_user_id)
                    .map((m) => (
                      <SelectItem key={m.id} value={m.member_user_id!}>
                        {m.invite_email}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Due date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!driverId || title.trim().length < 2 || create.isPending}
            onClick={async () => {
              try {
                await create.mutateAsync({
                  agency_id: agencyId,
                  driver_user_id: driverId,
                  title: title.trim(),
                  description: description || undefined,
                  type,
                  priority,
                  assigned_member_user_id: memberId || null,
                  due_date: dueDate || null,
                });
                toast({ title: 'Work item created' });
                onOpenChange(false);
                setDriverId('');
                setMemberId('');
                setTitle('');
                setDescription('');
                setDueDate('');
              } catch (e: any) {
                toast({ title: 'Error', description: e?.message, variant: 'destructive' });
              }
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
