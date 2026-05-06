import { useState, useMemo } from 'react';
import { useRecurringExpenses, RecurringExpenseTemplateInsert, RecurringExpenseTemplate, isTemplateActive } from '@/hooks/useRecurringExpenses';
import { useUserSettings } from '@/hooks/useUserSettings';
import { EXPENSE_CATEGORIES } from '@/hooks/useExpenses';
import { classifyCategory } from '@/lib/expenseClassifier';
import { formatCurrency } from '@/lib/loadUtils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { RefreshCcw, Plus, Pencil, Trash2, Pause, Play, ArrowLeft, X, Lock, Home, PauseCircle, PlayCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { ProUpgradeModal } from '@/components/ProUpgradeModal';

interface RecurringExpensesViewProps {
  isPro: boolean;
  onBack: () => void;
}

export function RecurringExpensesView({ isPro, onBack }: RecurringExpensesViewProps) {
  const {
    templates, isLoading, addTemplate, updateTemplate,
    pauseTemplate, resumeTemplate, pauseAllTemplates, resumeAllTemplates, deleteTemplate,
  } = useRecurringExpenses();
  const { settings, updateSettings } = useUserSettings();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RecurringExpenseTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  // Pause / resume single
  const [pauseTarget, setPauseTarget] = useState<RecurringExpenseTemplate | null>(null);
  const [pauseReasonInput, setPauseReasonInput] = useState('');
  const [resumeTarget, setResumeTarget] = useState<RecurringExpenseTemplate | null>(null);

  // Bulk
  const [showPauseAll, setShowPauseAll] = useState(false);
  const [showResumeAll, setShowResumeAll] = useState(false);

  // Home time mode
  const [showStartHomeTime, setShowStartHomeTime] = useState(false);
  const [showEndHomeTime, setShowEndHomeTime] = useState(false);

  const { activeCount, pausedCount } = useMemo(() => {
    let a = 0, p = 0;
    for (const t of templates) {
      if (isTemplateActive(t)) a++; else p++;
    }
    return { activeCount: a, pausedCount: p };
  }, [templates]);

  const homeTimeActive = !!settings?.home_time_mode;

  const handleAdd = () => {
    if (!isPro) { setShowUpgrade(true); return; }
    setEditing(null);
    setShowForm(true);
  };

  const handleEdit = (template: RecurringExpenseTemplate) => {
    setEditing(template);
    setShowForm(true);
  };

  const handleConfirmPause = () => {
    if (!pauseTarget) return;
    pauseTemplate.mutate(
      { id: pauseTarget.id, reason: pauseReasonInput.trim() || null },
      {
        onSuccess: () => {
          toast.success('Template paused');
          setPauseTarget(null);
          setPauseReasonInput('');
        },
        onError: (e) => toast.error(e.message),
      }
    );
  };

  const handleConfirmResume = () => {
    if (!resumeTarget) return;
    const endDate = resumeTarget.end_date ? parseISO(resumeTarget.end_date) : null;
    const endDatePassed = endDate && endDate < new Date();
    resumeTemplate.mutate(resumeTarget.id, {
      onSuccess: () => {
        if (endDatePassed) {
          toast.warning('Template resumed, but end date has passed — no future expenses will generate.');
        } else {
          toast.success('Template resumed');
        }
        setResumeTarget(null);
      },
      onError: (e) => toast.error(e.message),
    });
  };

  const handleConfirmPauseAll = () => {
    pauseAllTemplates.mutate(undefined, {
      onSuccess: () => {
        toast.success(`Paused ${activeCount} template${activeCount === 1 ? '' : 's'}`);
        setShowPauseAll(false);
      },
      onError: (e) => toast.error(e.message),
    });
  };

  const handleConfirmResumeAll = () => {
    resumeAllTemplates.mutate(undefined, {
      onSuccess: () => {
        toast.success(`Resumed ${pausedCount} template${pausedCount === 1 ? '' : 's'}`);
        setShowResumeAll(false);
      },
      onError: (e) => toast.error(e.message),
    });
  };

  const handleStartHomeTime = () => {
    // Pause all currently-active templates with a home-time-specific reason,
    // then record their IDs on user_settings so "Back on the Road" only resumes
    // those (templates the user manually paused before home time stay paused).
    pauseAllTemplates.mutate('Home time mode', {
      onSuccess: (pausedIds) => {
        updateSettings.mutate(
          {
            home_time_mode: true,
            home_time_started_at: new Date().toISOString(),
            home_time_paused_template_ids: pausedIds ?? [],
          },
          {
            onSuccess: () => {
              toast.success('Home Time started — recurring expenses paused');
              setShowStartHomeTime(false);
            },
            onError: (e) => toast.error(e.message),
          }
        );
      },
      onError: (e) => toast.error(e.message),
    });
  };

  const handleEndHomeTime = () => {
    // Resume ONLY the templates that Home Time Mode itself paused.
    // Manually-paused templates remain paused.
    const idsToResume = (settings?.home_time_paused_template_ids as string[] | null) ?? [];
    resumeAllTemplates.mutate(idsToResume, {
      onSuccess: () => {
        updateSettings.mutate(
          {
            home_time_mode: false,
            home_time_ended_at: new Date().toISOString(),
            home_time_paused_template_ids: [],
          },
          {
            onSuccess: () => {
              toast.success('Welcome back on the road — recurring expenses resumed');
              setShowEndHomeTime(false);
            },
            onError: (e) => toast.error(e.message),
          }
        );
      },
      onError: (e) => toast.error(e.message),
    });
  };

  const handleConfirmDelete = () => {
    if (deleteTarget) {
      deleteTemplate.mutate(deleteTarget, {
        onSuccess: () => toast.success('Template deleted'),
        onError: (e) => toast.error(e.message),
      });
      setDeleteTarget(null);
    }
  };

  if (showForm) {
    return (
      <RecurringExpenseForm
        initialData={editing}
        onSubmit={(data) => {
          if (editing) {
            updateTemplate.mutate({ id: editing.id, data }, {
              onSuccess: () => { toast.success('Template updated'); setShowForm(false); setEditing(null); },
              onError: (e) => toast.error(e.message),
            });
          } else {
            addTemplate.mutate(data, {
              onSuccess: () => { toast.success('Template created'); setShowForm(false); },
              onError: (e) => toast.error(e.message),
            });
          }
        }}
        onCancel={() => { setShowForm(false); setEditing(null); }}
        loading={addTemplate.isPending || updateTemplate.isPending}
      />
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="rounded-xl" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-black tracking-tight">Recurring Expenses</h1>
            <p className="text-sm text-muted-foreground">Auto-generate monthly expenses on the 1st</p>
          </div>
        </div>
        <Button size="sm" className="rounded-xl gap-1.5 font-bold" onClick={handleAdd}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>

      {!isPro && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 flex items-center gap-3">
            <Lock className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">Pro Feature</p>
              <p className="text-xs text-muted-foreground">Recurring expenses auto-generate monthly. Upgrade to Pro to use this feature.</p>
            </div>
            <Button size="sm" className="shrink-0 rounded-xl font-bold" onClick={() => setShowUpgrade(true)}>
              Upgrade
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Home Time Mode card — only shown when Pro and at least one template exists, OR home time is already active */}
      {isPro && (templates.length > 0 || homeTimeActive) && (
        <Card className={`shadow-card transition-colors ${homeTimeActive ? 'border-primary/40 bg-primary/5' : ''}`}>
          <CardContent className="p-4 flex items-start gap-3">
            <div className={`rounded-xl p-2.5 shrink-0 ${homeTimeActive ? 'bg-primary/15' : 'bg-muted'}`}>
              <Home className={`h-5 w-5 ${homeTimeActive ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-bold text-sm">Home Time Mode</p>
                {homeTimeActive && <Badge variant="default" className="text-[10px]">Active</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {homeTimeActive
                  ? 'Recurring road expenses are paused. Resume when you head back out.'
                  : 'Pause recurring road expenses while you are home or temporarily off the road.'}
              </p>
              {homeTimeActive && settings?.home_time_started_at && (
                <p className="text-[10px] text-muted-foreground/70 mt-1">
                  Started {format(parseISO(settings.home_time_started_at), 'MMM d, yyyy')}
                </p>
              )}
            </div>
            {homeTimeActive ? (
              <Button size="sm" className="shrink-0 rounded-xl font-bold gap-1.5" onClick={() => setShowEndHomeTime(true)}>
                <PlayCircle className="h-4 w-4" /> Back on the Road
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="shrink-0 rounded-xl font-bold gap-1.5" onClick={() => setShowStartHomeTime(true)} disabled={activeCount === 0}>
                <PauseCircle className="h-4 w-4" /> Start
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Bulk controls — only shown when there are templates in the relevant state */}
      {isPro && (activeCount > 0 || pausedCount > 0) && (
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="text-xs text-muted-foreground">
            {activeCount} active · {pausedCount} paused
          </p>
          <div className="flex gap-2">
            {activeCount > 0 && (
              <Button size="sm" variant="outline" className="rounded-xl gap-1.5 text-xs h-8" onClick={() => setShowPauseAll(true)}>
                <Pause className="h-3.5 w-3.5" /> Pause All
              </Button>
            )}
            {pausedCount > 0 && (
              <Button size="sm" variant="outline" className="rounded-xl gap-1.5 text-xs h-8" onClick={() => setShowResumeAll(true)}>
                <Play className="h-3.5 w-3.5" /> Resume All
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Template List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="shadow-card">
              <CardContent className="p-4">
                <div className="skeleton-shimmer h-16 rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <Card className="border-dashed border-2 border-muted-foreground/20 shadow-card">
          <CardContent className="py-14 text-center">
            <div className="inline-flex items-center justify-center rounded-2xl bg-muted p-5 mb-5">
              <RefreshCcw className="h-12 w-12 text-muted-foreground/30" />
            </div>
            <p className="font-bold text-lg">No recurring expenses</p>
            <p className="text-sm text-muted-foreground mt-1.5">
              Set up templates for monthly expenses like insurance, truck payments, or phone bills.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {templates.map((template) => {
            const active = isTemplateActive(template);
            return (
              <Card key={template.id} className={`card-premium shadow-card transition-all duration-300 ${!active ? 'opacity-70' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`rounded-xl p-2.5 shrink-0 ${active ? 'bg-primary/10' : 'bg-muted'}`}>
                      <RefreshCcw className={`h-5 w-5 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm truncate">{template.template_name}</span>
                            {active ? (
                              <Badge variant="default" className="text-[10px]">Active</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">Paused</Badge>
                            )}
                          </div>
                          <p className="text-lg font-black mt-0.5">{formatCurrency(template.amount)}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <Badge variant="outline" className="text-[10px]">{template.category}</Badge>
                            <span className="text-xs text-muted-foreground capitalize">{template.frequency}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Start: {format(parseISO(template.start_date), 'MMM d, yyyy')}
                            {template.end_date && ` · End: ${format(parseISO(template.end_date), 'MMM d, yyyy')}`}
                          </p>
                          {!active && template.paused_at && (
                            <p className="text-[11px] text-muted-foreground mt-1">
                              Paused since {format(parseISO(template.paused_at), 'MMM d, yyyy')}
                              {template.pause_reason && ` · ${template.pause_reason}`}
                            </p>
                          )}
                          {template.last_generated_date && (
                            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                              Last generated: {format(parseISO(template.last_generated_date), 'MMM yyyy')}
                            </p>
                          )}
                          {template.notes && (
                            <p className="text-xs text-muted-foreground mt-1 truncate">{template.notes}</p>
                          )}
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          {active ? (
                            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" onClick={() => { setPauseReasonInput(''); setPauseTarget(template); }} aria-label="Pause template">
                              <Pause className="h-4 w-4" />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg text-primary" onClick={() => setResumeTarget(template)} aria-label="Resume template">
                              <Play className="h-4 w-4" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" onClick={() => handleEdit(template)} aria-label="Edit template">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg text-destructive hover:text-destructive" onClick={() => setDeleteTarget(template.id)} aria-label="Delete template">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {pausedCount > 0 && (
            <p className="text-[11px] text-muted-foreground text-center pt-2">
              Paused templates do not create new expenses until resumed.
            </p>
          )}
        </div>
      )}

      {/* Pause single template dialog */}
      <AlertDialog open={!!pauseTarget} onOpenChange={(open) => { if (!open) { setPauseTarget(null); setPauseReasonInput(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause Recurring Expense?</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop this template from creating new expenses until you resume it. Existing expenses will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="pause_reason" className="text-xs">Pause reason (optional)</Label>
            <Input
              id="pause_reason"
              placeholder="e.g. Home time, truck in shop"
              value={pauseReasonInput}
              onChange={(e) => setPauseReasonInput(e.target.value)}
              maxLength={120}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmPause} disabled={pauseTemplate.isPending}>
              {pauseTemplate.isPending ? 'Pausing…' : 'Pause Template'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Resume single template dialog */}
      <AlertDialog open={!!resumeTarget} onOpenChange={(open) => { if (!open) setResumeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resume Recurring Expense?</AlertDialogTitle>
            <AlertDialogDescription>
              This template will start creating future expenses again. It will not automatically recreate skipped expenses from the paused period.
              {resumeTarget?.end_date && parseISO(resumeTarget.end_date) < new Date() && (
                <span className="block mt-2 text-destructive">
                  Note: this template's end date has already passed, so no future expenses will be generated.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmResume} disabled={resumeTemplate.isPending}>
              {resumeTemplate.isPending ? 'Resuming…' : 'Resume Template'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pause All dialog */}
      <AlertDialog open={showPauseAll} onOpenChange={setShowPauseAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause All Recurring Expenses?</AlertDialogTitle>
            <AlertDialogDescription>
              Use this when you are taking home time or temporarily off the road. All {activeCount} active recurring expense template{activeCount === 1 ? '' : 's'} will stop creating new expenses until you resume them. Existing expenses will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmPauseAll} disabled={pauseAllTemplates.isPending}>
              {pauseAllTemplates.isPending ? 'Pausing…' : 'Pause All'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Resume All dialog */}
      <AlertDialog open={showResumeAll} onOpenChange={setShowResumeAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resume All Recurring Expenses?</AlertDialogTitle>
            <AlertDialogDescription>
              All {pausedCount} paused recurring expense template{pausedCount === 1 ? '' : 's'} will start creating future expenses again. Skipped expenses from the paused period will not be recreated automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmResumeAll} disabled={resumeAllTemplates.isPending}>
              {resumeAllTemplates.isPending ? 'Resuming…' : 'Resume All'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Start Home Time dialog */}
      <AlertDialog open={showStartHomeTime} onOpenChange={setShowStartHomeTime}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start Home Time?</AlertDialogTitle>
            <AlertDialogDescription>
              All {activeCount} active recurring expense template{activeCount === 1 ? '' : 's'} will be paused so they don't generate while you're off the road. You can resume anytime by tapping "Back on the Road."
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleStartHomeTime} disabled={pauseAllTemplates.isPending || updateSettings.isPending}>
              {(pauseAllTemplates.isPending || updateSettings.isPending) ? 'Starting…' : 'Start Home Time'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* End Home Time dialog */}
      <AlertDialog open={showEndHomeTime} onOpenChange={setShowEndHomeTime}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Back on the Road?</AlertDialogTitle>
            <AlertDialogDescription>
              All paused recurring expense templates will be resumed. Skipped expenses from your home time will not be recreated automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleEndHomeTime} disabled={resumeAllTemplates.isPending || updateSettings.isPending}>
              {(resumeAllTemplates.isPending || updateSettings.isPending) ? 'Resuming…' : 'Back on the Road'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this template?</AlertDialogTitle>
            <AlertDialogDescription>This won't delete previously generated expenses. Future generation will stop.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ProUpgradeModal open={showUpgrade} onOpenChange={setShowUpgrade} featureName="Recurring Expenses" />
    </div>
  );
}

// --- Form Component ---

interface RecurringExpenseFormProps {
  initialData?: RecurringExpenseTemplate | null;
  onSubmit: (data: RecurringExpenseTemplateInsert) => void;
  onCancel: () => void;
  loading?: boolean;
}

function RecurringExpenseForm({ initialData, onSubmit, onCancel, loading }: RecurringExpenseFormProps) {
  const isEdit = !!initialData;

  const [form, setForm] = useState({
    template_name: initialData?.template_name ?? '',
    category: initialData?.category ?? '',
    amount: initialData?.amount?.toString() ?? '',
    start_date: initialData?.start_date ?? new Date().toISOString().split('T')[0],
    end_date: initialData?.end_date ?? '',
    notes: initialData?.notes ?? '',
    expense_type: initialData?.expense_type ?? 'fixed' as string,
  });

  const update = (key: string, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'category' && !isEdit) {
        next.expense_type = classifyCategory(value);
      }
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    if (!form.template_name.trim()) { toast.error('Template name is required'); return; }
    if (!form.category) { toast.error('Category is required'); return; }
    if (isNaN(amount) || amount <= 0) { toast.error('Amount must be greater than 0'); return; }

    // NOTE: when editing a paused template, we deliberately do NOT change its status here.
    // Status only changes via explicit Pause / Resume actions.
    onSubmit({
      template_name: form.template_name.trim(),
      category: form.category,
      amount,
      frequency: 'monthly',
      start_date: form.start_date,
      end_date: form.end_date || null,
      notes: form.notes.trim() || null,
      expense_type: form.expense_type,
    });
  };

  return (
    <Card className="border-2 border-primary/20 shadow-lg animate-fade-in">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl font-heading flex items-center gap-2">
            <RefreshCcw className="h-5 w-5 text-primary" />
            {isEdit ? 'Edit Template' : 'New Recurring Expense'}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="template_name">Template Name</Label>
            <Input
              id="template_name"
              placeholder="e.g. Monthly Insurance"
              value={form.template_name}
              onChange={(e) => update('template_name', e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="category">Category</Label>
              <Select value={form.category} onValueChange={(v) => update('category', v)}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="amount">Amount ($)</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => update('amount', e.target.value)}
                required
              />
            </div>
          </div>

          {form.category && (
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">Type:</p>
              <Badge variant={form.expense_type === 'fixed' ? 'secondary' : 'outline'} className="text-[10px] cursor-pointer" onClick={() => setForm((p) => ({ ...p, expense_type: 'fixed' }))}>
                Fixed
              </Badge>
              <Badge variant={form.expense_type === 'variable' ? 'secondary' : 'outline'} className="text-[10px] cursor-pointer" onClick={() => setForm((p) => ({ ...p, expense_type: 'variable' }))}>
                Variable
              </Badge>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="start_date">Start Date</Label>
              <Input
                id="start_date"
                type="date"
                value={form.start_date}
                onChange={(e) => update('start_date', e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="end_date">End Date (optional)</Label>
              <Input
                id="end_date"
                type="date"
                value={form.end_date}
                onChange={(e) => update('end_date', e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label>Frequency</Label>
            <p className="text-sm text-muted-foreground mt-1">Monthly (generated on the 1st of each month)</p>
          </div>

          <div>
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              placeholder="Optional notes..."
              rows={2}
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
            />
          </div>

          <Button type="submit" className="w-full h-12 text-base font-bold" disabled={loading}>
            {loading ? 'Saving...' : isEdit ? 'Update Template' : 'Create Template'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
