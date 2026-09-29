-- Rate limits (security review before Vercel, 2026-09-29): per-person caps on the routes that spend
-- money (Claude) or take uploads, so a stolen session or a runaway script can't burn the Anthropic
-- budget or flood storage. Counted in the database so they hold across every Vercel instance.
create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_events_lookup_idx on public.rate_limit_events (profile_id, kind, created_at desc);
alter table public.rate_limit_events enable row level security;
-- No policies: only take_rate_limit() (security definer) reads and writes it.

-- True (and counts one use) when the signed-in person has used `p_kind` fewer than `p_max` times in
-- the last `p_window_seconds`; false otherwise, or when nobody is signed in.
create function public.take_rate_limit(p_kind text, p_max int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  used int;
begin
  if uid is null then return false; end if;
  -- One check at a time per person and kind, so parallel requests can't slip past the cap.
  perform pg_advisory_xact_lock(hashtext(uid::text || ':' || p_kind));
  select count(*) into used from public.rate_limit_events
    where profile_id = uid and kind = p_kind and created_at > now() - make_interval(secs => p_window_seconds);
  if used >= p_max then return false; end if;
  insert into public.rate_limit_events (profile_id, kind) values (uid, p_kind);
  return true;
end $$;
revoke execute on function public.take_rate_limit(text, int, int) from public;
grant execute on function public.take_rate_limit(text, int, int) to authenticated;
