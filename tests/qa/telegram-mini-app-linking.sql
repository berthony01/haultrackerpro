-- Run only against the separate hosted Assistant QA database.
-- Synthetic users, tokens and links are all rolled back. Tokens are never output.
BEGIN;
SET LOCAL statement_timeout = '15s';
-- This QA clone has older broad grants. Mirror the verified production ACLs
-- inside this transaction only; ROLLBACK restores the QA catalog.
REVOKE ALL ON FUNCTION public.consume_telegram_link_token(text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_telegram_link_token(text,bigint) TO service_role;
REVOKE ALL ON FUNCTION public.issue_telegram_link_token() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_telegram_link_token() TO authenticated;
REVOKE ALL ON FUNCTION public.revoke_my_telegram_link() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.revoke_my_telegram_link() TO authenticated;
DO $qa$
DECLARE
  a uuid := '10000000-0000-4000-8000-000000000010';
  b uuid := '10000000-0000-4000-8000-000000000011';
  tg bigint := 9000000000010;
  token_a text;
  token_b text;
  linked public.telegram_user_links%ROWTYPE;
  denied boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (a,b)) OR
     EXISTS (SELECT 1 FROM public.telegram_user_links WHERE telegram_user_id = tg) THEN
    RAISE EXCEPTION 'Synthetic QA identity collision';
  END IF;
  INSERT INTO auth.users (id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
  VALUES (a,'authenticated','authenticated','miniapp-qa-a@example.invalid',now(),now(),now(),'{}','{}'),
         (b,'authenticated','authenticated','miniapp-qa-b@example.invalid',now(),now(),now(),'{}','{}');

  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  SET LOCAL ROLE authenticated;
  token_a := public.issue_telegram_link_token();
  IF token_a !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid canonical token shape'; END IF;

  -- Browser users must not be able to consume identity challenges.
  denied := false;
  BEGIN
    PERFORM public.consume_telegram_link_token(token_a,tg);
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Authenticated user could consume a token'; END IF;

  SET LOCAL ROLE service_role;
  linked := public.consume_telegram_link_token(token_a,tg);
  IF linked.user_id <> a OR linked.telegram_user_id <> tg OR linked.status <> 'active' THEN
    RAISE EXCEPTION 'Canonical consumer returned the wrong identity';
  END IF;
  denied := false;
  BEGIN
    PERFORM public.consume_telegram_link_token(token_a,tg);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'telegram_link_token_invalid' THEN RAISE; END IF;
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Consumed token replay was accepted'; END IF;

  PERFORM set_config('request.jwt.claim.sub',b::text,true);
  SET LOCAL ROLE authenticated;
  token_b := public.issue_telegram_link_token();
  SET LOCAL ROLE service_role;
  denied := false;
  BEGIN
    PERFORM public.consume_telegram_link_token(token_b,tg);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'telegram_user_already_linked' THEN RAISE; END IF;
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Conflicting account was linked'; END IF;

  -- The first account can revoke only its own link.
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  SET LOCAL ROLE authenticated;
  IF NOT public.revoke_my_telegram_link() THEN RAISE EXCEPTION 'Own link was not revoked'; END IF;
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.telegram_user_links WHERE telegram_user_id=tg AND status='active') THEN
    RAISE EXCEPTION 'Revoked link remains active';
  END IF;
  PERFORM set_config('htp.miniapp_qa_result','PASS: canonical issue, service-only consume, same identity, replay denial, conflict denial, own revocation',true);
END
$qa$;
ROLLBACK;
SELECT 'PASS: canonical issue, service-only consume, same identity, replay denial, conflict denial, own revocation' AS result,
  (SELECT count(*) FROM auth.users WHERE id IN ('10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000011')) AS remaining_synthetic_users,
  (SELECT count(*) FROM public.telegram_user_links WHERE telegram_user_id=9000000000010) AS remaining_synthetic_links;

