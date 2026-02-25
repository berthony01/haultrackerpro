import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { MessageSquare, CheckCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface SendFeedbackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SendFeedbackModal({ open, onOpenChange }: SendFeedbackModalProps) {
  const { user } = useAuth();
  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!category || !message.trim() || !user) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('feedback_responses')
        .insert({
          user_id: user.id,
          response: message.trim(),
          category,
          loads_count: 0,
        });
      if (error) throw error;
      setSubmitted(true);
      toast.success('Feedback sent! Thank you.');
      setTimeout(() => {
        onOpenChange(false);
        setSubmitted(false);
        setCategory('');
        setMessage('');
      }, 1500);
    } catch (err: any) {
      toast.error(err.message || 'Failed to send feedback');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setSubmitted(false); setCategory(''); setMessage(''); } }}>
      <DialogContent className="max-w-sm rounded-2xl">
        {submitted ? (
          <div className="py-8 text-center space-y-3">
            <div className="inline-flex items-center justify-center rounded-2xl bg-success/10 p-4">
              <CheckCircle className="h-10 w-10 text-success" />
            </div>
            <p className="text-lg font-bold">Thank you!</p>
            <p className="text-sm text-muted-foreground">Your feedback has been submitted.</p>
          </div>
        ) : (
          <>
            <DialogHeader className="text-center">
              <div className="mx-auto mb-2 inline-flex items-center justify-center rounded-2xl bg-primary/10 p-4">
                <MessageSquare className="h-8 w-8 text-primary" />
              </div>
              <DialogTitle className="text-lg font-heading">Send Feedback</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="suggestion">Suggestion</SelectItem>
                    <SelectItem value="bug">Bug</SelectItem>
                    <SelectItem value="question">Question</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Message</Label>
                <Textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Tell us what's on your mind..."
                  className="rounded-xl min-h-[100px]"
                  maxLength={1000}
                />
              </div>
              <Button
                className="w-full h-11 rounded-xl font-bold"
                onClick={handleSubmit}
                disabled={!category || !message.trim() || loading}
              >
                {loading ? 'Sending...' : 'Submit Feedback'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
