// Shared helper: parse INTERNAL_TEST_EMAILS env var into a normalized Set.
// Comma-separated, lowercased, trimmed. Returns an empty Set when unset so
// production behavior is "no test accounts suppressed" by default.
export function getInternalTestEmails(): Set<string> {
  const raw = Deno.env.get("INTERNAL_TEST_EMAILS") ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}
