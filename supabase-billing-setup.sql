-- Odyssey Stripe billing schema. Review before running in the Supabase SQL Editor.
-- This file is additive and does not enable or deploy Stripe by itself.

-- Billing age is determined from a coach-maintained date of birth, never from
-- the athlete-editable age_group label.
alter table public.athlete_profiles
add column if not exists date_of_birth date;

-- Athletes may continue editing ordinary profile fields, but cannot set or alter
-- the date of birth used for billing authorization.
revoke insert, update on table public.athlete_profiles from authenticated;
grant insert (id, full_name, age_group, primary_event, goals)
on table public.athlete_profiles to authenticated;
grant update (full_name, age_group, primary_event, goals)
on table public.athlete_profiles to authenticated;

create table if not exists public.athlete_billing_authorizations (
  athlete_id uuid primary key references public.athlete_profiles(id) on delete cascade,
  athlete_display_name text not null,
  guardian_user_id uuid references auth.users(id) on delete restrict,
  guardian_configured boolean generated always as (guardian_user_id is not null) stored,
  minor_self_billing_approved boolean not null default false,
  manual_approval_note text,
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  billing_enabled boolean not null default false,
  billing_enabled_by uuid references auth.users(id) on delete restrict,
  billing_enabled_at timestamptz,
  billing_enabled_note text,
  updated_at timestamptz not null default now(),
  constraint manual_minor_approval_has_audit check (
    not minor_self_billing_approved or
    (approved_by is not null and approved_at is not null and char_length(trim(manual_approval_note)) >= 10)
  ),
  constraint billing_enablement_has_audit check (
    not billing_enabled or (billing_enabled_by is not null and billing_enabled_at is not null)
  )
);

alter table public.athlete_billing_authorizations enable row level security;

drop policy if exists "Billing parties read their authorization" on public.athlete_billing_authorizations;
create policy "Billing parties read their authorization"
on public.athlete_billing_authorizations
for select
to authenticated
using (
  (select auth.uid()) = athlete_id or
  (select auth.uid()) = guardian_user_id or
  (select public.is_coach())
);

revoke all on table public.athlete_billing_authorizations from anon;
revoke all on table public.athlete_billing_authorizations from authenticated;
grant select (
  athlete_id, athlete_display_name, guardian_configured,
  minor_self_billing_approved, approved_at, billing_enabled,
  billing_enabled_at, updated_at
) on table public.athlete_billing_authorizations to authenticated;

create schema if not exists odyssey_private;
revoke all on schema odyssey_private from public;
grant usage on schema odyssey_private to authenticated;

create or replace function odyssey_private.is_billing_guardian(target_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.athlete_billing_authorizations billing_auth
    where billing_auth.athlete_id = target_athlete_id
      and billing_auth.guardian_user_id = (select auth.uid())
  );
$$;
revoke all on function odyssey_private.is_billing_guardian(uuid) from public;
grant execute on function odyssey_private.is_billing_guardian(uuid) to authenticated;

