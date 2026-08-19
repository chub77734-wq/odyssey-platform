-- Transactional server-only seat reservation for youth Checkout.

alter table public.member_plan_assignments
  add column checkout_idempotency_key uuid,
  add column reservation_expires_at timestamptz;

create unique index member_plan_assignment_checkout_idempotency_idx
  on public.member_plan_assignments (billing_owner_user_id, checkout_idempotency_key)
  where checkout_idempotency_key is not null;
create index member_plan_assignment_selected_days_idx
  on public.member_plan_assignments using gin (selected_iso_weekdays);

create or replace function public.reserve_youth_membership_checkout(
  target_athlete_id uuid,
  target_billing_owner_user_id uuid,
  requested_plan_code text,
  requested_iso_weekdays smallint[],
  requested_environment text,
  requested_idempotency_key uuid
)
returns table (
  assignment_id uuid,
  plan_version_id uuid,
  external_price_id text,
  price_cents integer,
  currency text,
  display_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_plan public.membership_plan_versions%rowtype;
  selected_mapping public.membership_plan_billing_mappings%rowtype;
  selected_capacity public.recurring_training_day_capacities%rowtype;
  existing_assignment public.member_plan_assignments%rowtype;
  reserved_count integer;
  locked_day_count integer := 0;
  new_assignment_id uuid;
begin
  if requested_environment not in ('test', 'live') then
    raise exception 'Unsupported billing environment';
  end if;

  select * into selected_plan
  from public.membership_plan_versions p
  where p.plan_code = requested_plan_code
    and p.audience = 'youth'
    and p.publication_status = 'published'
    and p.checkout_enabled
    and p.effective_from <= current_date
    and (p.effective_to is null or current_date < p.effective_to);
  if not found then raise exception 'Membership plan is unavailable'; end if;

  if cardinality(requested_iso_weekdays) <> selected_plan.weekly_selected_day_count
     or not requested_iso_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
     or (cardinality(requested_iso_weekdays) > 1 and requested_iso_weekdays[1] >= requested_iso_weekdays[2])
     or (cardinality(requested_iso_weekdays) > 2 and requested_iso_weekdays[2] >= requested_iso_weekdays[3]) then
    raise exception 'Selected training days do not match the plan';
  end if;

  select * into existing_assignment
  from public.member_plan_assignments a
  where a.billing_owner_user_id = target_billing_owner_user_id
    and a.checkout_idempotency_key = requested_idempotency_key;
  if found then
    if existing_assignment.athlete_id <> target_athlete_id
       or existing_assignment.plan_version_id <> selected_plan.id
       or existing_assignment.selected_iso_weekdays <> requested_iso_weekdays then
      raise exception 'Idempotency key was already used for a different enrollment';
    end if;
    if existing_assignment.status <> 'pending'
       or existing_assignment.reservation_expires_at <= now() then
      raise exception 'Enrollment request is no longer reservable';
    end if;
    new_assignment_id := existing_assignment.id;
  else
    update public.member_plan_assignments
    set status = 'canceled', ends_at = now(), reservation_expires_at = null, updated_at = now()
    where athlete_id = target_athlete_id
      and status = 'pending'
      and reservation_expires_at <= now();

    for selected_capacity in
      select c.* from public.recurring_training_day_capacities c
      where c.program_code = 'youth'
        and c.iso_weekday = any(requested_iso_weekdays)
        and c.status = 'open'
        and c.effective_from <= current_date
        and (c.effective_to is null or current_date < c.effective_to)
      order by c.iso_weekday
      for update
    loop
      locked_day_count := locked_day_count + 1;
      select count(*) into reserved_count
      from public.member_plan_assignments a
      where a.selected_iso_weekdays @> array[selected_capacity.iso_weekday]::smallint[]
        and (a.status in ('trialing', 'active')
          or (a.status = 'pending' and a.reservation_expires_at > now()));
      if reserved_count >= selected_capacity.capacity then
        raise exception 'Selected training day is at capacity';
      end if;
    end loop;
    if locked_day_count <> selected_plan.weekly_selected_day_count then
      raise exception 'One or more selected training days are unavailable';
    end if;

    insert into public.member_plan_assignments (
      athlete_id, billing_owner_user_id, plan_version_id, status, starts_at,
      accepted_at, accepted_price_cents, accepted_currency,
      accepted_billing_cadence, accepted_terms_version,
      accepted_weekly_selected_day_count, selected_iso_weekdays,
      checkout_idempotency_key, reservation_expires_at
    ) values (
      target_athlete_id, target_billing_owner_user_id, selected_plan.id, 'pending', now(),
      now(), selected_plan.price_cents, selected_plan.currency,
      selected_plan.billing_cadence, selected_plan.terms_version,
      selected_plan.weekly_selected_day_count, requested_iso_weekdays,
      requested_idempotency_key, now() + interval '35 minutes'
    ) returning id into new_assignment_id;
    insert into public.membership_status_events
      (assignment_id, from_status, to_status, effective_at, source)
    values (new_assignment_id, null, 'pending', now(), 'checkout');
  end if;

  select * into selected_mapping
  from public.membership_plan_billing_mappings m
  where m.plan_version_id = selected_plan.id
    and m.provider = 'stripe'
    and m.environment = requested_environment
    and m.enabled;
  if not found then raise exception 'Stripe Price mapping is unavailable'; end if;

  return query select new_assignment_id, selected_plan.id,
    selected_mapping.external_price_id, selected_plan.price_cents,
    selected_plan.currency, selected_plan.display_name;
end;
$$;

create or replace function public.renew_youth_membership_reservation(
  target_assignment_id uuid,
  target_billing_owner_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_assignment public.member_plan_assignments%rowtype;
  selected_capacity public.recurring_training_day_capacities%rowtype;
  reserved_count integer;
  locked_day_count integer := 0;
begin
  select * into selected_assignment
  from public.member_plan_assignments
  where id = target_assignment_id
    and billing_owner_user_id = target_billing_owner_user_id
  for update;
  if not found or selected_assignment.status <> 'pending' then
    raise exception 'Membership reservation is not renewable';
  end if;
  -- A concurrent resume may have renewed this same pending assignment while
  -- this call waited for the row lock. Treat that as idempotent success.
  if selected_assignment.reservation_expires_at > now() then
    return;
  end if;

  for selected_capacity in
    select c.* from public.recurring_training_day_capacities c
    where c.program_code = 'youth'
      and c.iso_weekday = any(selected_assignment.selected_iso_weekdays)
      and c.status = 'open'
      and c.effective_from <= current_date
      and (c.effective_to is null or current_date < c.effective_to)
    order by c.iso_weekday
    for update
  loop
    locked_day_count := locked_day_count + 1;
    select count(*) into reserved_count
    from public.member_plan_assignments a
    where a.id <> target_assignment_id
      and a.selected_iso_weekdays @> array[selected_capacity.iso_weekday]::smallint[]
      and (a.status in ('trialing', 'active')
        or (a.status = 'pending' and a.reservation_expires_at > now()));
    if reserved_count >= selected_capacity.capacity then
      raise exception 'Selected training day is at capacity';
    end if;
  end loop;
  if locked_day_count <> selected_assignment.accepted_weekly_selected_day_count then
    raise exception 'One or more selected training days are unavailable';
  end if;

  update public.member_plan_assignments
  set reservation_expires_at = now() + interval '35 minutes', updated_at = now()
  where id = target_assignment_id;
end;
$$;

create or replace function public.release_youth_membership_reservation(
  target_assignment_id uuid,
  target_billing_owner_user_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.member_plan_assignments
  set status = 'canceled', ends_at = now(), reservation_expires_at = null, updated_at = now()
  where id = target_assignment_id
    and billing_owner_user_id = target_billing_owner_user_id
    and status = 'pending';
$$;

create or replace function public.activate_youth_membership_assignment(
  target_assignment_id uuid,
  target_plan_version_id uuid,
  target_stripe_price_id text,
  target_stripe_subscription_id text,
  target_subscription_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_assignment public.member_plan_assignments%rowtype;
begin
  select * into selected_assignment
  from public.member_plan_assignments
  where id = target_assignment_id and plan_version_id = target_plan_version_id
  for update;
  if not found then raise exception 'Membership assignment mismatch'; end if;
  if target_subscription_status in ('active', 'trialing')
     and selected_assignment.status not in ('pending', 'trialing', 'active') then
    raise exception 'Membership assignment is not activatable';
  end if;
  if not exists (
    select 1 from public.membership_plan_billing_mappings m
    where m.plan_version_id = target_plan_version_id
      and m.external_price_id = target_stripe_price_id
      and m.enabled
  ) then raise exception 'Stripe Price mapping mismatch'; end if;

  update public.member_plan_assignments
  set status = case
        when target_subscription_status = 'active' then 'active'
        when target_subscription_status = 'trialing' then 'trialing'
        when target_subscription_status in ('canceled', 'incomplete_expired') then 'canceled'
        else status
      end,
      ends_at = case
        when target_subscription_status in ('canceled', 'incomplete_expired') then now()
        else ends_at
      end,
      stripe_subscription_id = target_stripe_subscription_id,
      reservation_expires_at = case
        when target_subscription_status in ('active', 'trialing', 'canceled', 'incomplete_expired') then null
        else reservation_expires_at
      end,
      updated_at = now()
  where id = target_assignment_id;

  if target_subscription_status in ('active', 'trialing', 'canceled', 'incomplete_expired')
     and selected_assignment.status is distinct from (
       case
         when target_subscription_status = 'active' then 'active'
         when target_subscription_status = 'trialing' then 'trialing'
         else 'canceled'
       end
     ) then
    insert into public.membership_status_events
      (assignment_id, from_status, to_status, effective_at, source)
    values (
      target_assignment_id,
      selected_assignment.status,
      case
        when target_subscription_status = 'active' then 'active'
        when target_subscription_status = 'trialing' then 'trialing'
        else 'canceled'
      end,
      now(),
      'stripe_webhook'
    );
  end if;
  update public.billing_accounts
  set member_plan_assignment_id = target_assignment_id, updated_at = now()
  where athlete_id = selected_assignment.athlete_id;
end;
$$;

revoke all on function public.reserve_youth_membership_checkout(uuid, uuid, text, smallint[], text, uuid)
  from public, anon, authenticated;
revoke all on function public.release_youth_membership_reservation(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.renew_youth_membership_reservation(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.activate_youth_membership_assignment(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_youth_membership_checkout(uuid, uuid, text, smallint[], text, uuid)
  to service_role;
grant execute on function public.release_youth_membership_reservation(uuid, uuid)
  to service_role;
grant execute on function public.renew_youth_membership_reservation(uuid, uuid)
  to service_role;
grant execute on function public.activate_youth_membership_assignment(uuid, uuid, text, text, text)
  to service_role;
