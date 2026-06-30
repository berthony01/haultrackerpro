
-- Phase 7: agency_entitlements
create table if not exists public.agency_entitlements (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null unique references public.agency_profiles(id) on delete cascade,
  plan_key text not null default 'agency_starter'
    check (plan_key in ('assistant_free','agency_starter','agency_team','agency_growth')),
  status text not null default 'manual_beta'
    check (status in ('trialing','active','past_due','cancelled','manual_beta')),
  source text not null default 'manual'
    check (source in ('manual','stripe','admin_seed')),
  active_client_limit integer,
  member_limit integer,
  service_package_limit integer,
  current_period_end timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.agency_entitlements to authenticated;
grant all on public.agency_entitlements to service_role;

alter table public.agency_entitlements enable row level security;

-- Owners/admins of the agency may read their own entitlement row.
drop policy if exists "agency_entitlements_read_owner_admin" on public.agency_entitlements;
create policy "agency_entitlements_read_owner_admin"
on public.agency_entitlements
for select
to authenticated
using (
  exists (
    select 1
    from public.agency_members m
    where m.agency_id = agency_entitlements.agency_id
      and m.member_user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('agency_owner','agency_admin')
  )
);

-- Writes are restricted to service_role only (no client-side INSERT/UPDATE/DELETE).
-- No INSERT/UPDATE/DELETE policy is created on purpose.

-- updated_at trigger
create or replace function public.tg_agency_entitlements_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists agency_entitlements_set_updated_at on public.agency_entitlements;
create trigger agency_entitlements_set_updated_at
before update on public.agency_entitlements
for each row execute function public.tg_agency_entitlements_updated_at();

-- Helper: fetch entitlement for an agency (security definer so the caller
-- does not need direct table access). Returns NULL if the caller is not an
-- active owner/admin member of the agency.
create or replace function public.get_agency_entitlement(_agency_id uuid)
returns public.agency_entitlements
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result public.agency_entitlements;
  is_member boolean;
begin
  select exists (
    select 1
    from public.agency_members m
    where m.agency_id = _agency_id
      and m.member_user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('agency_owner','agency_admin')
  ) into is_member;

  if not is_member then
    return null;
  end if;

  select * into result from public.agency_entitlements where agency_id = _agency_id;
  return result;
end;
$$;

revoke all on function public.get_agency_entitlement(uuid) from public;
grant execute on function public.get_agency_entitlement(uuid) to authenticated;
