-- Supabase CLI-generated migration: effective-dated youth membership catalog.
-- Capacity and Stripe mapping rows are intentionally not seeded.

create extension if not exists btree_gist;

create table public.membership_programs (
  program_code text primary key,
  display_name text not null,
  audience text not null check (audience = 'youth'),
  description text not null default '',
  publication_status text not null default 'draft'
    check (publication_status in ('draft', 'published', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.membership_plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_code text not null,
  version_number integer not null check (version_number > 0),
  program_code text not null references public.membership_programs(program_code) on delete restrict,
  display_name text not null,
  audience text not null check (audience = 'youth'),
  price_cents integer not null check (price_cents > 0),
  currency text not null default 'usd' check (currency = 'usd'),
  billing_cadence text not null default 'month' check (billing_cadence = 'month'),
  terms_version text not null,
  weekly_selected_day_count smallint not null check (weekly_selected_day_count between 1 and 3),
  public_copy text not null,
  publication_status text not null default 'draft'
    check (publication_status in ('draft', 'published', 'retired')),
  checkout_enabled boolean not null default false,
  effective_from date not null,
  effective_to date,
  effective_period daterange generated always as
    (daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)')) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_code, version_number),
  unique (id, weekly_selected_day_count),
  unique (id, price_cents, currency, billing_cadence, terms_version),
  constraint membership_plan_dates_valid check (effective_to is null or effective_to > effective_from),
  constraint membership_plan_checkout_requires_publication
    check (not checkout_enabled or publication_status = 'published'),
  constraint membership_plan_published_periods_do_not_overlap
    exclude using gist (plan_code with =, effective_period with &&)
    where (publication_status = 'published')
);

create table public.membership_entitlement_definitions (
  entitlement_key text primary key,
  display_name text not null,
  value_type text not null check (value_type = 'integer'),
  unit text not null,
  description text not null
);

create table public.membership_plan_entitlements (
  plan_version_id uuid not null references public.membership_plan_versions(id) on delete cascade,
  entitlement_key text not null references public.membership_entitlement_definitions(entitlement_key) on delete restrict,
  value_json jsonb not null,
  public_copy text not null,
  sort_order integer not null default 0,
  primary key (plan_version_id, entitlement_key)
);

create table public.membership_plan_billing_mappings (
  id uuid primary key default gen_random_uuid(),
  plan_version_id uuid not null references public.membership_plan_versions(id) on delete restrict,
  provider text not null default 'stripe' check (provider = 'stripe'),
  environment text not null check (environment in ('test', 'live')),
  external_product_id text check (external_product_id is null or external_product_id ~ '^prod_[A-Za-z0-9]+$'),
  external_price_id text not null check (external_price_id ~ '^price_[A-Za-z0-9]+$'),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (provider, environment, external_price_id),
  unique (plan_version_id, provider, environment)
);

create table public.recurring_training_day_capacities (
  id uuid primary key default gen_random_uuid(),
  program_code text not null references public.membership_programs(program_code) on delete restrict,
  iso_weekday smallint not null check (iso_weekday between 1 and 7),
  capacity integer not null check (capacity > 0),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed', 'retired')),
  effective_from date not null,
  effective_to date,
  effective_period daterange generated always as
    (daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)')) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_capacity_dates_valid check (effective_to is null or effective_to > effective_from),
  constraint recurring_open_capacity_periods_do_not_overlap
    exclude using gist (program_code with =, iso_weekday with =, effective_period with &&)
    where (status = 'open')
);

create table public.member_plan_assignments (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athlete_profiles(id) on delete restrict,
  billing_owner_user_id uuid not null references auth.users(id) on delete restrict,
  plan_version_id uuid not null references public.membership_plan_versions(id) on delete restrict,
  status text not null check (status in ('pending', 'trialing', 'active', 'canceled', 'ended')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  accepted_at timestamptz not null,
  accepted_price_cents integer not null check (accepted_price_cents > 0),
  accepted_currency text not null check (accepted_currency = 'usd'),
  accepted_billing_cadence text not null check (accepted_billing_cadence = 'month'),
  accepted_terms_version text not null,
  accepted_weekly_selected_day_count smallint not null check (accepted_weekly_selected_day_count between 1 and 3),
  selected_iso_weekdays smallint[] not null,
  stripe_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  assignment_period tstzrange generated always as
    (tstzrange(starts_at, coalesce(ends_at, 'infinity'::timestamptz), '[)')) stored,
  constraint member_assignment_dates_valid check (ends_at is null or ends_at > starts_at),
  constraint member_assignment_day_count_matches
    check (cardinality(selected_iso_weekdays) = accepted_weekly_selected_day_count),
  constraint member_assignment_days_are_iso
    check (selected_iso_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
  constraint member_assignment_days_sorted_unique check (
    cardinality(selected_iso_weekdays) = 1
    or (selected_iso_weekdays[1] < selected_iso_weekdays[2]
      and (cardinality(selected_iso_weekdays) = 2
        or selected_iso_weekdays[2] < selected_iso_weekdays[3]))
  ),
  constraint member_assignment_day_count_matches_version
    foreign key (plan_version_id, accepted_weekly_selected_day_count)
    references public.membership_plan_versions(id, weekly_selected_day_count) on delete restrict,
  constraint member_assignment_terms_match_version
    foreign key (plan_version_id, accepted_price_cents, accepted_currency,
      accepted_billing_cadence, accepted_terms_version)
    references public.membership_plan_versions(id, price_cents, currency,
      billing_cadence, terms_version) on delete restrict,
  constraint member_assignment_periods_do_not_overlap
    exclude using gist (athlete_id with =, assignment_period with &&)
    where (status in ('pending', 'trialing', 'active'))
);

create table public.membership_status_events (
  id bigint generated by default as identity primary key,
  assignment_id uuid not null references public.member_plan_assignments(id) on delete cascade,
  from_status text,
  to_status text not null check (to_status in ('pending', 'trialing', 'active', 'canceled', 'ended')),
  effective_at timestamptz not null,
  source text not null check (source in ('checkout', 'stripe_webhook', 'coach', 'migration', 'system')),
  created_at timestamptz not null default now()
);

alter table public.billing_accounts
  add column member_plan_assignment_id uuid references public.member_plan_assignments(id) on delete restrict;
alter table public.billing_invoices
  add column member_plan_assignment_id uuid references public.member_plan_assignments(id) on delete restrict,
  add column plan_version_id uuid references public.membership_plan_versions(id) on delete restrict;

create index member_plan_assignments_athlete_status_idx
  on public.member_plan_assignments (athlete_id, status, starts_at desc);
create index recurring_training_day_capacity_lookup_idx
  on public.recurring_training_day_capacities (program_code, iso_weekday, status, effective_from);
create index membership_status_events_assignment_idx
  on public.membership_status_events (assignment_id, effective_at desc);

alter table public.membership_programs enable row level security;
alter table public.membership_plan_versions enable row level security;
alter table public.membership_entitlement_definitions enable row level security;
alter table public.membership_plan_entitlements enable row level security;
alter table public.membership_plan_billing_mappings enable row level security;
alter table public.recurring_training_day_capacities enable row level security;
alter table public.member_plan_assignments enable row level security;
alter table public.membership_status_events enable row level security;

create policy "Published membership programs are public" on public.membership_programs
for select to anon, authenticated using (publication_status = 'published');
create policy "Published effective membership plans are public" on public.membership_plan_versions
for select to anon, authenticated using (
  publication_status = 'published' and effective_from <= current_date
  and (effective_to is null or current_date < effective_to)
);
create policy "Coaches read all membership plans" on public.membership_plan_versions
for select to authenticated using ((select public.is_coach()));
create policy "Membership entitlement definitions are public" on public.membership_entitlement_definitions
for select to anon, authenticated using (true);
create policy "Visible plan entitlements are public" on public.membership_plan_entitlements
for select to anon, authenticated using (exists (
  select 1 from public.membership_plan_versions p
  where p.id = membership_plan_entitlements.plan_version_id
));
create policy "Coaches read membership mappings" on public.membership_plan_billing_mappings
for select to authenticated using ((select public.is_coach()));
create policy "Coaches read recurring capacities" on public.recurring_training_day_capacities
for select to authenticated using ((select public.is_coach()));
create policy "Billing parties read membership assignments" on public.member_plan_assignments
for select to authenticated using (
  (select auth.uid()) = athlete_id
  or (select auth.uid()) = billing_owner_user_id
  or (select odyssey_private.is_billing_guardian(athlete_id))
  or (select public.is_coach())
);
create policy "Billing parties read membership events" on public.membership_status_events
for select to authenticated using (exists (
  select 1 from public.member_plan_assignments a
  where a.id = membership_status_events.assignment_id
    and ((select auth.uid()) = a.athlete_id
      or (select auth.uid()) = a.billing_owner_user_id
      or (select odyssey_private.is_billing_guardian(a.athlete_id))
      or (select public.is_coach()))
));

revoke all on table public.membership_programs, public.membership_plan_versions,
  public.membership_entitlement_definitions, public.membership_plan_entitlements,
  public.membership_plan_billing_mappings, public.recurring_training_day_capacities,
  public.member_plan_assignments, public.membership_status_events from public, anon, authenticated;
grant select on table public.membership_programs, public.membership_plan_versions,
  public.membership_entitlement_definitions, public.membership_plan_entitlements to anon, authenticated;
grant select on table public.membership_plan_billing_mappings,
  public.recurring_training_day_capacities, public.member_plan_assignments,
  public.membership_status_events to authenticated;
grant select, insert, update, delete on table public.membership_programs,
  public.membership_plan_versions, public.membership_entitlement_definitions,
  public.membership_plan_entitlements, public.membership_plan_billing_mappings,
  public.recurring_training_day_capacities, public.member_plan_assignments,
  public.membership_status_events to service_role;
grant usage, select on sequence public.membership_status_events_id_seq to service_role;

create or replace view public.active_membership_plans
with (security_invoker = true)
as select id as plan_version_id, plan_code, display_name, audience, price_cents,
  currency, billing_cadence, terms_version, weekly_selected_day_count, public_copy
from public.membership_plan_versions
where publication_status = 'published' and effective_from <= current_date
  and (effective_to is null or current_date < effective_to);
revoke all on table public.active_membership_plans from public, anon, authenticated;
grant select on table public.active_membership_plans to anon, authenticated;

insert into public.membership_programs
  (program_code, display_name, audience, description, publication_status)
values ('youth', 'Youth Track Development', 'youth',
  'Recurring selected training days, subject to capacity.', 'published');

insert into public.membership_entitlement_definitions
  (entitlement_key, display_name, value_type, unit, description)
values ('recurring_selected_training_days_per_week', 'Recurring selected training days per week',
  'integer', 'days/week', 'Distinct recurring ISO weekdays selected during youth enrollment.');

insert into public.membership_plan_versions
  (plan_code, version_number, program_code, display_name, audience, price_cents,
   terms_version, weekly_selected_day_count, public_copy, publication_status,
   checkout_enabled, effective_from)
values
  ('youth_odyssey_1', 1, 'youth', 'Odyssey 1', 'youth', 10000, 'youth-2026-08', 1,
   '1 recurring selected training day each week; subject to capacity.', 'published', true, date '2026-08-19'),
  ('youth_odyssey_2', 1, 'youth', 'Odyssey 2', 'youth', 15000, 'youth-2026-08', 2,
   '2 recurring selected training days each week; subject to capacity.', 'published', true, date '2026-08-19'),
  ('youth_odyssey_3', 1, 'youth', 'Odyssey 3', 'youth', 20000, 'youth-2026-08', 3,
   '3 recurring selected training days each week; subject to capacity.', 'published', true, date '2026-08-19');

insert into public.membership_plan_entitlements
  (plan_version_id, entitlement_key, value_json, public_copy, sort_order)
select p.id, 'recurring_selected_training_days_per_week',
  to_jsonb(p.weekly_selected_day_count), p.public_copy, 10
from public.membership_plan_versions p
where p.plan_code in ('youth_odyssey_1', 'youth_odyssey_2', 'youth_odyssey_3');
