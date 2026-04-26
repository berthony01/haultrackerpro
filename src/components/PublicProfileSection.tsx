import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UserCircle2, Check, X, Loader2 } from 'lucide-react';
import {
  useDriverProfile,
  useUpdateDriverProfile,
  checkHandleAvailable,
  HANDLE_EMOJIS,
} from '@/hooks/useDriverProfile';
import { useAuth } from '@/hooks/useAuth';

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

export function PublicProfileSection() {
  const { user } = useAuth();
  const { data: profile, isLoading } = useDriverProfile();
  const updateMut = useUpdateDriverProfile();

  const [handle, setHandle] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [availability, setAvailability] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle');
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!profile || initialized) return;
    setHandle(profile.driver_handle ?? '');
    setEmoji(profile.handle_emoji ?? null);
    setIsPublic(profile.handle_public);
    setInitialized(true);
  }, [profile, initialized]);

  // Debounced availability check
  useEffect(() => {
    const normalized = handle.trim().toLowerCase();
    if (!normalized) {
      setAvailability('idle');
      return;
    }
    if (!HANDLE_RE.test(normalized)) {
      setAvailability('invalid');
      return;
    }
    if (normalized === (profile?.driver_handle ?? '')) {
      setAvailability('ok');
      return;
    }
    setAvailability('checking');
    const t = setTimeout(async () => {
      const ok = await checkHandleAvailable(normalized, user?.id);
      setAvailability(ok ? 'ok' : 'taken');
    }, 400);
    return () => clearTimeout(t);
  }, [handle, profile?.driver_handle, user?.id]);

  const dirty =
    initialized &&
    (handle.trim().toLowerCase() !== (profile?.driver_handle ?? '') ||
      (emoji ?? null) !== (profile?.handle_emoji ?? null) ||
      isPublic !== !!profile?.handle_public);

  const canSave =
    dirty &&
    !updateMut.isPending &&
    (handle.trim() === '' ? !isPublic : availability === 'ok');

  const handleSave = () => {
    const normalized = handle.trim().toLowerCase();
    updateMut.mutate({
      driver_handle: normalized || null,
      handle_emoji: emoji,
      handle_public: normalized ? isPublic : false,
    });
  };

  if (isLoading) return null;

  return (
    <Card className="shadow-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-bold flex items-center gap-1.5">
            <UserCircle2 className="h-3.5 w-3.5" /> Public Profile
          </p>
          {profile?.handle_public && profile.driver_handle && (
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-primary border-primary/40">
              Live on leaderboard
            </Badge>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground -mt-1">
          Choose how you appear on the weekly leaderboard. Default is anonymous (Driver #XXXX).
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="driver-handle" className="text-xs font-bold">Handle</Label>
          <div className="relative">
            <Input
              id="driver-handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value.replace(/\s+/g, ''))}
              placeholder="roaddog_tx"
              maxLength={20}
              className="pr-9"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              {availability === 'checking' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              {availability === 'ok' && <Check className="h-4 w-4 text-success" />}
              {availability === 'taken' && <X className="h-4 w-4 text-destructive" />}
              {availability === 'invalid' && <X className="h-4 w-4 text-destructive" />}
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {availability === 'invalid' && '3–20 characters · letters, numbers, underscore only'}
            {availability === 'taken' && 'That handle is already taken'}
            {availability === 'ok' && handle.trim() !== (profile?.driver_handle ?? '') && 'Available'}
            {availability === 'idle' && 'Leave blank to stay anonymous'}
            {availability === 'checking' && 'Checking availability…'}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-bold">Emoji (optional)</Label>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setEmoji(null)}
              className={`h-8 w-8 rounded-lg border text-xs flex items-center justify-center ${
                emoji === null ? 'border-primary bg-primary/10' : 'border-border'
              }`}
              aria-label="No emoji"
            >
              —
            </button>
            {HANDLE_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                className={`h-8 w-8 rounded-lg border text-base flex items-center justify-center ${
                  emoji === e ? 'border-primary bg-primary/10' : 'border-border'
                }`}
                aria-label={`Emoji ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="min-w-0 pr-3">
            <p className="text-xs font-bold">Show on leaderboard</p>
            <p className="text-[11px] text-muted-foreground">
              {isPublic && handle.trim()
                ? `You'll appear as "${handle.trim().toLowerCase()}${emoji ? ' ' + emoji : ''}"`
                : 'You\'ll appear as Driver #XXXX'}
            </p>
          </div>
          <Switch
            checked={isPublic}
            disabled={!handle.trim() || availability === 'taken' || availability === 'invalid'}
            onCheckedChange={setIsPublic}
          />
        </div>

        <Button
          onClick={handleSave}
          disabled={!canSave}
          className="w-full h-10"
          size="sm"
        >
          {updateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save profile'}
        </Button>
      </CardContent>
    </Card>
  );
}
