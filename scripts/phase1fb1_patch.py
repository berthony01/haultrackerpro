from pathlib import Path

FORM = Path('src/components/opportunities/RecruiterOpportunityForm.tsx')
MANAGER = Path('src/components/opportunities/RecruiterOpportunityManager.tsx')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


form = FORM.read_text()

insert_after = """function hasAdvancedData(f: FormState): boolean {
  return (
    !!f.hiring_states.trim() ||
    !!f.typical_lanes.trim() ||
    !!f.estimated_loaded_miles ||
    !!f.estimated_deadhead_miles ||
    f.deadhead_paid !== 'unspecified' ||
    !!f.detention_pay.trim() ||
    !!f.layover_pay.trim() ||
    !!f.sign_on_bonus ||
    !!f.fuel_paid_by.trim() ||
    !!f.insurance_deductions ||
    !!f.escrow_required ||
    !!f.escrow_amount ||
    !!f.lease_payment ||
    !!f.maintenance_deductions ||
    !!f.other_deductions ||
    !!f.home_time.trim() ||
    f.forced_dispatch !== 'unspecified' ||
    f.pets_allowed !== 'unspecified' ||
    f.riders_allowed !== 'unspecified' ||
    !!f.equipment_year.trim() ||
    !!f.benefits.trim()
  );
}
"""
merge_helper = insert_after + """

function mergeExtractedOpportunity(
  current: FormState,
  data: ExtractedOpportunity,
): { nextForm: FormState; advancedFilled: boolean } {
  const next = { ...current };
  let advancedFilled = false;

  const fillString = (key: keyof FormState, value?: string, advanced = false) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const existing = next[key];
    if (typeof existing === 'string' && !existing.trim()) {
      (next[key] as string) = value;
      if (advanced) advancedFilled = true;
    }
  };
  const fillNumber = (key: keyof FormState, value?: number, advanced = false) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    if (next[key] === '') {
      (next[key] as string) = String(value);
      if (advanced) advancedFilled = true;
    }
  };
  const fillTriState = (
    key: 'forced_dispatch' | 'pets_allowed' | 'riders_allowed',
    value?: boolean,
  ) => {
    if (typeof value === 'boolean' && next[key] === 'unspecified') {
      next[key] = value ? 'yes' : 'no';
      advancedFilled = true;
    }
  };

  fillString('title', data.title);
  fillString('company_name', data.company_name);
  fillString('hiring_city', data.hiring_city);
  fillString('hiring_state', data.hiring_state);
  fillString('driver_type', data.driver_type);
  fillString('route_type', data.route_type);
  fillString('trailer_type', data.trailer_type);
  fillString('description', data.description);
  fillString('pay_model', data.pay_model);
  fillNumber('cpm', data.cpm);
  fillNumber('percentage_pay', data.percentage_pay);
  fillNumber('flat_weekly_pay', data.flat_weekly_pay);
  fillNumber('estimated_weekly_gross', data.estimated_weekly_gross);
  fillNumber('estimated_weekly_miles', data.estimated_weekly_miles);

  if (Array.isArray(data.hiring_states) && data.hiring_states.length && !next.hiring_states.trim()) {
    next.hiring_states = data.hiring_states.join(', ');
    advancedFilled = true;
  }
  fillNumber('estimated_loaded_miles', data.estimated_loaded_miles, true);
  fillNumber('estimated_deadhead_miles', data.estimated_deadhead_miles, true);
  if (typeof data.deadhead_paid === 'boolean' && next.deadhead_paid === 'unspecified') {
    next.deadhead_paid = data.deadhead_paid ? 'paid' : 'unpaid';
    advancedFilled = true;
  }
  fillString('detention_pay', data.detention_pay, true);
  fillString('layover_pay', data.layover_pay, true);
  fillNumber('sign_on_bonus', data.sign_on_bonus, true);
  fillString('fuel_paid_by', data.fuel_paid_by, true);
  fillNumber('insurance_deductions', data.insurance_deductions, true);
  if (data.escrow_required === true && !next.escrow_required) {
    next.escrow_required = true;
    advancedFilled = true;
  }
  fillNumber('escrow_amount', data.escrow_amount, true);
  fillNumber('lease_payment', data.lease_payment, true);
  fillNumber('maintenance_deductions', data.maintenance_deductions, true);
  fillNumber('other_deductions', data.other_deductions, true);
  fillString('home_time', data.home_time, true);
  fillTriState('forced_dispatch', data.forced_dispatch);
  fillTriState('pets_allowed', data.pets_allowed);
  fillTriState('riders_allowed', data.riders_allowed);
  fillString('equipment_year', data.equipment_year, true);
  fillString('typical_lanes', data.typical_lanes, true);
  const requirements = data.requirements?.trim()
    ? data.requirements
    : data.benefits?.trim()
      ? data.benefits
      : undefined;
  fillString('benefits', requirements, true);

  return { nextForm: next, advancedFilled };
}
"""
form = replace_once(form, insert_after, merge_helper, 'merge helper insertion')

