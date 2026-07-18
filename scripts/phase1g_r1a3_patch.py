from pathlib import Path

CANDIDATE = Path("supabase/migration-candidates/20260717235300_phase1g_r1a1_recruiter_checkout_intents.sql")
TEST = Path("tests/postgres/recruiterCheckoutConcurrency.test.ts")


def replace_exact(text: str, old: str, new: str, expected: int, label: str) -> str:
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f"{label}: expected {expected} matches, found {count}")
    return text.replace(old, new)


sql = CANDIDATE.read_text()
sql = replace_exact(
    sql,
    "OR v_row.claim_token IS NULL\n     OR v_row.claim_token <> _claim_token",
    "OR v_row.claim_token IS NULL\n     OR _claim_token IS NULL\n     OR v_row.claim_token <> _claim_token",
    3,
    "claim-token null guards",
)
CANDIDATE.write_text(sql)

test = TEST.read_text()
test = replace_exact(
    test,
    'for (const role of ["PUBLIC", "anon", "authenticated"]) {',
    'for (const role of ["anon", "authenticated"]) {',
    2,
    "normal-role privilege loops",
)

table_anchor = '''    for (const role of ["anon", "authenticated"]) {
      const privileges = await pool.query(
'''
table_public_check = '''    const publicTableAcl = await pool.query(`
      SELECT NOT EXISTS (
        SELECT 1
          FROM pg_class c
          CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
         WHERE c.oid='public.recruiter_checkout_intents'::regclass
           AND acl.grantee=0
           AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
      ) AS denied
    `);
    expect(publicTableAcl.rows[0].denied).toBe(true);

    for (const role of ["anon", "authenticated"]) {
      const privileges = await pool.query(
'''
test = replace_exact(test, table_anchor, table_public_check, 1, "PUBLIC table ACL insertion")

function_anchor = '''    for (const signature of signatures) {
      for (const role of ["anon", "authenticated"]) {
'''
function_public_check = '''    const publicFunctionAcl = await pool.query(`
      SELECT count(*)::int AS n
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
       WHERE n.nspname='public'
         AND p.proname = ANY($1::text[])
         AND acl.grantee=0
         AND acl.privilege_type='EXECUTE'
    `, [[
      "claim_recruiter_checkout_intent",
      "bind_recruiter_checkout_customer",
      "complete_recruiter_checkout_intent",
      "fail_recruiter_checkout_intent",
    ]]);
    expect(publicFunctionAcl.rows[0].n).toBe(0);

    for (const signature of signatures) {
      for (const role of ["anon", "authenticated"]) {
'''
test = replace_exact(test, function_anchor, function_public_check, 1, "PUBLIC function ACL insertion")

auth_anchor = '''      await authClient.query("ROLLBACK");
    } finally {
      authClient.release();
    }
  });
'''
auth_rpc_check = '''      await authClient.query("ROLLBACK");
      await authClient.query("BEGIN");
      await authClient.query("SET LOCAL ROLE authenticated");
      await expectSqlState(
        authClient.query(
          `SELECT * FROM public.claim_recruiter_checkout_intent($1::uuid,$2::uuid,'growth'::text)`,
          [randomUUID(), randomUUID()],
        ),
        "42501",
      );
      await authClient.query("ROLLBACK");
    } finally {
      authClient.release();
    }
  });
'''
test = replace_exact(test, auth_anchor, auth_rpc_check, 1, "authenticated RPC denial insertion")

TEST.write_text(test)
print("Applied Phase 1G-R1A3 null-token and PUBLIC ACL corrections")
