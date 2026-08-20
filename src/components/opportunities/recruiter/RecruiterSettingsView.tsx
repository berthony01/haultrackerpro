import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Building2, Phone, ShieldCheck, CreditCard, ExternalLink,
  HelpCircle, BookOpen, Sparkles, ListChecks, LogOut, Trash2, Mail,
  FileText, Shield, AlertTriangle, CheckCircle2, Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useRecruiterProfile } from '@/hooks/opportunities/useRecruiterProfile';
import { useRecruiterBilling, RECRUITER_PLAN_LABELS } from '@/hooks/opportunities/useRecruiterBilling';
import { DeleteAccountModal } from '@/components/DeleteAccountModal';
import { SendFeedbackModal } from '@/components/SendFeedbackModal';
import { NotificationPreferencesPanel } from '@/components/notifications/NotificationPreferencesPanel';
import { TelegramConnectionSection } from '@/components/TelegramConnectionSection';


interface Props {
  onBack: () => void;
  onOpenOnboarding?: () => void;
  onOpenBilling?: () => void;
}

export function RecruiterSettingsView({ onBack, onOpenOnboarding, onOpenBilling }: Props) {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { profile, isLoading: profileLoading } = useRecruiterProfile();
  const {
    plan, status, limit, activeCount, isBillingActive,
    isLoading: billingLoading, openPortal,
  } = useRecruiterBilling();
  const [showDelete, setShowDelete] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  useEffect(() => {
    document.title = 'Recruiter Settings | HaulTrackerPro';
  }, []);

  const handlePasswordReset = async () => {
    if (!user?.email) return;
    setSendingReset(true);
    try {
      const { supabase } = await import('@/integrations/supabase/client');
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success('Password reset email sent.');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not send reset email');
    } finally {
      setSendingReset(false);
    }
  };

  const verificationBadge = () => {
    if (!profile) {
      return <Badge variant="outline" className="gap-1"><AlertTriangle className="h-3 w-3" /> Not started</Badge>;
    }
    if (profile.verification_status === 'approved') {
      return <Badge className="gap-1 bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15"><CheckCircle2 className="h-3 w-3" /> Approved</Badge>;
    }
    if (profile.verification_status === 'rejected') {
      return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> Needs attention</Badge>;
    }
    if (profile.verification_status === 'suspended' || profile.status === 'suspended') {
      return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> Suspended</Badge>;
    }
    return <Badge variant="outline" className="gap-1 text-amber-400 border-amber-500/40"><Clock className="h-3 w-3" /> Pending review</Badge>;
  };

  if (profileLoading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground hover:text-foreground">
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground mb-1">Recruiter Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your company profile, billing, and recruiter account.
        </p>
      </div>

      {/* Company Profile */}
      <Card className="border-border/60">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-primary/15 p-2.5"><Building2 className="h-5 w-5 text-primary" /></div>
              <div>
                <h2 className="text-base font-bold text-foreground">Company Profile</h2>
                <p className="text-xs text-muted-foreground">How your company appears to drivers.</p>
              </div>
            </div>
            {verificationBadge()}
          </div>

          {profile ? (
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <Field label="Company name" value={profile.company_name} />
              <Field label="DOT number" value={profile.dot_number} />
              <Field label="MC number" value={profile.mc_number} />
              <Field label="Company phone" value={profile.company_phone} />
              <Field label="Recruiter contact phone" value={profile.recruiter_phone} />
              <Field label="Recruiter contact email" value={profile.recruiter_email} />
              <Field label="Account email" value={user?.email ?? '—'} />

              <Field label="Address" value={profile.company_address} className="sm:col-span-2" />
              <Field label="Hiring states" value={(profile.hiring_states ?? []).join(', ') || '—'} className="sm:col-span-2" />
              <Field label="Equipment types" value={(profile.equipment_types ?? []).join(', ') || '—'} className="sm:col-span-2" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              You haven't submitted a recruiter profile yet. Apply for access from the Recruiter Dashboard.
            </p>
          )}

          {profile?.verification_status === 'rejected' && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-foreground">
              Your recruiter profile was not approved. Please update your information and resubmit, or contact support for details.
            </div>
          )}


          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={onOpenOnboarding}>
              {profile ? 'Update profile' : 'Start application'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Billing */}
      <Card className="border-border/60">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/15 p-2.5"><CreditCard className="h-5 w-5 text-primary" /></div>
            <div>
              <h2 className="text-base font-bold text-foreground">Billing & Plan</h2>
              <p className="text-xs text-muted-foreground">Manage your recruiter subscription.</p>
            </div>
          </div>

          {billingLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Current plan" value={RECRUITER_PLAN_LABELS[plan]} />
              <Field label="Status" value={status} />
              <Field
                label="Active opportunities"
                value={`${activeCount} of ${limit}`}
              />
              <Field
                label="Billing"
                value={isBillingActive ? 'Active' : 'Not active'}
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => openPortal.mutate()}
              disabled={!isBillingActive || openPortal.isPending}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Manage billing
            </Button>
            <Button size="sm" variant="outline" onClick={onOpenBilling}>
              {isBillingActive ? 'Change plan' : 'Choose a plan'}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Billing is handled securely by Stripe. Cancellations take effect at the end of the current period.
          </p>
        </CardContent>
      </Card>

      {/* Help & Resources */}
      <Card className="border-border/60">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/15 p-2.5"><BookOpen className="h-5 w-5 text-primary" /></div>
            <div>
              <h2 className="text-base font-bold text-foreground">Help & Resources</h2>
              <p className="text-xs text-muted-foreground">Recruiter-specific docs and updates.</p>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <ResourceLink icon={ListChecks} label="Recruiter Features" onClick={() => navigate('/recruiter/features')} />
            <ResourceLink icon={BookOpen} label="Recruiter User Guide" onClick={() => navigate('/recruiter/guide')} />
            <ResourceLink icon={HelpCircle} label="Recruiter FAQ" onClick={() => navigate('/recruiter/faq')} />
            <ResourceLink icon={Sparkles} label="What's New for Recruiters" onClick={() => navigate('/recruiter/updates')} />
            <ResourceLink icon={HelpCircle} label="Help Center" onClick={() => navigate('/docs')} />
          </div>

        </CardContent>
      </Card>

      {/* Account */}
      <Card className="border-border/60">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/15 p-2.5"><ShieldCheck className="h-5 w-5 text-primary" /></div>
            <div>
              <h2 className="text-base font-bold text-foreground">Account & Security</h2>
              <p className="text-xs text-muted-foreground">Manage password, feedback, and account deletion.</p>
            </div>
          </div>
          <div className="grid gap-2">
            <Button variant="outline" className="justify-start h-11 rounded-xl gap-2" onClick={handlePasswordReset} disabled={sendingReset}>
              <Mail className="h-4 w-4" /> Send password reset email
            </Button>
            <Button variant="outline" className="justify-start h-11 rounded-xl gap-2" onClick={() => setShowFeedback(true)}>
              <FileText className="h-4 w-4" /> Send feedback
            </Button>
            <Button variant="outline" className="justify-start h-11 rounded-xl gap-2" onClick={() => navigate('/terms')}>
              <Shield className="h-4 w-4" /> Terms of Service
            </Button>
            <Button variant="outline" className="justify-start h-11 rounded-xl gap-2" onClick={() => navigate('/privacy')}>
              <Shield className="h-4 w-4" /> Privacy Policy
            </Button>
            <Button variant="outline" className="justify-start h-11 rounded-xl gap-2" onClick={() => navigate('/legal')}>
              <FileText className="h-4 w-4" /> Legal Center
            </Button>

            <Button
              variant="outline"
              className="justify-start h-11 rounded-xl gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setShowDelete(true)}
            >
              <Trash2 className="h-4 w-4" /> Delete account
            </Button>
          </div>
          <div className="space-y-2 pt-1 text-[11px] text-muted-foreground leading-relaxed">
            <p>
              <span className="font-semibold text-foreground">Delete Account</span> removes your entire personal login — not only the recruiter profile. It may cancel both the driver and recruiter subscriptions owned by the same login.
            </p>
            <p>
              Personal recruiter, profile, and listing data may be removed through account cleanup. Shared applications, events, contracts, signatures, audit, billing/payment, fraud, dispute, legal/compliance, backup, or third-party records may be retained, detached, anonymized, or remain where operationally or lawfully necessary.
            </p>
            <p>
              If you own an agency, personal deletion is blocked until ownership is transferred or the agency is closed through support.
            </p>
            <p>
              <Link to="/docs/account-deletion-data-retention" className="text-primary hover:underline font-medium">
                Review deletion and retention details
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>

      <NotificationPreferencesPanel />

      <DeleteAccountModal open={showDelete} onOpenChange={setShowDelete} />
      <SendFeedbackModal open={showFeedback} onOpenChange={setShowFeedback} />
    </div>
  );
}

function Field({ label, value, className }: { label: string; value: string | null | undefined; className?: string }) {
  return (
    <div className={`rounded-lg border border-border/60 bg-card/40 p-3 ${className ?? ''}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className="text-sm font-medium text-foreground mt-0.5 break-words">{value || '—'}</p>
    </div>
  );
}

function ResourceLink({ icon: Icon, label, onClick }: { icon: typeof BookOpen; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 p-3 rounded-xl border border-border/60 hover:bg-muted/40 transition-colors text-left"
    >
      <div className="rounded-lg bg-primary/15 p-2 shrink-0"><Icon className="h-4 w-4 text-primary" /></div>
      <span className="text-sm font-semibold text-foreground">{label}</span>
    </button>
  );
}
