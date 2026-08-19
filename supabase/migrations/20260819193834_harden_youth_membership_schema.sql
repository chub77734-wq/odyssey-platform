-- Follow-up hardening found by the disposable-project database advisors.

create schema if not exists extensions;
alter extension btree_gist set schema extensions;

create index if not exists billing_accounts_member_plan_assignment_idx
  on public.billing_accounts (member_plan_assignment_id);
create index if not exists billing_invoices_member_plan_assignment_idx
  on public.billing_invoices (member_plan_assignment_id);
create index if not exists billing_invoices_plan_version_idx
  on public.billing_invoices (plan_version_id);
create index if not exists member_plan_assignments_plan_day_count_idx
  on public.member_plan_assignments
  (plan_version_id, accepted_weekly_selected_day_count);
create index if not exists member_plan_assignments_plan_terms_idx
  on public.member_plan_assignments
  (plan_version_id, accepted_price_cents, accepted_currency,
   accepted_billing_cadence, accepted_terms_version);
create index if not exists membership_plan_entitlements_key_idx
  on public.membership_plan_entitlements (entitlement_key);
create index if not exists membership_plan_versions_program_idx
  on public.membership_plan_versions (program_code);

drop policy "Published effective membership plans are public"
  on public.membership_plan_versions;
drop policy "Coaches read all membership plans"
  on public.membership_plan_versions;

create policy "Published effective membership plans are public"
on public.membership_plan_versions
for select to anon
using (
  publication_status = 'published'
  and effective_from <= current_date
  and (effective_to is null or current_date < effective_to)
);

create policy "Authenticated users read visible membership plans"
on public.membership_plan_versions
for select to authenticated
using (
  (
    publication_status = 'published'
    and effective_from <= current_date
    and (effective_to is null or current_date < effective_to)
  )
  or (select public.is_coach())
);
