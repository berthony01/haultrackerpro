import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * PHASE TG-2B — Telegram identity + linking foundation.
 *
 * Source-contract test over the reviewed candidate migration. The candidate is
 * NOT applied live in TG-2B, so this suite asserts the authored SQL contract
 * rather than live catalog state.
 *
 * Deliberately NOT asserted here: any `START..HEAD` git-history file-scope
 * allowlist. Diff scope is verified externally by the phase contract so that
 * future legitimate commits cannot break this test.
 */

const CANDIDATE_PATH = resolve(
  process.cwd(),
  'supabase/migration-candidates/20260819213000_phase_tg2b_telegram_identity_linking_foundation.sql',
);

const sql = readFileSync(CANDIDATE_PATH, 'utf8');

/** SQL with every `--` line comment stripped, for "must not contain" checks. */
const code = sql.replace(/--.*$/gm, '');

/** Extract the body of a `CREATE TABLE public.<name> ( ... );` statement. */
function tableBody(name: string): string {
  const match = code.match(
    new RegExp(`CREATE TABLE public\\.${name}\\s*\\(([\\s\\S]*?)\\n\\);`),
  );
  expect(match, `CREATE TABLE public.${name} not found`).toBeTruthy();
  return match![1];
}

/** Extract a `CREATE FUNCTION public.<name>(...) ... $$ ... $$;` statement. */
function functionSource(name: string): string {
  const match = code.match(
    new RegExp(`CREATE FUNCTION public\\.${name}\\s*\\([\\s\\S]*?\\n\\$\\$;`),
  );
  expect(match, `CREATE FUNCTION public.${name} not found`).toBeTruthy();
  return match![0];
}

const userLinks = tableBody('telegram_user_links');
const chatBindings = tableBody('telegram_chat_bindings');
const linkTokens = tableBody('telegram_link_tokens');

const issueFn = functionSource('issue_telegram_link_token');
const consumeFn = functionSource('consume_telegram_link_token');
const revokeFn = functionSource('revoke_my_telegram_link');