old_effect = """  // Hydrate from `initial` on edit; otherwise prefill company_name from profile.
  useEffect(() => {
    if (initializedRef.current) return;
    if (initial) {
      const split = splitBenefits(initial.benefits);
      const next: FormState = {
        title: initial.title ?? '',
        company_name: initial.company_name ?? '',
        hiring_city: initial.hiring_city ?? '',
        hiring_state: initial.hiring_state ?? '',
        hiring_states: (initial.hiring_states ?? []).join(', '),
        driver_type: initial.driver_type ?? '',
        route_type: initial.route_type ?? '',
        trailer_type: initial.trailer_type ?? '',
        description: initial.description ?? '',
        pay_model: initial.pay_model ?? '',
        cpm: initial.cpm?.toString() ?? '',
        percentage_pay: initial.percentage_pay?.toString() ?? '',
        flat_weekly_pay: initial.flat_weekly_pay?.toString() ?? '',
        estimated_weekly_gross: initial.estimated_weekly_gross?.toString() ?? '',
        estimated_weekly_miles: initial.estimated_weekly_miles?.toString() ?? '',
        estimated_loaded_miles: initial.estimated_loaded_miles?.toString() ?? '',
        estimated_deadhead_miles: initial.estimated_deadhead_miles?.toString() ?? '',
        deadhead_paid: boolToDh(initial.deadhead_paid),
        detention_pay: initial.detention_pay ?? '',
        layover_pay: initial.layover_pay ?? '',
        sign_on_bonus: initial.sign_on_bonus?.toString() ?? '',
        fuel_paid_by: initial.fuel_paid_by ?? '',
        insurance_deductions: initial.insurance_deductions?.toString() ?? '',
        escrow_required: !!initial.escrow_required,
        escrow_amount: initial.escrow_amount?.toString() ?? '',
        lease_payment: initial.lease_payment?.toString() ?? '',
        maintenance_deductions: initial.maintenance_deductions?.toString() ?? '',
        other_deductions: initial.other_deductions?.toString() ?? '',
        home_time: initial.home_time ?? '',
        forced_dispatch: boolToTri(initial.forced_dispatch),
        pets_allowed: boolToTri(initial.pets_allowed),
        riders_allowed: boolToTri(initial.riders_allowed),
        equipment_year: initial.equipment_year ?? '',
        benefits: split.requirements,
        typical_lanes: split.typical_lanes,
        transparency_confirmed: !!initial.transparency_confirmed,
      };
      setForm(next);
      setOptionalOpen(hasAdvancedData(next));
      initializedRef.current = true;
      return;
    }
    // Create mode — company_name prefill only
    if (profile?.company_name) {
      setForm((f) => (f.company_name ? f : { ...f, company_name: profile.company_name ?? '' }));
    }
    initializedRef.current = true;
  }, [initial, profile]);
"""
new_effect = """  // Edit hydration runs once. Create-mode company prefill remains responsive to late profile data.
  useEffect(() => {
    if (initial) {
      if (initializedRef.current) return;
      const split = splitBenefits(initial.benefits);
      const next: FormState = {
        title: initial.title ?? '',
        company_name: initial.company_name ?? '',
        hiring_city: initial.hiring_city ?? '',
        hiring_state: initial.hiring_state ?? '',
        hiring_states: (initial.hiring_states ?? []).join(', '),
        driver_type: initial.driver_type ?? '',
        route_type: initial.route_type ?? '',
        trailer_type: initial.trailer_type ?? '',
        description: initial.description ?? '',
        pay_model: initial.pay_model ?? '',
        cpm: initial.cpm?.toString() ?? '',
        percentage_pay: initial.percentage_pay?.toString() ?? '',
        flat_weekly_pay: initial.flat_weekly_pay?.toString() ?? '',
        estimated_weekly_gross: initial.estimated_weekly_gross?.toString() ?? '',
        estimated_weekly_miles: initial.estimated_weekly_miles?.toString() ?? '',
        estimated_loaded_miles: initial.estimated_loaded_miles?.toString() ?? '',
        estimated_deadhead_miles: initial.estimated_deadhead_miles?.toString() ?? '',
        deadhead_paid: boolToDh(initial.deadhead_paid),
        detention_pay: initial.detention_pay ?? '',
        layover_pay: initial.layover_pay ?? '',
        sign_on_bonus: initial.sign_on_bonus?.toString() ?? '',
        fuel_paid_by: initial.fuel_paid_by ?? '',
        insurance_deductions: initial.insurance_deductions?.toString() ?? '',
        escrow_required: !!initial.escrow_required,
        escrow_amount: initial.escrow_amount?.toString() ?? '',
        lease_payment: initial.lease_payment?.toString() ?? '',
        maintenance_deductions: initial.maintenance_deductions?.toString() ?? '',
        other_deductions: initial.other_deductions?.toString() ?? '',
        home_time: initial.home_time ?? '',
        forced_dispatch: boolToTri(initial.forced_dispatch),
        pets_allowed: boolToTri(initial.pets_allowed),
        riders_allowed: boolToTri(initial.riders_allowed),
        equipment_year: initial.equipment_year ?? '',
        benefits: split.requirements,
        typical_lanes: split.typical_lanes,
        transparency_confirmed: !!initial.transparency_confirmed,
      };
      setForm(next);
      setOptionalOpen(hasAdvancedData(next));
      initializedRef.current = true;
      return;
    }
    if (profile?.company_name) {
      setForm((current) => current.company_name
        ? current
        : { ...current, company_name: profile.company_name ?? '' });
    }
  }, [initial, profile]);
"""
form = replace_once(form, old_effect, new_effect, 'hydration effect')

