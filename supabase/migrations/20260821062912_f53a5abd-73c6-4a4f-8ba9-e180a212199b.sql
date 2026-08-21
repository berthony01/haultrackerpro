-- Phase TG-2E3-O9 — QA synthetic-account outbound email suppression (CANDIDATE ONLY).
--
-- Single centralized guard at the one shared producer choke point:
-- public.enqueue_email(text, jsonb). Both current producers
-- (auth-email-hook -> auth_emails, send-transactional-email ->
-- transactional_emails) log a pending row first and then call this RPC with
-- payload.to and payload.message_id, so this is the only place a synthetic
-- QA account's outbound mail can be stopped without touching Edge code.
--
-- SCOPE LOCK — deliberately narrower than ancestry-based suppression:
--   * Suppress ONLY when the recipient address resolves to an auth user that
--     is ITSELF an ACTIVE O6 `user` fixture root.
--   * NEVER infer suppression from recruiter_profile / agency_profile root
--     ownership, child-record ancestry, email or name patterns, environment
--     allowlists, roles, plan/entitlement state, or super_admin status.
--   * A real owner who merely owns registered recruiter/agency QA roots keeps
--     completely normal outbound email.
--   * Any future synthetic account whose mail must be suppressed has to be
--     registered as its own `user` root.
--
-- The registry read is NOT authorization or billing truth; it is classification
-- only. Suppression stops the external send and nothing else: the QA action and
-- all other database state still occur so the flow remains testable.
--
-- Suppression-lookup failures are intentionally NOT caught. A database error
-- must fail the RPC rather than silently fall through and send a registered QA
-- user's email externally. Only the original undefined_table queue-bootstrap
-- recovery is handled, and only around the send itself.
--
-- Replaces exactly one function body. Creates no table, helper, policy,
-- trigger, or index and issues no GRANT/REVOKE. Signature, bigint return type,
-- plpgsql language, VOLATILE volatility, SECURITY DEFINER, search_path, owner
-- and ACL are all preserved.

CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name text, payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pgmq'
AS $function$
DECLARE
  _recipient text;
  _message_id text;
  _suppress boolean := false;
BEGIN
  -- 1. Recipient comes only from the payload envelope.
  _recipient := NULLIF(btrim(payload->>'to'), '');

  -- 2/3. Case-insensitive resolution against auth.users, then active `user`
  -- fixture-root truth. No ancestry, no owner inference.
  IF _recipient IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM auth.users u
      WHERE lower(u.email) = lower(_recipient)
        AND public.is_qa_fixture_root('user', u.id)
    )
    INTO _suppress;
  END IF;

  -- 4. Registered synthetic account: never touch the queue.
  IF _suppress THEN
    _message_id := NULLIF(btrim(payload->>'message_id'), '');

    IF _message_id IS NOT NULL THEN
      -- Status only, plus a minimal non-identifying marker. error_message is
      -- deliberately left untouched (it carries the anonymous IP marker) and
      -- no recipient, root, owner or payload data is recorded.
      UPDATE public.email_send_log
         SET status = 'suppressed',
             metadata = COALESCE(metadata, '{}'::jsonb)
                        || jsonb_build_object(
                             'suppression_reason', 'qa_fixture_user_root'
                           )
       WHERE message_id = _message_id
         AND status = 'pending';
    END IF;

    -- Callers check only for an RPC error, so NULL is a successful suppression.
    RETURN NULL::bigint;
  END IF;

  -- 5/6. Every other case keeps the original behavior byte-for-byte, including
  -- the undefined_table queue-bootstrap retry.
  BEGIN
    RETURN pgmq.send(queue_name, payload);
  EXCEPTION WHEN undefined_table THEN
    PERFORM pgmq.create(queue_name);
    RETURN pgmq.send(queue_name, payload);
  END;
END;
$function$;

COMMENT ON FUNCTION public.enqueue_email(text, jsonb) IS
  'Enqueues a rendered email onto a pgmq queue, creating the queue on first use. Outbound send is suppressed only when the payload recipient resolves to an auth user that is itself an active QA fixture user root; suppressed sends mark the matching pending email_send_log row as suppressed and return NULL.';