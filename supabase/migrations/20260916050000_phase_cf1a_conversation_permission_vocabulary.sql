-- CANDIDATE MIGRATION — NOT APPLIED LIVE.
-- Phase CF-1A (A) — Conversation permission vocabulary ONLY.
--
-- This migration appends exactly two values to the existing
-- public.recruiter_workspace_permission enum and does nothing else.
--
-- It MUST remain separate from the CF-1A schema migration: a newly added enum
-- value cannot be consumed by the same transaction that adds it.
-- For that reason this file intentionally contains NO explicit transaction
-- block (no BEGIN; / COMMIT;) — each ALTER TYPE runs and commits on its own.
--
-- This migration MUST NOT:
--   * create, alter or drop any table, column, policy, trigger or index,
--   * create or replace any function,
--   * change any grant,
--   * touch opportunities / applications / contracts / settlements /
--     agencies / Telegram / Stripe / billing objects.

ALTER TYPE public.recruiter_workspace_permission
  ADD VALUE IF NOT EXISTS 'conversations_view';

ALTER TYPE public.recruiter_workspace_permission
  ADD VALUE IF NOT EXISTS 'conversations_reply';
