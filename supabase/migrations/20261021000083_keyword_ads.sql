-- Keyword ads (Dean, 2026-10-20; DNSFilter first): the market around a client, not just named
-- competitors. Each week the Meta Ad Library and LinkedIn Ad Library are searched for the client's
-- keywords (US and UK); the page shows the top 30 ads per keyword and platform in the library's
-- own order, and the 3 of those that have run longest. Read only toward every platform.
-- Client-scoped, no deletes: keywords are soft-removed, ads stay.

create table public.competitor_keywords (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  keyword text not null check (length(btrim(keyword)) between 2 and 80),
  sources text[] not null default '{meta,linkedin}' check (sources <@ array['meta', 'linkedin']::text[] and cardinality(sources) between 1 and 2),
  created_at timestamptz not null default now(),
  created_by_profile_id uuid references public.profiles (id) default auth.uid(),
  removed_at timestamptz,
  removed_by_profile_id uuid references public.profiles (id)
);
create unique index competitor_keywords_unique on public.competitor_keywords (client_id, lower(btrim(keyword))) where removed_at is null;

-- Runs: one per competitor × library × country (competitor ads) or keyword × library × country.
alter table public.competitor_runs alter column competitor_id drop not null;
alter table public.competitor_runs add column keyword_id uuid references public.competitor_keywords (id) on delete cascade;
alter table public.competitor_runs add constraint competitor_runs_one_target check (num_nonnulls(competitor_id, keyword_id) = 1);
alter table public.competitor_runs add constraint competitor_runs_keyword_source check (keyword_id is null or source in ('meta', 'linkedin'));

-- Every ad a keyword search returned. `ranks` = its place in the latest read per country
-- ({"US": 3, "GB": 12}), so the page can show the library's order. Server-written.
create table public.keyword_ads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  keyword_id uuid not null references public.competitor_keywords (id) on delete cascade,
  source text not null check (source in ('meta', 'linkedin')),
  external_id text not null,
  advertiser text,
  advertiser_id text,
  ranks jsonb not null default '{}',
  countries text[] not null default '{}',
  started_on date,
  ended_on date,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  format text,
  headline text,
  body text,
  cta text,
  landing_url text,
  library_url text,
  media_url text,
  storage_path text,
  content_type text,
  copy_error text,
  unique (keyword_id, source, external_id)
);
create index keyword_ads_client_idx on public.keyword_ads (client_id, keyword_id, source, last_seen_at desc);
create index keyword_ads_copy_idx on public.keyword_ads (client_id)
  where storage_path is null and copy_error is null and media_url is not null;

-- Runs and ads must belong to the same client as their competitor or keyword.
create or replace function public.competitor_client_matches() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.competitor_id is not null
     and not exists (select 1 from public.client_competitors c where c.id = new.competitor_id and c.client_id = new.client_id) then
    raise exception 'The competitor belongs to another client';
  end if;
  return new;
end $$;
create function public.keyword_client_matches() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.keyword_id is not null
     and not exists (select 1 from public.competitor_keywords k where k.id = new.keyword_id and k.client_id = new.client_id) then
    raise exception 'The keyword belongs to another client';
  end if;
  return new;
end $$;
create trigger competitor_runs_keyword_guard before insert or update on public.competitor_runs
  for each row execute function public.keyword_client_matches();
create trigger keyword_ads_client_guard before insert or update on public.keyword_ads
  for each row execute function public.keyword_client_matches();

-- The team adds and removes keywords; the client, author and removal stamps are kept honest.
create function public.guard_competitor_keyword_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.removed_at is not null or new.removed_by_profile_id is not null then raise exception 'Set by the app only'; end if;
    if new.created_by_profile_id is distinct from (select auth.uid()) then raise exception 'Set by the app only'; end if;
    return new;
  end if;
  if old.removed_at is not null and new.removed_at is distinct from old.removed_at then
    raise exception 'A removed keyword stays removed; add it again instead';
  end if;
  if new.removed_at is not null and old.removed_at is null and new.removed_by_profile_id is distinct from (select auth.uid()) then
    raise exception 'Set by the app only';
  end if;
  if (new.client_id, new.keyword, new.created_by_profile_id, new.created_at) is distinct from (old.client_id, old.keyword, old.created_by_profile_id, old.created_at) then
    raise exception 'A keyword can''t be changed; remove it and add a new one';
  end if;
  return new;
end $$;
create trigger competitor_keywords_guard before insert or update on public.competitor_keywords
  for each row execute function public.guard_competitor_keyword_fields();

revoke execute on function public.keyword_client_matches(), public.guard_competitor_keyword_fields()
  from public, anon, authenticated;

-- RLS: the client's team (and admins, GTM leads, viewers) read; the team keeps the keywords; ads are
-- server-written. No DELETE policies.
alter table public.competitor_keywords enable row level security;
alter table public.keyword_ads enable row level security;
create policy "keywords: read assigned" on public.competitor_keywords for select to authenticated
  using ((select public.can_access_client(client_id)));
create policy "keywords: team adds" on public.competitor_keywords for insert to authenticated
  with check ((select public.can_edit_client(client_id)));
create policy "keywords: team edits" on public.competitor_keywords for update to authenticated
  using ((select public.can_edit_client(client_id))) with check ((select public.can_edit_client(client_id)));
create policy "keyword ads: read assigned" on public.keyword_ads for select to authenticated
  using ((select public.can_access_client(client_id)));
