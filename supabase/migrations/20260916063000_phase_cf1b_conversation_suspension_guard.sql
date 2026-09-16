-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase CF-1B-R1 — Conversation recruiter-availability (suspension) guard.
--
-- Scope: CREATE OR REPLACE public.current_user_can_conversation_action(uuid, text)
-- ONLY. No table, policy, enum, trigger, data, or unrelated function is touched.
--
-- Correction: recruiter-side authority previously resolved solely through
-- public.current_user_has_recruiter_permission, which treats the workspace owner
-- as implicitly permitted even when the recruiter profile is later suspended or
-- otherwise ineligible. The UI hides suspended recruiters, but direct RPC calls
-- could still view/mutate conversations. Authorization now fails closed on the
-- server using the existing canonical helper
-- public.recruiter_profile_can_manage_opportunities(_recruiter_id).
--
-- Preserved exactly: admin is VIEW/MODERATION ONLY (no blanket mutation bypass),
-- participant rows remain non-authoritative, actor identity is never supplied by
-- the client, conversations_view / conversations_reply semantics are unchanged
-- behind the new availability gate, and driver view/close remain available so a
-- driver never loses access to their own history after recruiter suspension.

BEGIN;

CREATE OR REPLACE FUNCTION public.current_user_can_conversation_action(
  _thread_id uuid,
  _action text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _t public.conversation_threads%ROWTYPE;
  _recruiter_available boolean;
BEGIN
  IF _uid IS NULL OR _thread_id IS NULL OR _action IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO _t FROM public.conversation_threads WHERE id = _thread_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Canonical recruiter availability. Suspended / ineligible recruiter profiles
  -- lose every recruiter-side authority and can no longer be replied to.
  _recruiter_available := COALESCE(
    public.recruiter_profile_can_manage_opportunities(_t.recruiter_id), false);

  -- Admin shortcut is READ/MODERATION ONLY. Admin status alone never
  -- authorizes reply/accept/decline/close; those fall through to the
  -- normal driver / recruiter authority checks below.
  IF _action = 'view' AND public.is_admin(_uid) THEN
    RETURN true;
  END IF;

  -- Driver side: strictly the thread's own driver.
  IF _t.driver_user_id = _uid THEN
    IF _action = 'view' THEN
      -- History stays readable even after recruiter suspension.
      RETURN true;
    ELSIF _action = 'reply' THEN
      RETURN _t.status IN ('requested','active')
         AND _recruiter_available
         AND NOT public.user_has_blocking_messaging_restriction(_uid);
    ELSIF _action = 'close' THEN
      RETURN _t.status IN ('requested','active');
    END IF;
    RETURN false;
  END IF;

  -- Recruiter side: availability gate BEFORE any permission resolution.
  IF NOT _recruiter_available THEN
    RETURN false;
  END IF;

  -- Live workspace permission resolution, owner implicit.
  IF NOT public.current_user_has_recruiter_permission(
       _t.recruiter_id, 'conversations_view'::public.recruiter_workspace_permission) THEN
    RETURN false;
  END IF;

  IF _action = 'view' THEN
    RETURN true;
  END IF;

  IF NOT public.current_user_has_recruiter_permission(
       _t.recruiter_id, 'conversations_reply'::public.recruiter_workspace_permission) THEN
    RETURN false;
  END IF;

  IF _action = 'reply' THEN
    RETURN _t.status = 'active'
       AND NOT public.user_has_blocking_messaging_restriction(_uid);
  ELSIF _action IN ('accept','decline','close') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;

-- Execution privileges restated exactly as CF-1A requires.
REVOKE ALL ON FUNCTION public.current_user_can_conversation_action(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_can_conversation_action(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_conversation_action(uuid, text) TO authenticated;

COMMIT;