start = form.index('  // Paste-to-autofill merges without overwriting fields the recruiter already typed.')
end = form.index('\n  const showCpm =', start)
new_handler = """  // Paste-to-autofill is computed synchronously so advanced expansion is deterministic.
  const handleExtracted = (data: ExtractedOpportunity) => {
    const { nextForm, advancedFilled } = mergeExtractedOpportunity(form, data);
    setForm(nextForm);
    if (advancedFilled) setOptionalOpen(true);
  };
"""
form = form[:start] + new_handler + form[end:]

replacements = [
    ('placeholder="Example: Regional Dry Van Driver Needed"\n          />', 'placeholder="Example: Regional Dry Van Driver Needed"\n            aria-label="Opportunity Title"\n          />', 'title aria'),
    ('placeholder="ABC Logistics LLC"\n          />', 'placeholder="ABC Logistics LLC"\n            aria-label="Company Name"\n          />', 'company aria'),
    ('<SelectTrigger><SelectValue placeholder="Select route type" /></SelectTrigger>', '<SelectTrigger aria-label="Route Type"><SelectValue placeholder="Select route type" /></SelectTrigger>', 'route aria'),
    ('<SelectTrigger><SelectValue placeholder="Select trailer type" /></SelectTrigger>', '<SelectTrigger aria-label="Trailer Type"><SelectValue placeholder="Select trailer type" /></SelectTrigger>', 'trailer aria'),
    ('placeholder="Dallas"\n            />', 'placeholder="Dallas"\n              aria-label="Hiring City"\n            />', 'city aria'),
    ('<SelectTrigger><SelectValue placeholder="TX" /></SelectTrigger>', '<SelectTrigger aria-label="State"><SelectValue placeholder="TX" /></SelectTrigger>', 'state aria'),
    ('placeholder="Briefly describe the opportunity, lanes, and what drivers can expect."\n          />', 'placeholder="Briefly describe the opportunity, lanes, and what drivers can expect."\n            aria-label="Short Description"\n          />', 'description aria'),
    ('placeholder="TX, OK, AR"\n              />', 'placeholder="TX, OK, AR"\n                aria-label="Hiring States"\n              />', 'hiring states aria'),
    ("placeholder={'Dallas, TX → Houston, TX\\nMidwest → Southeast'}\n              />", "placeholder={'Dallas, TX → Houston, TX\\nMidwest → Southeast'}\n                aria-label=\"Typical Lanes\"\n              />", 'lanes aria'),
    ('<Select value={form.deadhead_paid} onValueChange={(v) => set(\'deadhead_paid\', v as DhOpt)}>\n                  <SelectTrigger><SelectValue /></SelectTrigger>', '<Select value={form.deadhead_paid} onValueChange={(v) => set(\'deadhead_paid\', v as DhOpt)}>\n                  <SelectTrigger aria-label="Deadhead Paid?"><SelectValue /></SelectTrigger>', 'deadhead aria'),
    ('placeholder="Example: 2020–2024 Freightliner Cascadia"\n              />', 'placeholder="Example: 2020–2024 Freightliner Cascadia"\n                aria-label="Equipment Year / Truck Info"\n              />', 'equipment aria'),
    ('<Input value={form.detention_pay} onChange={(e) => set(\'detention_pay\', e.target.value)} placeholder="Example: $25/hr after 2 hrs" />', '<Input value={form.detention_pay} onChange={(e) => set(\'detention_pay\', e.target.value)} placeholder="Example: $25/hr after 2 hrs" aria-label="Detention Pay" />', 'detention aria'),
    ('<Input value={form.layover_pay} onChange={(e) => set(\'layover_pay\', e.target.value)} placeholder="Example: $150/day" />', '<Input value={form.layover_pay} onChange={(e) => set(\'layover_pay\', e.target.value)} placeholder="Example: $150/day" aria-label="Layover Pay" />', 'layover aria'),
    ('<SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>', '<SelectTrigger aria-label="Fuel Paid By"><SelectValue placeholder="Select" /></SelectTrigger>', 'fuel aria'),
    ('placeholder="Home weekly, every 2 weeks"\n                />', 'placeholder="Home weekly, every 2 weeks"\n                  aria-label="Home Time"\n                />', 'home aria'),
    ('<Checkbox checked={form.escrow_required} onCheckedChange={(v) => set(\'escrow_required\', !!v)} />', '<Checkbox checked={form.escrow_required} onCheckedChange={(v) => set(\'escrow_required\', !!v)} aria-label="Escrow Required?" />', 'escrow aria'),
    ("placeholder={'Example:\\n• 1 year OTR experience\\n• Class A CDL\\n• Clean MVR last 3 years'}\n              />", "placeholder={'Example:\\n• 1 year OTR experience\\n• Class A CDL\\n• Clean MVR last 3 years'}\n                aria-label=\"Additional Requirements\"\n              />", 'requirements aria'),
    ('min={0}\n        value={value}', 'min={0}\n        aria-label={label}\n        value={value}', 'numeric aria'),
    ('max={5}\n          value={value}', 'max={5}\n          aria-label="CPM Rate ($/mi)"\n          value={value}', 'cpm aria'),
    ('<Select value={value} onValueChange={(v) => onChange(v as Tribool)}>\n        <SelectTrigger><SelectValue /></SelectTrigger>', '<Select value={value} onValueChange={(v) => onChange(v as Tribool)}>\n        <SelectTrigger aria-label={label}><SelectValue /></SelectTrigger>', 'tribool aria'),
]
for old, new, label in replacements:
    form = replace_once(form, old, new, label)

