-- Supabase Security Advisor fixes (2026-09-29, before the first Vercel deploy).

-- 1. Pin search_path on every function in public, so a function can't be pointed at another
--    schema's objects (lint 0011).
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, pg_temp', f);
  end loop;
end $$;

-- 2. Nothing in public is callable without signing in (lint 0028). Signed-in users keep what the
--    access rules and the app need; the new-user trigger function isn't callable by anyone directly.
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon', f);
  end loop;
end $$;
revoke execute on function public.handle_new_user() from authenticated;
grant execute on function public.can_access_client(uuid), public.has_role(), public.is_admin(), public.take_rate_limit(text, int, int), public.touch_last_seen() to authenticated;
-- The report functions (invoker rights; RLS still applies) stay available to signed-in users.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and not p.prosecdef
      and p.prorettype <> 'trigger'::regtype
  loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- 3. Functions created later start closed to signed-out visitors too.
alter default privileges in schema public revoke execute on functions from public, anon;
