-- Remove legacy broad grants while preserving the portal's authenticated
-- is_coach() contract and all policies that depend on it.

revoke all on table public.coaches from public, anon, authenticated;
grant select (user_id) on table public.coaches to authenticated;

create policy "Coaches read own role"
on public.coaches
for select to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.is_coach()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.coaches
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_coach() from public, anon, authenticated;
grant execute on function public.is_coach() to authenticated;

create index if not exists messages_sender_id_idx
  on public.messages (sender_id);
create index if not exists workouts_coach_id_idx
  on public.workouts (coach_id);