describe('TG-2B — candidate shape and transaction envelope', () => {
  it('is a single self-contained transaction', () => {
    expect(code.trimStart().startsWith('BEGIN;')).toBe(true);
    expect(code.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(code.match(/\bBEGIN;/g)).toHaveLength(1);
    expect(code.match(/\bCOMMIT;/g)).toHaveLength(1);
    expect(code).not.toMatch(/\bROLLBACK\b/i);
  });

  it('is explicitly marked as a non-applied candidate', () => {
    expect(sql).toMatch(/CANDIDATE MIGRATION — NOT APPLIED LIVE/);
  });

  it('creates exactly the three-table Telegram vocabulary', () => {
    const tables = [...code.matchAll(/CREATE TABLE public\.(\w+)/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual([
      'telegram_chat_bindings',
      'telegram_link_tokens',
      'telegram_user_links',
    ]);
  });

  it('creates exactly the three linking RPCs', () => {
    const fns = [...code.matchAll(/CREATE FUNCTION public\.(\w+)/g)].map((m) => m[1]);
    expect(fns.sort()).toEqual([
      'consume_telegram_link_token',
      'issue_telegram_link_token',
      'revoke_my_telegram_link',
    ]);
  });

  it('never uses CREATE OR REPLACE or DROP for authorization-bearing objects', () => {
    expect(code).not.toMatch(/CREATE OR REPLACE/i);
    expect(code).not.toMatch(/\bDROP\s+(TABLE|FUNCTION|POLICY|INDEX)\b/i);
  });
});

describe('TG-2B — A. telegram_user_links: global identity binding', () => {
  it('declares exactly the required columns', () => {
    expect(userLinks).toMatch(/id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
    expect(userLinks).toMatch(/telegram_user_id bigint NOT NULL/);
    expect(userLinks).toMatch(
      /user_id uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/,
    );
    expect(userLinks).toMatch(/status text NOT NULL DEFAULT 'active'/);
    expect(userLinks).toMatch(/linked_at timestamptz NOT NULL DEFAULT now\(\)/);
    expect(userLinks).toMatch(/revoked_at timestamptz NULL/);
  });

  it('constrains the telegram id, status vocabulary, and revoked shape', () => {
    expect(userLinks).toMatch(/CHECK \(telegram_user_id > 0\)/);
    expect(userLinks).toMatch(/CHECK \(status = ANY \(ARRAY\['active','revoked'\]\)\)/);
    expect(userLinks).toMatch(/status = 'active'\s+AND revoked_at IS NULL/);
    expect(userLinks).toMatch(/status = 'revoked' AND revoked_at IS NOT NULL/);
  });

  it('enforces one-to-one ACTIVE identity in BOTH directions via partial unique indexes', () => {
    expect(code).toMatch(
      /CREATE UNIQUE INDEX telegram_user_links_active_telegram_user_id_unique\s*\n\s*ON public\.telegram_user_links \(telegram_user_id\)\s*\n\s*WHERE status = 'active';/,
    );
    expect(code).toMatch(
      /CREATE UNIQUE INDEX telegram_user_links_active_user_id_unique\s*\n\s*ON public\.telegram_user_links \(user_id\)\s*\n\s*WHERE status = 'active';/,
    );
  });

  it('carries NO recruiter workspace column — identity is global, not per workspace', () => {
    expect(userLinks).not.toMatch(/recruiter_id/);
    expect(userLinks).not.toMatch(/agency_id/);
    expect(userLinks).not.toMatch(/permission/i);
  });

  it('stores no Telegram username or profile PII', () => {
    expect(userLinks).not.toMatch(/username/i);
    expect(userLinks).not.toMatch(/first_name|last_name|phone/i);
    expect(userLinks).not.toMatch(/chat_id/);
    expect(userLinks).not.toMatch(/jsonb/i);
  });
});

describe('TG-2B — B. telegram_chat_bindings: chat -> recruiter workspace', () => {
  it('declares exactly the required columns', () => {
    expect(chatBindings).toMatch(/id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
    expect(chatBindings).toMatch(/telegram_chat_id bigint NOT NULL/);
    expect(chatBindings).toMatch(
      /recruiter_id uuid NOT NULL REFERENCES public\.recruiter_profiles\(id\) ON DELETE CASCADE/,
    );
    expect(chatBindings).toMatch(/chat_type text NOT NULL/);
    expect(chatBindings).toMatch(
      /bound_by_user_id uuid NULL REFERENCES auth\.users\(id\) ON DELETE SET NULL/,
    );
    expect(chatBindings).toMatch(/status text NOT NULL DEFAULT 'active'/);
    expect(chatBindings).toMatch(/bound_at timestamptz NOT NULL DEFAULT now\(\)/);
    expect(chatBindings).toMatch(/revoked_at timestamptz NULL/);
  });

  it('restricts chat_type to group/supergroup and rejects chat id 0', () => {
    expect(chatBindings).toMatch(/CHECK \(telegram_chat_id <> 0\)/);
    expect(chatBindings).toMatch(
      /CHECK \(chat_type = ANY \(ARRAY\['group','supergroup'\]\)\)/,
    );
    expect(chatBindings).not.toMatch(/'private'|'channel'/);
  });

  it('applies the same active/revoked timestamp shape rule', () => {
    expect(chatBindings).toMatch(/CHECK \(status = ANY \(ARRAY\['active','revoked'\]\)\)/);
    expect(chatBindings).toMatch(/status = 'active'\s+AND revoked_at IS NULL/);
    expect(chatBindings).toMatch(/status = 'revoked' AND revoked_at IS NOT NULL/);
  });

  it('uniquely binds an ACTIVE chat to one workspace', () => {
    expect(code).toMatch(
      /CREATE UNIQUE INDEX telegram_chat_bindings_active_chat_id_unique\s*\n\s*ON public\.telegram_chat_bindings \(telegram_chat_id\)\s*\n\s*WHERE status = 'active';/,
    );
  });

  it('does NOT constrain a recruiter to a single chat', () => {
    const bindingIndexes = [
      ...code.matchAll(/CREATE UNIQUE INDEX \w+\s*\n\s*ON public\.telegram_chat_bindings \(([^)]*)\)/g),
    ].map((m) => m[1]);
    expect(bindingIndexes).toEqual(['telegram_chat_id']);
    expect(chatBindings).not.toMatch(/UNIQUE/);
  });

  it('does not treat chat username/title as identity', () => {
    expect(chatBindings).not.toMatch(/username|title/i);
  });

  it('is schema-only: TG-2B ships no bind/unbind RPC', () => {
    expect(code).not.toMatch(/CREATE FUNCTION public\.\w*bind\w*/i);
    expect(code).not.toMatch(/INSERT INTO public\.telegram_chat_bindings/);
    expect(code).not.toMatch(/UPDATE public\.telegram_chat_bindings/);
  });
});

describe('TG-2B — C. telegram_link_tokens: hashes only', () => {
  it('declares exactly the required columns', () => {
    expect(linkTokens).toMatch(/id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
    expect(linkTokens).toMatch(
      /user_id uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/,
    );
    expect(linkTokens).toMatch(/token_hash text NOT NULL UNIQUE/);
    expect(linkTokens).toMatch(/created_at timestamptz NOT NULL DEFAULT now\(\)/);
    expect(linkTokens).toMatch(/expires_at timestamptz NOT NULL/);
    expect(linkTokens).toMatch(/consumed_at timestamptz NULL/);
    expect(linkTokens).toMatch(/invalidated_at timestamptz NULL/);
  });

  it('has NO raw token column anywhere in the candidate', () => {
    expect(linkTokens).not.toMatch(/\braw_token\b/);
    expect(linkTokens).not.toMatch(/\btoken text\b/);
    expect(linkTokens).not.toMatch(/plaintext|secret/i);
    // The only persisted token representation is the hash column.
    const tokenColumns = [...linkTokens.matchAll(/^\s{2}(\w*token\w*)\s/gm)].map((m) => m[1]);
    expect(tokenColumns).toEqual(['token_hash']);
  });

  it('requires exactly 64 lowercase hex characters for the stored digest', () => {
    expect(linkTokens).toMatch(/CHECK \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  });

  it('enforces the full token lifecycle shape', () => {
    expect(linkTokens).toMatch(/CHECK \(expires_at > created_at\)/);
    expect(linkTokens).toMatch(/CHECK \(consumed_at IS NULL OR consumed_at >= created_at\)/);
    expect(linkTokens).toMatch(
      /CHECK \(invalidated_at IS NULL OR invalidated_at >= created_at\)/,
    );
    expect(linkTokens).toMatch(
      /CHECK \(NOT \(consumed_at IS NOT NULL AND invalidated_at IS NOT NULL\)\)/,
    );
  });

  it('indexes the lifecycle lookup path', () => {
    expect(code).toMatch(
      /CREATE INDEX telegram_link_tokens_user_expiry_idx\s*\n\s*ON public\.telegram_link_tokens \(user_id, expires_at DESC\);/,
    );
  });

  it('carries no recruiter or Telegram identifier', () => {
    expect(linkTokens).not.toMatch(/recruiter_id/);
    expect(linkTokens).not.toMatch(/telegram_user_id|telegram_chat_id/);
  });
});

describe('TG-2B — D. RLS and direct privileges', () => {
  it('enables RLS on all three tables', () => {
    for (const t of [
      'telegram_user_links',
      'telegram_chat_bindings',
      'telegram_link_tokens',
    ]) {
      expect(code).toMatch(
        new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY;`),
      );
    }
  });

  it('grants only own-row SELECT to authenticated on telegram_user_links', () => {
    expect(code).toMatch(/REVOKE ALL ON TABLE public\.telegram_user_links FROM PUBLIC;/);
    expect(code).toMatch(/REVOKE ALL ON TABLE public\.telegram_user_links FROM anon;/);
    expect(code).toMatch(
      /REVOKE ALL ON TABLE public\.telegram_user_links FROM authenticated;/,
    );
    expect(code).toMatch(
      /GRANT SELECT ON TABLE public\.telegram_user_links TO authenticated;/,
    );
    expect(code).toMatch(/GRANT ALL ON TABLE public\.telegram_user_links TO service_role;/);
    expect(code).not.toMatch(
      /GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*public\.telegram_user_links TO authenticated;/,
    );
  });

  it('declares exactly one client policy in the whole candidate, scoped to auth.uid()', () => {
    const policies = [...code.matchAll(/CREATE POLICY "([^"]+)"\s*\n\s*ON public\.(\w+) FOR (\w+)/g)];
    expect(policies).toHaveLength(1);
    expect(policies[0][2]).toBe('telegram_user_links');
    expect(policies[0][3]).toBe('SELECT');
    expect(code).toMatch(/TO authenticated\s*\n\s*USING \(auth\.uid\(\) = user_id\);/);
  });

  it('has zero client write policies on telegram_user_links', () => {
    expect(code).not.toMatch(/ON public\.telegram_user_links FOR (INSERT|UPDATE|DELETE|ALL)/);
    expect(code).not.toMatch(/WITH CHECK/);
  });

  it('gives bindings and tokens zero client policies and zero client privileges', () => {
    for (const t of ['telegram_chat_bindings', 'telegram_link_tokens']) {
      expect(code).not.toMatch(new RegExp(`ON public\\.${t} FOR`));
      expect(code).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${t} FROM PUBLIC;`));
      expect(code).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${t} FROM anon;`));
      expect(code).toMatch(
        new RegExp(`REVOKE ALL ON TABLE public\\.${t} FROM authenticated;`),
      );
      expect(code).toMatch(new RegExp(`GRANT ALL ON TABLE public\\.${t} TO service_role;`));
      expect(code).not.toMatch(new RegExp(`GRANT [^;]*public\\.${t} TO (anon|authenticated);`));
    }
  });
});

describe('TG-2B — E. issue_telegram_link_token', () => {
  it('is a hardened SECURITY DEFINER plpgsql function', () => {
    expect(issueFn).toMatch(/RETURNS text/);
    expect(issueFn).toMatch(/LANGUAGE plpgsql/);
    expect(issueFn).toMatch(/SECURITY DEFINER/);
    expect(issueFn).toMatch(
      /SET search_path TO 'pg_catalog', 'public', 'auth', 'extensions'/,
    );
  });

  it('derives the actor from auth.uid() and rejects anonymous callers', () => {
    expect(issueFn).toMatch(/_uid uuid := auth\.uid\(\)/);
    expect(issueFn).toMatch(
      /IF _uid IS NULL THEN\s*\n\s*RAISE EXCEPTION 'telegram_not_authenticated';/,
    );
  });

  it('refuses to issue a token for an already-linked account', () => {
    expect(issueFn).toMatch(/l\.user_id = _uid\s*\n\s*AND l\.status = 'active'/);
    expect(issueFn).toMatch(/RAISE EXCEPTION 'telegram_already_linked';/);
  });

  it('invalidates all prior live tokens before issuing a new one', () => {
    expect(issueFn).toMatch(
      /UPDATE public\.telegram_link_tokens t\s*\n\s*SET invalidated_at = now\(\)\s*\n\s*WHERE t\.user_id = _uid\s*\n\s*AND t\.consumed_at IS NULL\s*\n\s*AND t\.invalidated_at IS NULL;/,
    );
    const invalidateIdx = issueFn.indexOf('SET invalidated_at = now()');
    const insertIdx = issueFn.indexOf('INSERT INTO public.telegram_link_tokens');
    expect(invalidateIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(invalidateIdx);
  });

  it('generates 32 crypto-random bytes as lowercase hex and stores only the SHA-256 digest', () => {
    expect(issueFn).toMatch(
      /_raw_token := encode\(extensions\.gen_random_bytes\(32\), 'hex'\);/,
    );
    expect(issueFn).toMatch(
      /_token_hash := encode\(extensions\.digest\(_raw_token, 'sha256'\), 'hex'\);/,
    );
    // The raw challenge is returned, never persisted.
    expect(issueFn).toMatch(/user_id, token_hash, expires_at/);
    expect(issueFn).toMatch(/_uid, _token_hash, now\(\) \+ interval '15 minutes'/);
    expect(issueFn).not.toMatch(/INSERT[\s\S]*_raw_token/);
    expect(issueFn).toMatch(/RETURN _raw_token;/);
  });

  it('expires in exactly 15 minutes', () => {
    expect(issueFn).toMatch(/now\(\) \+ interval '15 minutes'/);
    expect(issueFn).not.toMatch(/interval '(?!15 minutes)[^']*'/);
  });

  it('is executable by authenticated clients only', () => {
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.issue_telegram_link_token\(\) FROM PUBLIC;/,
    );
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.issue_telegram_link_token\(\) FROM anon;/,
    );
    expect(code).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.issue_telegram_link_token\(\) TO authenticated;/,
    );
  });
});

describe('TG-2B — F. consume_telegram_link_token', () => {
  it('is a hardened SECURITY DEFINER plpgsql function returning the link row', () => {
    expect(consumeFn).toMatch(/_raw_token text,\s*\n\s*_telegram_user_id bigint/);
    expect(consumeFn).toMatch(/RETURNS public\.telegram_user_links/);
    expect(consumeFn).toMatch(/LANGUAGE plpgsql/);
    expect(consumeFn).toMatch(/SECURITY DEFINER/);
    expect(consumeFn).toMatch(
      /SET search_path TO 'pg_catalog', 'public', 'auth', 'extensions'/,
    );
  });

  it('validates raw token shape and positive Telegram id, failing with one opaque error', () => {
    expect(consumeFn).toMatch(/_raw_token IS NULL/);
    expect(consumeFn).toMatch(/_telegram_user_id IS NULL/);
    expect(consumeFn).toMatch(/_telegram_user_id <= 0/);
    expect(consumeFn).toMatch(/_raw_token !~ '\^\[0-9a-f\]\{64\}\$'/);
    expect(consumeFn).toMatch(/RAISE EXCEPTION 'telegram_link_token_invalid';/);
  });

  it('looks the token up by digest under a row lock with full liveness checks', () => {
    expect(consumeFn).toMatch(
      /_token_hash := encode\(extensions\.digest\(_raw_token, 'sha256'\), 'hex'\);/,
    );
    expect(consumeFn).toMatch(/WHERE t\.token_hash = _token_hash/);
    expect(consumeFn).toMatch(/AND t\.consumed_at IS NULL/);
    expect(consumeFn).toMatch(/AND t\.invalidated_at IS NULL/);
    expect(consumeFn).toMatch(/AND t\.expires_at > now\(\)/);
    expect(consumeFn).toMatch(/FOR UPDATE;/);
    expect(consumeFn).toMatch(
      /IF NOT FOUND THEN\s*\n\s*RAISE EXCEPTION 'telegram_link_token_invalid';/,
    );
  });

  it('never matches a token by raw value', () => {
    expect(consumeFn).not.toMatch(/token_hash = _raw_token/);
    expect(consumeFn).not.toMatch(/raw_token =/);
  });

  it('fails closed on BOTH directions of the active-link conflict', () => {
    expect(consumeFn).toMatch(
      /l\.telegram_user_id = _telegram_user_id\s*\n\s*AND l\.status = 'active'/,
    );
    expect(consumeFn).toMatch(/RAISE EXCEPTION 'telegram_user_already_linked';/);
    expect(consumeFn).toMatch(/l\.user_id = _token\.user_id\s*\n\s*AND l\.status = 'active'/);
    expect(consumeFn).toMatch(/RAISE EXCEPTION 'telegram_account_already_linked';/);
  });

  it('inserts exactly one ACTIVE link and only then burns the token', () => {
    expect(consumeFn).toMatch(/INSERT INTO public\.telegram_user_links/);
    expect(consumeFn).toMatch(/_telegram_user_id, _token\.user_id, 'active', now\(\), NULL/);
    const insertIdx = consumeFn.indexOf('INSERT INTO public.telegram_user_links');
    const consumeIdx = consumeFn.indexOf('SET consumed_at = now()');
    expect(insertIdx).toBeGreaterThan(-1);
    expect(consumeIdx).toBeGreaterThan(insertIdx);
    expect(consumeFn).toMatch(/WHERE t\.id = _token\.id;/);
    expect(consumeFn).toMatch(/RETURN _row;/);
  });

  it('translates a unique-index race into telegram_link_conflict without picking a winner', () => {
    expect(consumeFn).toMatch(
      /EXCEPTION\s*\n\s*WHEN unique_violation THEN[\s\S]*RAISE EXCEPTION 'telegram_link_conflict';/,
    );
    expect(consumeFn).not.toMatch(/ON CONFLICT/);
  });

  it('is executable by service_role ONLY — never by an end user', () => {
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.consume_telegram_link_token\(text, bigint\) FROM PUBLIC;/,
    );
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.consume_telegram_link_token\(text, bigint\) FROM anon;/,
    );
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.consume_telegram_link_token\(text, bigint\) FROM authenticated;/,
    );
    expect(code).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.consume_telegram_link_token\(text, bigint\) TO service_role;/,
    );
    expect(code).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.consume_telegram_link_token\(text, bigint\) TO authenticated;/,
    );
  });
});

describe('TG-2B — G. revoke_my_telegram_link', () => {
  it('is a hardened SECURITY DEFINER plpgsql boolean function without the extensions schema', () => {
    expect(revokeFn).toMatch(/RETURNS boolean/);
    expect(revokeFn).toMatch(/LANGUAGE plpgsql/);
    expect(revokeFn).toMatch(/SECURITY DEFINER/);
    expect(revokeFn).toMatch(/SET search_path TO 'pg_catalog', 'public', 'auth'\n/);
    expect(revokeFn).not.toMatch(/'extensions'/);
  });

  it('requires an authenticated caller', () => {
    expect(revokeFn).toMatch(/_uid uuid := auth\.uid\(\)/);
    expect(revokeFn).toMatch(
      /IF _uid IS NULL THEN\s*\n\s*RAISE EXCEPTION 'telegram_not_authenticated';/,
    );
  });

  it('revokes ONLY the caller\'s own active link — no target parameter exists', () => {
    expect(revokeFn).toMatch(/CREATE FUNCTION public\.revoke_my_telegram_link\(\)/);
    expect(revokeFn).toMatch(
      /UPDATE public\.telegram_user_links l\s*\n\s*SET status = 'revoked',\s*\n\s*revoked_at = now\(\)\s*\n\s*WHERE l\.user_id = _uid\s*\n\s*AND l\.status = 'active'/,
    );
  });

  it('invalidates outstanding tokens and returns a boolean outcome', () => {
    expect(revokeFn).toMatch(
      /UPDATE public\.telegram_link_tokens t\s*\n\s*SET invalidated_at = now\(\)\s*\n\s*WHERE t\.user_id = _uid\s*\n\s*AND t\.consumed_at IS NULL\s*\n\s*AND t\.invalidated_at IS NULL;/,
    );
    expect(revokeFn).toMatch(/RETURN _revoked_count > 0;/);
  });

  it('is executable by authenticated clients only', () => {
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.revoke_my_telegram_link\(\) FROM PUBLIC;/,
    );
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.revoke_my_telegram_link\(\) FROM anon;/,
    );
    expect(code).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.revoke_my_telegram_link\(\) TO authenticated;/,
    );
  });
});

describe('TG-2B — I. scope containment', () => {
  it('stores no Telegram username, bot token, or webhook secret anywhere', () => {
    expect(code).not.toMatch(/username/i);
    expect(code).not.toMatch(/bot_token|bot_secret|webhook_secret|api_key/i);
  });

  it('contains no Edge Function, webhook, or HTTP surface SQL', () => {
    expect(code).not.toMatch(/webhook/i);
    expect(code).not.toMatch(/\bhttp\b/i);
    expect(code).not.toMatch(/pg_net|supabase_functions/i);
    expect(code).not.toMatch(/CREATE TRIGGER/i);
  });

  it('does not create or alter any TG-1 load object', () => {
    expect(code).not.toMatch(/CREATE TABLE public\.loads\b/);
    expect(code).not.toMatch(/ALTER TABLE public\.(loads|load_events|dispatch_command_receipts)\b/);
    expect(code).not.toMatch(/INSERT INTO public\.(loads|load_events|dispatch_command_receipts)\b/);
    expect(code).not.toMatch(/UPDATE public\.(loads|load_events|dispatch_command_receipts)\b/);
  });

  it('does not redefine or re-grant any TG-1 function or permission resolver', () => {
    for (const fn of [
      'dispatch_create_driver_load',
      'dispatch_update_driver_load_status',
      'current_user_can_dispatch_load_action',
      'current_user_has_recruiter_permission',
      'canonical_load_operating_miles',
      'get_carrier_driver_mileage_summary',
    ]) {
      expect(code).not.toMatch(new RegExp(`(CREATE|GRANT|REVOKE)[^;]*${fn}`));
    }
    expect(code).not.toMatch(/ALTER TYPE public\.recruiter_workspace_permission/);
  });

  it('adds no enum type and no cross-schema DDL', () => {
    expect(code).not.toMatch(/CREATE TYPE/i);
    expect(code).not.toMatch(/CREATE SCHEMA|ALTER SCHEMA/i);
    expect(code).not.toMatch(/ALTER TABLE (auth|storage|realtime|vault)\./i);
  });

  it('performs no data backfill outside the function bodies', () => {
    const topLevel = code.split(/\$\$/).filter((_, i) => i % 2 === 0).join('\n');
    expect(topLevel).not.toMatch(/^\s*(INSERT|UPDATE|DELETE)\s/im);
  });
});
