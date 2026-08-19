-- ODYSSEY BETA SYNTHETIC TEST ONLY.
-- Requires effective_dated_memberships_review.sql in a local/dev database.
-- The final ROLLBACK is intentional. Never replace it with COMMIT.

begin;

do $$
declare
  youth_count integer;
  adult_public_count integer;
  youth_definition_count integer;
  capacity_count integer;
begin
  if to_regprocedure(
    'public.activate_youth_membership_assignment(uuid,uuid,text,text,text)'
  ) is null then
    raise exception 'Checkout migration function was not parsed and installed';
  end if;

  select count(*) into youth_count
  from public.active_membership_plans
  where audience = 'youth' and price_cents in (10000, 15000, 20000);

  if youth_count <> 3 then
    raise exception 'Expected three active youth tiers, found %', youth_count;
  end if;

  select count(*) into youth_definition_count
  from public.active_membership_plans
  where (plan_code, price_cents, weekly_selected_day_count) in (
    ('youth_odyssey_1', 10000, 1),
    ('youth_odyssey_2', 15000, 2),
    ('youth_odyssey_3', 20000, 3)
  );

  if youth_definition_count <> 3 then
    raise exception 'Youth price/day-count definitions do not match the approved model';
  end if;

  select count(*) into adult_public_count
  from public.active_membership_plans
  where audience = 'adult';

  if adult_public_count <> 0 then
    raise exception 'Adult pilot tiers must not be public';
  end if;

  select count(*) into capacity_count
  from public.recurring_training_day_capacities;

  if capacity_count <> 0 then
    raise exception 'Review seed must not invent operating weekdays or capacities';
  end if;
end;
$$;

insert into public.membership_plan_billing_mappings
  (plan_version_id, provider, environment, external_product_id, external_price_id, enabled)
select
  p.id,
  'stripe',
  'test',
  'prod_Beta' || p.weekly_selected_day_count,
  'price_BetaYouth' || p.weekly_selected_day_count,
  true
from public.membership_plan_versions p
where p.plan_code in ('youth_odyssey_1', 'youth_odyssey_2', 'youth_odyssey_3')
  and p.version_number = 1;

do $$
declare
  resolvable_mapping_count integer;
begin
  select count(*) into resolvable_mapping_count
  from public.active_membership_plans p
  join public.membership_plan_billing_mappings m on m.plan_version_id = p.plan_version_id
  where p.audience = 'youth'
    and m.provider = 'stripe'
    and m.environment = 'test'
    and m.enabled;

  if resolvable_mapping_count <> 3 then
    raise exception 'Expected exactly one enabled test Stripe mapping for each youth plan';
  end if;
end;
$$;

do $$
declare
  adult_checkout_count integer;
begin
  select count(*) into adult_checkout_count
  from public.membership_plan_versions
  where audience = 'adult' and checkout_enabled;

  if adult_checkout_count <> 0 then
    raise exception 'Adult test tiers must remain checkout-disabled';
  end if;
end;
$$;

rollback;
