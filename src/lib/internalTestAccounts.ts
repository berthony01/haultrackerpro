/**
 * Internal test account email list used to suppress lifecycle emails for
 * staff/test users. Values come from the build-time env var
 * `VITE_INTERNAL_TEST_EMAILS` (comma-separated). Defaults to an empty list so
 * no personal emails are baked into the client bundle.
 */
const raw = (import.meta.env.VITE_INTERNAL_TEST_EMAILS as string | undefined) ?? '';

export const INTERNAL_TEST_ACCOUNTS: string[] = raw
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isInternalTestEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return INTERNAL_TEST_ACCOUNTS.includes(email.toLowerCase().trim());
}