FORM.write_text(form)

manager = MANAGER.read_text()
manager = replace_once(
    manager,
    'Create and manage your trucking opportunities. Verified recruiter posts go live to drivers immediately.',
    'Completed Recruiter profiles can post opportunities immediately. Verification adds trust and a badge; it does not control posting access.',
    'manager header copy',
)
review_variant = """  const reviewVariant: Record<string, 'default' | 'outline' | 'secondary' | 'destructive'> = {
    approved: 'default',
    pending: 'outline',
    rejected: 'destructive',
  };
"""
manager = replace_once(manager, review_variant, '', 'review variant')
review_badge = """            <Badge variant={reviewVariant[o.admin_review_status] ?? 'outline'} className="capitalize">
              Review: {o.admin_review_status}
            </Badge>
"""
manager = replace_once(manager, review_badge, '', 'review badge')
review_warning = """          {o.admin_review_status === 'rejected' && (
            <p className="text-[11px] mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-destructive">
              This post was rejected by admin review. Edit it and resubmit — changes are reviewed before going live again.
            </p>
          )}
"""
manager = replace_once(manager, review_warning, '', 'review warning')
old_actions = """          {o.admin_review_status === 'rejected' ? (
            <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>
              <Send className="h-4 w-4" /> Resubmit for Review
            </Button>
          ) : o.status === 'active' ? (
            <Button size="sm" variant="outline" onClick={onPause} disabled={busy}>
              <PauseCircle className="h-4 w-4" /> Pause
            </Button>
          ) : o.status === 'draft' ? (
            <Button size="sm" variant="outline" onClick={onActivate} disabled={busy || !canActivate}>
              <Send className="h-4 w-4" /> Publish
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onActivate} disabled={busy || !canActivate}>
              <PlayCircle className="h-4 w-4" /> Activate
            </Button>
          )}
          {o.status !== 'closed' && o.admin_review_status !== 'rejected' && (
            <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>
              <XCircle className="h-4 w-4" /> Close
            </Button>
          )}
"""
new_actions = """          {o.status === 'active' ? (
            <Button size="sm" variant="outline" onClick={onPause} disabled={busy}>
              <PauseCircle className="h-4 w-4" /> Pause
            </Button>
          ) : o.status === 'draft' ? (
            <Button size="sm" variant="outline" onClick={onActivate} disabled={busy || !canActivate}>
              <Send className="h-4 w-4" /> Publish
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onActivate} disabled={busy || !canActivate}>
              <PlayCircle className="h-4 w-4" /> Activate
            </Button>
          )}
          {o.status !== 'closed' && (
            <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>
              <XCircle className="h-4 w-4" /> Close
            </Button>
          )}
"""
manager = replace_once(manager, old_actions, new_actions, 'status actions')
MANAGER.write_text(manager)

print('Phase 1F-B.1 production patch applied successfully')
