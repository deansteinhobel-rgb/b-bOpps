-- Profiles, last active and Options (Dean, 2026-09-29).

-- 1. Profile details people fill in themselves, when they last used the app, and their preferences.
alter table public.profiles
  add column avatar_url text,
  add column job_title text,
  add column phone text,
  add column location text,
  add column timezone text not null default 'Europe/London',
  add column bio text,
  add column last_seen_at timestamptz,
  add column preferences jsonb not null default '{}';

-- People can edit their own profile...
create policy "profiles: own details" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- ...but only admins change what grants access or links to Notion (role, email, Notion user).
-- The server (secret key, no auth.uid()) is not affected.
create function public.guard_profile_fields() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and not public.is_admin() and (
    new.role is distinct from old.role or new.email is distinct from old.email or new.notion_user_id is distinct from old.notion_user_id
  ) then
    raise exception 'Only admins can change role, email or Notion user';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function public.guard_profile_fields();

-- Last active: called on every page load, writes at most every 5 minutes.
create function public.touch_last_seen() returns void
language sql security definer set search_path = public as $$
  update public.profiles set last_seen_at = now()
  where id = auth.uid() and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
$$;
grant execute on function public.touch_last_seen() to authenticated;

-- 2. Profile pictures: a public bucket, each person writes only their own folder (<profile id>/...).
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;
create policy "avatars: own folder insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: own folder update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 3. Feature suggestions and bug reports from Options. People see their own; admins see and triage all.
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) default auth.uid(),
  kind text not null check (kind in ('feature', 'bug')),
  title text not null,
  details text,
  page_url text,
  status text not null default 'new' check (status in ('new', 'planned', 'in_progress', 'done', 'wont_do')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index feedback_created_idx on public.feedback (created_at desc);
alter table public.feedback enable row level security;
create policy "feedback: own or admin reads" on public.feedback for select to authenticated using (profile_id = auth.uid() or public.is_admin());
create policy "feedback: anyone with a role sends" on public.feedback for insert to authenticated with check (profile_id = auth.uid() and public.has_role());
create policy "feedback: admins triage" on public.feedback for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- No deletes.
