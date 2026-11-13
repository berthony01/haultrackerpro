import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { InvitationError, sendInvitation } from '@/lib/jobSearch/jobSearchInvitationApi';

const MESSAGES: Record<string, string> = {
  sent: 'Invitation sent. The driver stays anonymous unless they accept.',
  replayed: 'Invitation sent. The driver stays anonymous unless they accept.',
  already_invited: 'This driver was already invited to this opportunity.',
  denied: 'This invitation is not allowed. The card or opportunity may no longer be eligible.',
  limit: 'Invitation limit reached. Try again later.',
  invalid: 'Write a short note between 1 and 500 characters.',
  unavailable: 'Invitations are not available yet.',
  closed: 'This invitation is no longer open.',
  unknown: 'Unable to send the invitation.',
};

export function InviteToOpportunityDialog({ recruiterId, cardId, open, onOpenChange }: { recruiterId: string; cardId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [opps, setOpps] = useState<{ id: string; title: string }[] | null>(null);
  const [opportunityId, setOpportunityId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const commandId = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!open) return;
    let live = true;
    void supabase.from('opportunities').select('id,title').eq('recruiter_id', recruiterId).eq('status', 'active').eq('admin_review_status', 'approved').order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => { if (live) setOpps(data ?? []); });
    return () => { live = false; };
  }, [open, recruiterId]);
  const submit = async () => {
    setBusy(true); setNotice(null);
    try { setNotice(MESSAGES[await sendInvitation({ recruiterId, cardId, opportunityId, message, commandId: commandId.current })]); }
    catch (e) { setNotice(MESSAGES[e instanceof InvitationError ? e.kind : 'unknown']); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={o => { if (!o) commandId.current = crypto.randomUUID(); onOpenChange(o); }}>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Invite to an opportunity</DialogTitle>
        <DialogDescription>The driver sees your company, the opening and your note. No conversation starts unless they accept.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="invite-opportunity">Active opening</Label>
          {opps === null ? <p role="status" className="text-sm">Loading openings…</p> : opps.length === 0
            ? <p role="status" className="text-sm text-muted-foreground">You have no active approved openings.</p>
            : <select id="invite-opportunity" className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={opportunityId} onChange={e => { setOpportunityId(e.target.value); commandId.current = crypto.randomUUID(); }}>
                <option value="">Choose an opening</option>
                {opps.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
              </select>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="invite-note">Short note</Label>
          <Textarea id="invite-note" maxLength={500} rows={4} value={message} onChange={e => { setMessage(e.target.value); commandId.current = crypto.randomUUID(); }} />
          <p className="text-xs text-muted-foreground">{message.trim().length}/500</p>
        </div>
        {notice && <p role="status" className="text-sm">{notice}</p>}
      </div>
      <DialogFooter>
        <Button disabled={busy || !opportunityId || !message.trim()} onClick={() => void submit()}>{busy ? 'Sending…' : 'Send invitation'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
