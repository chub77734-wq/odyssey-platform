-- Disposable/local database regression for the portal coach lookup and ACLs.
-- The final ROLLBACK is intentional.

begin;

do $$
begin
  if has_function_privilege('anon', 'public.is_coach()', 'execute') then
    raise exception 'anon must not execute public.is_coach()';
  end if;
  if not has_function_privilege('authenticated', 'public.is_coach()', 'execute') then
    raise exception 'authenticated must execute public.is_coach() for the portal and RLS';
  end if;
  if has_table_privilege('anon', 'public.coaches', 'select')
     or has_table_privilege('anon', 'public.coaches', 'insert')
     or has_table_privilege('anon', 'public.coaches', 'update')
     or has_table_privilege('anon', 'public.coaches', 'delete') then
    raise exception 'anon must have no coaches table privileges';
  end if;
  if has_table_privilege('authenticated', 'public.coaches', 'insert')
     or has_table_privilege('authenticated', 'public.coaches', 'update')
     or has_table_privilege('authenticated', 'public.coaches', 'delete') then
    raise exception 'authenticated coaches table access must be read-only';
  end if;
  if not has_column_privilege('authenticated', 'public.coaches', 'user_id', 'select')
     or has_column_privilege('authenticated', 'public.coaches', 'created_at', 'select') then
    raise exception 'authenticated must read only coaches.user_id';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_coach' and not p.prosecdef
  ) then
    raise exception 'public.is_coach() must be SECURITY INVOKER';
  end if;
end;
$$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('c0ac0000-0000-4000-8000-000000000001',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'coach@legacy-security.invalid', '',
   now(), '{}', '{}', now(), now()),
  ('c0ac0000-0000-4000-8000-000000000002',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'member@legacy-security.invalid', '',
   now(), '{}', '{}', now(), now());

insert into public.coaches (user_id)
values ('c0ac0000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"c0ac0000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

do $$
begin
  if not public.is_coach() then
    raise exception 'coach portal lookup must return true';
  end if;
  if (select count(*) from public.coaches) <> 1 then
    raise exception 'coach must read exactly their own role row';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"c0ac0000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

do $$
begin
  if public.is_coach() then
    raise exception 'non-coach portal lookup must return false';
  end if;
  if (select count(*) from public.coaches) <> 0 then
    raise exception 'non-coach must not read coach rows';
  end if;
end;
$$;

reset role;

do $$
begin
  if to_regclass('public.messages_sender_id_idx') is null
     or to_regclass('public.workouts_coach_id_idx') is null then
    raise exception 'legacy foreign keys require covering indexes';
  end if;
end;
$$;

rollback;
