// Phase RB-3A-0B — trusted delegation boundary for the canonical
// `parse_opportunity` extractor served by the `ai-insight` Edge Function.
//
// ARCHITECTURAL RULING (RB-3A-0B):
//   * There is exactly ONE parse_opportunity implementation, ONE prompt, ONE
//     model and ONE output schema, and they live in ai-insight/index.ts. This
//     module contains NO prompt, NO schema, NO model id and never calls the
//     AI gateway. It only decides WHO is allowed to reach the extractor.
//   * The ordinary end-user path is untouched: Authorization user JWT ->
//     auth.getUser -> existing behaviour.
//   * The delegated path is available ONLY to a caller presenting the
//     project's own service-role credential, which is server-controlled and
//     never derived from a caller-supplied role string.
//   * A delegated actor is re-validated against the EXISTING recruiter
//     capability resolver (`telegram_resolve_recruiter_actor`, the only
//     resolver a trusted backend may call) BEFORE any model credit is spent.
//     No recruiter business rule is re-implemented here.
//   * Nothing in this module logs, returns or echoes a token or secret.

/** The only insight types a delegated (non end-user) caller may request. */
export const DELEGATION_ALLOWED_TYPES = ["parse_opportunity"] as const;

/** Request fields that attempt to select delegated mode or override the actor.
 *  Presence of ANY of these on a non-service caller fails closed. */
export const DELEGATION_CONTROL_FIELDS = [
  "delegated_actor_user_id",
  "actor_user_id",
  "delegated",
  "delegate",
  "delegated_mode",
  "service_actor_user_id",
  "on_behalf_of",
] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AiInsightCallerDecision =
  | { mode: "end_user" }
  | { mode: "delegated"; actorUserId: string; type: string }
  | { mode: "denied"; status: number; code: string; error: string };

/** Length-independent-ish comparison of two secrets. Never logs either side. */
export function secretsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || b.length === 0) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True only when the bearer token IS the project's own service-role
 *  credential, which only trusted server code can hold. */
export function isTrustedServiceCaller(
  token: string | null | undefined,
  serviceRoleKey: string | null | undefined,
): boolean {
  return secretsMatch(token, serviceRoleKey);
}

function readRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

export function hasDelegationControlField(body: unknown): boolean {
  const record = readRecord(body);
  return DELEGATION_CONTROL_FIELDS.some((f) => Object.prototype.hasOwnProperty.call(record, f));
}

/**
 * Decide which authentication path a request belongs to. Pure: no IO, no
 * logging, no model call. The caller performs the end-user JWT verification
 * (unchanged) or the delegated capability check, depending on the decision.
 */
export function classifyAiInsightRequest(input: {
  token: string | null | undefined;
  serviceRoleKey: string | null | undefined;
  body: unknown;
}): AiInsightCallerDecision {
  const { token, serviceRoleKey, body } = input;
  const record = readRecord(body);

  if (!isTrustedServiceCaller(token, serviceRoleKey)) {
    // Ordinary caller. It may never select delegated mode or name an actor.
    if (hasDelegationControlField(body)) {
      return {
        mode: "denied",
        status: 403,
        code: "delegation_not_permitted",
        error: "Forbidden",
      };
    }
    return { mode: "end_user" };
  }

  // Trusted server caller. Delegation is explicit, never implied.
  const actor = record["delegated_actor_user_id"];
  if (typeof actor !== "string" || !UUID_RE.test(actor)) {
    return {
      mode: "denied",
      status: 400,
      code: "invalid_delegated_actor",
      error: "delegated_actor_user_id is required",
    };
  }

  const type = record["type"];
  if (typeof type !== "string" || !(DELEGATION_ALLOWED_TYPES as readonly string[]).includes(type)) {
    return {
      mode: "denied",
      status: 403,
      code: "delegated_type_not_permitted",
      error: "Forbidden",
    };
  }

  return { mode: "delegated", actorUserId: actor, type };
}

/** Minimal structural view of the service-role Supabase client this module
 *  needs. Keeps the capability check unit-testable without a live database. */
export interface DelegationDbClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        eq(column: string, value: unknown): Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

export interface DelegatedRecruiterCapability {
  recruiterId: string;
}

/**
 * Re-validate a delegated actor using the EXISTING recruiter capability
 * resolver. Fails closed on: unlinked actor, ambiguous linkage, resolver
 * error, or no workspace where the actor may manage/create opportunities.
 *
 * This deliberately reuses `telegram_resolve_recruiter_actor`, the only
 * recruiter resolver a trusted backend may execute; recruiter membership,
 * permission and workspace rules stay owned by the database.
 */
export async function resolveDelegatedRecruiterCapability(
  client: DelegationDbClient,
  actorUserId: string,
): Promise<DelegatedRecruiterCapability | null> {
  if (!UUID_RE.test(actorUserId)) return null;

  const linkRes = await client
    .from("telegram_user_links")
    .select("telegram_user_id")
    .eq("user_id", actorUserId)
    .eq("status", "active");

  if (linkRes.error) return null;
  const links = Array.isArray(linkRes.data) ? (linkRes.data as Array<Record<string, unknown>>) : [];
  if (links.length !== 1) return null;

  const telegramUserId = links[0]?.["telegram_user_id"];
  if (typeof telegramUserId !== "number" && typeof telegramUserId !== "string") return null;

  const rpcRes = await client.rpc("telegram_resolve_recruiter_actor", {
    _telegram_user_id: telegramUserId,
  });
  if (rpcRes.error) return null;

  const rows = Array.isArray(rpcRes.data) ? (rpcRes.data as Array<Record<string, unknown>>) : [];
  const permitted = rows.find((r) => r?.["can_manage_opportunities"] === true);
  const recruiterId = permitted?.["recruiter_id"];
  if (typeof recruiterId !== "string" || !UUID_RE.test(recruiterId)) return null;

  return { recruiterId };
}
