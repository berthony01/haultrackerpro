import { useState } from 'react';
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
import { ListTodo, Plus } from 'lucide-react';
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

export function WorkQueueSection({ agencyId }: { agencyId: string }) {
  const [status, setStatus] = useState<AgencyWorkItemStatus | 'all'>('open');
  const [driverId, setDriverId] = useState<string | 'all'>('all');
  const [memberId, setMemberId] = useState<string | 'all'>('all');
  const { data: items, isLoading } = useAgencyWorkItems(agencyId, {
    status: status === 'all' ? undefined : status,
    driverId: driverId === 'all' ? undefined : driverId,
    memberId: memberId === 'all' ? undefined : memberId,
  });
  const { data: clients } = useAgencyClients(agencyId);
  const { data: members } = useAgencyMembers(agencyId);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-primary" />
            Work queue
          </CardTitle>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            New task
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
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
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !items || items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No work items.</p>
        ) : (
          <div className="space-y-2">
            {items.map((it) => (
              <WorkItemRowView key={it.id} item={it} />
            ))}
          </div>
        )}

        <CreateWorkItemDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          agencyId={agencyId}
        />
      </CardContent>
    </Card>
  );
}

function WorkItemRowView({ item }: { item: WorkItemRow }) {
  const { update } = useWorkItemMutations();
  const { toast } = useToast();
  return (
    <div className="rounded-md border p-3 text-sm space-y-1">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium truncate">{item.title}</p>
          <p className="text-xs text-muted-foreground truncate">
            {item.driver_email || item.driver_user_id.slice(0, 8)} ·{' '}
            {item.type.replace(/_/g, ' ')}
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
      <div className="flex gap-2 pt-1">
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
                      {t.replace(/_/g, ' ')}
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
