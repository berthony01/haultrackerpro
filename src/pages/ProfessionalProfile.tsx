import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageNav } from '@/components/layout/PageNav';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import {
  type ProfessionalProfile,
  type ProfessionalProfileAvailability,
  type ProfessionalProfileVisibility,
  useMyProfessionalProfile,
  useProfessionalProfileMutations,
} from '@/hooks/useProfessionalProfile';
import {
  BriefcaseBusiness,
  Loader2,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

type FormState = {
  displayName: string;
  professionalTitle: string;
  bio: string;
  yearsExperience: string;
  services: string;
  serviceAreas: string;
  availability: ProfessionalProfileAvailability;
  contactEmail: string;
  contactPhone: string;
  visibility: ProfessionalProfileVisibility;
  shareContactDetails: boolean;
};

const AVAILABILITY_OPTIONS: Array<{
  value: ProfessionalProfileAvailability;
  label: string;
}> = [
  { value: 'available', label: 'Available' },
  { value: 'limited', label: 'Limited availability' },
  { value: 'unavailable', label: 'Unavailable' },
];

const VISIBILITY_OPTIONS: Array<{
  value: ProfessionalProfileVisibility;
  label: string;
}> = [
  { value: 'private', label: 'Private' },
  { value: 'authorized_connections', label: 'Authorized connections' },
];

function accountString(
  metadata: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function accountPrefill(user: ReturnType<typeof useAuth>['user']): FormState {
  const metadata = (user?.user_metadata ?? {}) as Record<string, unknown>;
  return {
    displayName: accountString(metadata, 'display_name', 'full_name', 'name'),
    professionalTitle: '',
    bio: '',
    yearsExperience: '',
    services: '',
    serviceAreas: '',
    availability: 'available',
    contactEmail: user?.email?.trim() ?? '',
    contactPhone: accountString(metadata, 'phone'),
    visibility: 'private',
    shareContactDetails: false,
  };
}

function profileToForm(profile: ProfessionalProfile): FormState {
  return {
    displayName: profile.display_name,
    professionalTitle: profile.professional_title ?? '',
    bio: profile.bio ?? '',
    yearsExperience:
      profile.years_experience == null ? '' : String(profile.years_experience),
    services: (profile.services ?? []).join(', '),
    serviceAreas: (profile.service_areas ?? []).join(', '),
    availability: profile.availability,
    contactEmail: profile.contact_email ?? '',
    contactPhone: profile.contact_phone ?? '',
    visibility: profile.visibility,
    shareContactDetails:
      profile.visibility === 'authorized_connections' &&
      profile.share_contact_details === true,
  };
}

export function parseProfessionalProfileList(
  value: string,
  label: string,
  maxLength: number,
): string[] {
  const nonblank = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (nonblank.length > 12) {
    throw new Error(`${label} may contain at most 12 entries.`);
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of nonblank) {
    if (item.length > maxLength) {
      throw new Error(
        `Each ${label.toLowerCase()} entry must be ${maxLength} characters or fewer.`,
      );
    }
    const key = item.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

export default function ProfessionalProfilePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const {
    data: profile,
    isLoading,
    isError,
    error,
    refetch,
  } = useMyProfessionalProfile();
  const { upsert, remove } = useProfessionalProfileMutations();
  const [form, setForm] = useState<FormState>(() => accountPrefill(user));
  const [validationError, setValidationError] = useState<string | null>(null);

  const accountEmail = user?.email?.trim() ?? '';
  const accountPhone = useMemo(() => {
    const metadata = (user?.user_metadata ?? {}) as Record<string, unknown>;
    return accountString(metadata, 'phone');
  }, [user?.user_metadata]);

  useEffect(() => {
    if (!user || isLoading) return;
    setForm(profile ? profileToForm(profile) : accountPrefill(user));
  }, [isLoading, profile?.updated_at, profile?.user_id, user?.id]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setValidationError(null);
  }

  function changeVisibility(value: ProfessionalProfileVisibility) {
    setForm((current) => ({
      ...current,
      visibility: value,
      shareContactDetails:
        value === 'authorized_connections'
          ? current.shareContactDetails
          : false,
    }));
    setValidationError(null);
  }

  async function saveProfile() {
    try {
      const displayName = form.displayName.trim();
      if (displayName.length < 2 || displayName.length > 80) {
        throw new Error('Display name must be between 2 and 80 characters.');
      }
      if (form.professionalTitle.trim().length > 120) {
        throw new Error('Professional title must be 120 characters or fewer.');
      }
      if (form.bio.trim().length > 1000) {
        throw new Error('Bio must be 1,000 characters or fewer.');
      }
      if (form.contactEmail.trim().length > 320) {
        throw new Error('Professional contact email must be 320 characters or fewer.');
      }
      if (form.contactPhone.trim().length > 40) {
        throw new Error('Professional contact phone must be 40 characters or fewer.');
      }

      let yearsExperience: number | null = null;
      if (form.yearsExperience.trim()) {
        yearsExperience = Number(form.yearsExperience);
        if (
          !Number.isInteger(yearsExperience) ||
          yearsExperience < 0 ||
          yearsExperience > 70
        ) {
          throw new Error('Years of experience must be a whole number from 0 to 70.');
        }
      }

      const services = parseProfessionalProfileList(
        form.services,
        'Services offered',
        60,
      );
      const serviceAreas = parseProfessionalProfileList(
        form.serviceAreas,
        'Service areas',
        80,
      );

      await upsert.mutateAsync({
        display_name: displayName,
        professional_title: nullable(form.professionalTitle),
        bio: nullable(form.bio),
        years_experience: yearsExperience,
        services,
        service_areas: serviceAreas,
        availability: form.availability,
        contact_email: nullable(form.contactEmail),
        contact_phone: nullable(form.contactPhone),
        visibility: form.visibility,
        share_contact_details:
          form.visibility === 'authorized_connections' &&
          form.shareContactDetails,
      });
      setValidationError(null);
      toast({ title: 'Professional profile saved' });
    } catch (saveError: any) {
      const message = saveError?.message || 'Could not save your professional profile.';
      setValidationError(message);
      toast({
        title: 'Could not save professional profile',
        description: message,
        variant: 'destructive',
      });
    }
  }

  async function deleteProfile() {
    try {
      await remove.mutateAsync();
      setForm(accountPrefill(user));
      setValidationError(null);
      toast({ title: 'Professional profile deleted' });
    } catch (deleteError: any) {
      toast({
        title: 'Could not delete professional profile',
        description: deleteError?.message,
        variant: 'destructive',
      });
    }
  }

  return (
    <AppShell>
      <div className="container mx-auto max-w-3xl px-4 py-6 space-y-6">
        <PageNav trail={[{ label: 'Professional Profile' }]} />

        <header className="space-y-2">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BriefcaseBusiness className="h-6 w-6 text-primary" />
            Professional Profile
          </h1>
          <p className="text-sm text-muted-foreground">
            Create one reusable professional identity for your assistant and agency
            work. The same profile follows you across those roles.
          </p>
        </header>

        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertDescription className="space-y-1">
            <p>
              This is separate from your agency&apos;s business profile and from your
              sign-in or account information.
            </p>
            <p>
              It is also separate from a driver&apos;s Leaderboard Identity and
              Opportunity Preferences. A professional profile never grants access to
              a driver or agency; memberships, invitations, and permissions remain
              separate approvals.
            </p>
          </AlertDescription>
        </Alert>

        {isLoading ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
              Loading professional profile…
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="py-8 text-center space-y-3">
              <p className="text-sm text-destructive">
                {(error as Error)?.message || 'Could not load your professional profile.'}
              </p>
              <Button variant="outline" onClick={() => refetch()}>
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Professional identity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <Field label="Display name" htmlFor="professional-display-name" required>
                  <Input
                    id="professional-display-name"
                    value={form.displayName}
                    onChange={(event) => setField('displayName', event.target.value)}
                    maxLength={80}
                    placeholder="Your professional name"
                  />
                </Field>

                <Field label="Professional title" htmlFor="professional-title">
                  <Input
                    id="professional-title"
                    value={form.professionalTitle}
                    onChange={(event) =>
                      setField('professionalTitle', event.target.value)
                    }
                    maxLength={120}
                    placeholder="Dispatcher, bookkeeper, agency specialist…"
                  />
                </Field>

                <Field label="Bio" htmlFor="professional-bio">
                  <Textarea
                    id="professional-bio"
                    value={form.bio}
                    onChange={(event) => setField('bio', event.target.value)}
                    maxLength={1000}
                    rows={5}
                    placeholder="Describe your experience and the value you provide."
                  />
                  <p className="text-xs text-muted-foreground text-right">
                    {form.bio.length}/1,000
                  </p>
                </Field>

                <Field
                  label="Years of experience"
                  htmlFor="professional-years-experience"
                >
                  <Input
                    id="professional-years-experience"
                    type="number"
                    min={0}
                    max={70}
                    step={1}
                    value={form.yearsExperience}
                    onChange={(event) =>
                      setField('yearsExperience', event.target.value)
                    }
                    placeholder="0"
                  />
                </Field>

                <Field label="Services offered" htmlFor="professional-services">
                  <Input
                    id="professional-services"
                    value={form.services}
                    onChange={(event) => setField('services', event.target.value)}
                    placeholder="Dispatch, bookkeeping, document management"
                  />
                  <p className="text-xs text-muted-foreground">
                    Separate entries with commas. Maximum 12; each may be up to 60
                    characters.
                  </p>
                </Field>

                <Field label="Service areas" htmlFor="professional-service-areas">
                  <Input
                    id="professional-service-areas"
                    value={form.serviceAreas}
                    onChange={(event) => setField('serviceAreas', event.target.value)}
                    placeholder="Texas, nationwide, Central time"
                  />
                  <p className="text-xs text-muted-foreground">
                    Separate entries with commas. Maximum 12; each may be up to 80
                    characters.
                  </p>
                </Field>

                <Field label="Availability" htmlFor="professional-availability">
                  <select
                    id="professional-availability"
                    value={form.availability}
                    onChange={(event) =>
                      setField(
                        'availability',
                        event.target.value as ProfessionalProfileAvailability,
                      )
                    }
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {AVAILABILITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Professional contact information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <Field
                  label="Professional contact email"
                  htmlFor="professional-contact-email"
                >
                  <Input
                    id="professional-contact-email"
                    type="email"
                    value={form.contactEmail}
                    onChange={(event) => setField('contactEmail', event.target.value)}
                    maxLength={320}
                    placeholder="professional@example.com"
                  />
                  {accountEmail && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setField('contactEmail', accountEmail)}
                    >
                      Use account email
                    </Button>
                  )}
                </Field>

                <Field
                  label="Professional contact phone"
                  htmlFor="professional-contact-phone"
                >
                  <Input
                    id="professional-contact-phone"
                    value={form.contactPhone}
                    onChange={(event) => setField('contactPhone', event.target.value)}
                    maxLength={40}
                    placeholder="(555) 555-5555"
                  />
                  {accountPhone && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setField('contactPhone', accountPhone)}
                    >
                      Use account phone
                    </Button>
                  )}
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Privacy and sharing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <Field label="Profile visibility" htmlFor="professional-visibility">
                  <select
                    id="professional-visibility"
                    value={form.visibility}
                    onChange={(event) =>
                      changeVisibility(
                        event.target.value as ProfessionalProfileVisibility,
                      )
                    }
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {VISIBILITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {form.visibility === 'private'
                      ? 'Private profiles are visible only to you.'
                      : 'Authorized connections may include active assistants, approved or pending agency delegations, and active members of the same active agency.'}
                  </p>
                </Field>

                <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                  <div className="space-y-1">
                    <Label htmlFor="professional-share-contact">
                      Share contact details
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Contact information remains hidden from connections unless you
                      explicitly enable this while visibility is Authorized
                      connections.
                    </p>
                  </div>
                  <Switch
                    id="professional-share-contact"
                    aria-label="Share contact details"
                    checked={
                      form.visibility === 'authorized_connections' &&
                      form.shareContactDetails
                    }
                    disabled={form.visibility !== 'authorized_connections'}
                    onCheckedChange={(checked) =>
                      setField('shareContactDetails', checked)
                    }
                  />
                </div>
              </CardContent>
            </Card>

            {validationError && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pb-6">
              {profile ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-destructive"
                      disabled={remove.isPending}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete professional profile
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete your professional profile?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Your professional identity and its contact-sharing choices will
                        be removed. This will not change your account, agency
                        membership, or driver-assistant permissions.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={deleteProfile}
                      >
                        Delete profile
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <span />
              )}

              <Button onClick={saveProfile} disabled={upsert.isPending}>
                {upsert.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save professional profile
              </Button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Field({
  label,
  htmlFor,
  required = false,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}