create table if not exists public.billing_accounts (
  athlete_id uuid primary key references public.athlete_profiles(id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  billing_owner_user_id uuid not null references auth.users(id) on delete restrict,
  billing_identity_type text not null check (billing_identity_type in ('athlete', 'guardian')),
  subscription_status text check (subscription_status in (
    'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due',
    'canceled', 'unpaid', 'paused'
  )),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  scheduled_cancel_at timestamptz,
  stripe_event_created bigint not null default 0,
  stripe_snapshot_observed_at timestamptz not null default 'epoch',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Existing installations need this additive column because CREATE TABLE IF NOT
-- EXISTS does not update an already-created billing_accounts table.
alter table public.billing_accounts
add column if not exists stripe_snapshot_observed_at timestamptz not null default 'epoch';
alter table public.billing_accounts
add column if not exists scheduled_cancel_at timestamptz;

alter table public.billing_accounts enable row level security;

drop policy if exists "Athletes read own billing and coaches read all" on public.billing_accounts;
create policy "Athletes read own billing and coaches read all"
on public.billing_accounts
for select
to authenticated
using (
  (select auth.uid()) = athlete_id or
  (select odyssey_private.is_billing_guardian(billing_accounts.athlete_id)) or
  (select public.is_coach())
);

-- The browser can read only the rows allowed by RLS. All writes are reserved for
-- server-side Edge Functions using the project's secret key.
revoke all on table public.billing_accounts from anon;
revoke all on table public.billing_accounts from authenticated;
grant select (
  athlete_id, subscription_status, current_period_end, cancel_at_period_end,
  scheduled_cancel_at,
  created_at, updated_at
) on table public.billing_accounts to authenticated;

create index if not exists billing_accounts_customer_idx
on public.billing_accounts (stripe_customer_id);

create index if not exists billing_accounts_subscription_idx
on public.billing_accounts (stripe_subscription_id)
where stripe_subscription_id is not null;

create index if not exists billing_authorizations_guardian_idx
on public.athlete_billing_authorizations (guardian_user_id)
where guardian_user_id is not null;

create index if not exists billing_authorizations_approved_by_idx
on public.athlete_billing_authorizations (approved_by)
where approved_by is not null;

create index if not exists billing_authorizations_enabled_by_idx
on public.athlete_billing_authorizations (billing_enabled_by)
where billing_enabled_by is not null;

create index if not exists billing_accounts_owner_idx
on public.billing_accounts (billing_owner_user_id);

-- Apply a Stripe subscription snapshot in one database statement. Webhook handlers
-- retrieve Stripe's current subscription and timestamp that completed retrieval;
-- an older concurrent retrieval can therefore never overwrite a newer snapshot.
create or replace function public.apply_billing_subscription_snapshot(snapshot jsonb)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.billing_accounts (
    athlete_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
    billing_owner_user_id, billing_identity_type, subscription_status,
    current_period_end, cancel_at_period_end, scheduled_cancel_at, stripe_event_created,
    stripe_snapshot_observed_at, updated_at
  ) values (
    (snapshot->>'athlete_id')::uuid,
    snapshot->>'stripe_customer_id',
    snapshot->>'stripe_subscription_id',
    snapshot->>'stripe_price_id',
    (snapshot->>'billing_owner_user_id')::uuid,
    snapshot->>'billing_identity_type',
    snapshot->>'subscription_status',
    nullif(snapshot->>'current_period_end', '')::timestamptz,
    (snapshot->>'cancel_at_period_end')::boolean,
    nullif(snapshot->>'scheduled_cancel_at', '')::timestamptz,
    (snapshot->>'stripe_event_created')::bigint,
    (snapshot->>'stripe_snapshot_observed_at')::timestamptz,
    now()
  )
  on conflict (athlete_id) do update set
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    stripe_price_id = excluded.stripe_price_id,
    billing_owner_user_id = excluded.billing_owner_user_id,
    billing_identity_type = excluded.billing_identity_type,
    subscription_status = excluded.subscription_status,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    scheduled_cancel_at = excluded.scheduled_cancel_at,
    stripe_event_created = excluded.stripe_event_created,
    stripe_snapshot_observed_at = excluded.stripe_snapshot_observed_at,
    updated_at = now()
  where excluded.stripe_snapshot_observed_at > public.billing_accounts.stripe_snapshot_observed_at;

  return found;
end;
$$;
revoke all on function public.apply_billing_subscription_snapshot(jsonb) from public, anon, authenticated;
grant execute on function public.apply_billing_subscription_snapshot(jsonb) to service_role;

create table if not exists public.billing_invoices (
  stripe_invoice_id text primary key,
  athlete_id uuid not null references public.athlete_profiles(id) on delete restrict,
  billing_owner_user_id uuid not null references auth.users(id) on delete restrict,
  stripe_customer_id text not null,
  amount_cents integer not null check (amount_cents between 100 and 1000000),
  currency text not null default 'usd' check (currency = 'usd'),
  description text not null check (char_length(description) between 5 and 500),
  due_date date not null,
  status text not null check (status in ('draft', 'open', 'paid', 'void', 'uncollectible')),
  hosted_invoice_url text,
  invoice_pdf text,
  created_by uuid not null references auth.users(id) on delete restrict,
  finalized_by uuid references auth.users(id) on delete restrict,
  finalized_at timestamptz,
  sent_at timestamptz,
  stripe_event_created bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.billing_invoices enable row level security;

drop policy if exists "Billing owners and coaches read invoices" on public.billing_invoices;
create policy "Billing owners and coaches read invoices"
on public.billing_invoices
for select
to authenticated
using ((select auth.uid()) = billing_owner_user_id or (select public.is_coach()));

revoke all on table public.billing_invoices from anon;
revoke all on table public.billing_invoices from authenticated;
grant select (
  stripe_invoice_id, athlete_id, amount_cents, currency, description, due_date,
  status, hosted_invoice_url, invoice_pdf, finalized_at, sent_at, created_at, updated_at
) on table public.billing_invoices to authenticated;

create index if not exists billing_invoices_owner_created_idx
on public.billing_invoices (billing_owner_user_id, created_at desc);

create index if not exists billing_invoices_athlete_created_idx
on public.billing_invoices (athlete_id, created_at desc);

create index if not exists billing_invoices_created_by_idx
on public.billing_invoices (created_by);

create index if not exists billing_invoices_finalized_by_idx
on public.billing_invoices (finalized_by)
where finalized_by is not null;
