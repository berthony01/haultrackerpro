-- SPRINT 1 CANDIDATE ONLY. NOT APPLIED. No tables, policies, data or receipts changed.
-- Service-only read: transport identity -> active link -> active bound workspace
-- -> exact workspace owner OR explicitly delegated member with canonical seats.
-- Mirrors canonical owner/member authorization using the linked actor directly;
-- no JWT subject mutation and no inference from a generic recruiter/admin role.
-- Pending (including expired invitations) and revoked memberships never qualify.
-- Active memberships have no expiry column; invite_expires_at is NOT a lifetime
-- for accepted membership. Telegram links/bindings similarly use revocation.
-- No text, identifiers, workspace names, counts or reasons leave this function.
-- NULL chat selects any authorized bound workspace for private navigation ONLY;
-- a group call MUST supply its actual transport chat id and matching chat type.
BEGIN;
CREATE FUNCTION public.telegram_get_dispatch_guidance(
  _telegram_user_id bigint,
  _telegram_chat_id bigint,
  _chat_type text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT _telegram_user_id IS NOT NULL AND _telegram_user_id > 0
    AND (
      (_chat_type = 'private' AND _telegram_chat_id IS NULL)
      OR (_chat_type IN ('group','supergroup') AND _telegram_chat_id < 0)
    )
    AND EXISTS (
      SELECT 1
      FROM public.telegram_user_links l
      JOIN public.telegram_chat_bindings b ON b.status = 'active'
      JOIN public.recruiter_profiles rp ON rp.id = b.recruiter_id
      WHERE l.telegram_user_id = _telegram_user_id
        AND l.status = 'active' AND l.revoked_at IS NULL
        AND rp.status = 'active'
        AND (
          rp.user_id = l.user_id
          OR (
            public.recruiter_team_workspace_within_limit(rp.id)
            AND EXISTS (
              SELECT 1 FROM public.recruiter_members m
              WHERE m.recruiter_id = rp.id AND m.member_user_id = l.user_id
                AND m.status = 'active' AND m.revoked_at IS NULL
                AND jsonb_typeof(m.permissions) = 'object'
                AND m.permissions -> 'loads_update_status' = 'true'::jsonb
            )
          )
        )
        AND b.status = 'active' AND b.revoked_at IS NULL
        AND b.chat_type IN ('group','supergroup')
        AND (_chat_type = 'private' OR
          (b.telegram_chat_id = _telegram_chat_id AND b.chat_type = _chat_type))
    );
$function$;
REVOKE ALL ON FUNCTION public.telegram_get_dispatch_guidance(bigint,bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_get_dispatch_guidance(bigint,bigint,text) TO service_role;
COMMIT;