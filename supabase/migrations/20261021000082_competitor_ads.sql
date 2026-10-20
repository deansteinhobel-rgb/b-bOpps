-- Competitor ads (Dean, 2026-10-20; DNSFilter first): each client's competitors, and the ads they
-- run, read once a week from the public Meta Ad Library, Google Ads Transparency Center and
-- LinkedIn Ad Library through Apify. Read only toward every platform. Client-scoped, no deletes:
-- competitors are soft-removed, ads that stop showing are marked inactive.

-- The list the team keeps on the Brain page. The ids tell the scrapers where to look; a source
-- with no id is skipped.
create table public.client_competitors (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  website text check (website is null or length(website) <= 300),
  meta_page_id text check (meta_page_id is null or meta_page_id ~ '^[0-9]{3,30}$'),
  linkedin_company text check (linkedin_company is null or linkedin_company ~ '^[A-Za-z0-9_-]{1,120}$'),
  google_advertiser_id text check (google_advertiser_id is null or google_advertiser_id ~ '^AR[0-9]{10,30}$'),
  notes text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by_profile_id uuid references public.profiles (id) default auth.uid(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by_profile_id uuid references public.profiles (id)
);
create index client_competitors_client_idx on public.client_competitors (client_id) where removed_at is null;
create trigger client_competitors_updated_at before update on public.client_competitors
  for each row execute function public.set_updated_at();

-- One row per Apify run (competitor × source × country). Server-written.
create table public.competitor_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  competitor_id uuid not null references public.client_competitors (id) on delete cascade,
  source text not null check (source in ('meta', 'google', 'linkedin')),
  country text not null check (country ~ '^[A-Z]{2}$'),
  actor text not null,
  apify_run_id text,
  status text not null default 'started' check (status in ('started', 'collected', 'failed')),
  started_at timestamptz not null default now(),
  collected_at timestamptz,
  items integer,
  error text,
  usage_usd numeric
);
create index competitor_runs_client_idx on public.competitor_runs (client_id, started_at desc);
create index competitor_runs_open_idx on public.competitor_runs (status) where status = 'started';

-- Every ad seen in a library. Server-written; labels are filled in by the nightly labels job.
create table public.competitor_ads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  competitor_id uuid not null references public.client_competitors (id) on delete cascade,
  source text not null check (source in ('meta', 'google', 'linkedin')),
  external_id text not null,
  countries text[] not null default '{}',
  started_on date,
  ended_on date,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  active boolean not null default true,
  format text,
  headline text,
  body text,
  cta text,
  landing_url text,
  placements text[] not null default '{}',
  library_url text,
  media_url text,
  storage_path text,
  content_type text,
  copy_error text,
  raw jsonb,
  label_format text,
  label_content_type text,
  label_offer text,
  label_hook text,
  label_topic text,
  label_audience text,
  label_summary text,
  label_confidence text check (label_confidence is null or label_confidence in ('low', 'medium', 'high')),
  label_digest text,
  labeled_at timestamptz,
  unique (competitor_id, source, external_id)
);
create index competitor_ads_client_idx on public.competitor_ads (client_id, last_seen_at desc);
create index competitor_ads_copy_idx on public.competitor_ads (client_id)
  where storage_path is null and copy_error is null and media_url is not null;

-- Ads and runs must belong to the same client as their competitor.
create function public.competitor_client_matches() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.client_competitors c where c.id = new.competitor_id and c.client_id = new.client_id) then
    raise exception 'The competitor belongs to another client';
  end if;
  return new;
end $$;
create trigger competitor_runs_client_guard before insert or update on public.competitor_runs
  for each row execute function public.competitor_client_matches();
create trigger competitor_ads_client_guard before insert or update on public.competitor_ads
  for each row execute function public.competitor_client_matches();

-- The team edits names and ids; who added it, the client and removal stamps are kept honest.
create function public.guard_client_competitor_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.removed_at is not null or new.removed_by_profile_id is not null then raise exception 'Set by the app only'; end if;
    if new.created_by_profile_id is distinct from (select auth.uid()) then raise exception 'Set by the app only'; end if;
    return new;
  end if;
  if old.removed_at is not null and new.removed_at is distinct from old.removed_at then
    raise exception 'A removed competitor stays removed; add it again instead';
  end if;
  if new.removed_at is not null and old.removed_at is null and new.removed_by_profile_id is distinct from (select auth.uid()) then
    raise exception 'Set by the app only';
  end if;
  if (new.client_id, new.created_by_profile_id, new.created_at) is distinct from (old.client_id, old.created_by_profile_id, old.created_at) then
    raise exception 'A competitor''s client and author can''t be changed';
  end if;
  return new;
end $$;
create trigger client_competitors_guard before insert or update on public.client_competitors
  for each row execute function public.guard_client_competitor_fields();

revoke execute on function public.competitor_client_matches(), public.guard_client_competitor_fields()
  from public, anon, authenticated;

-- RLS: the client's team (and admins, GTM leads, viewers) read; the team keeps the list; runs and
-- ads are written by the server only. No DELETE policies.
alter table public.client_competitors enable row level security;
alter table public.competitor_runs enable row level security;
alter table public.competitor_ads enable row level security;
create policy "competitors: read assigned" on public.client_competitors for select to authenticated
  using ((select public.can_access_client(client_id)));
create policy "competitors: team adds" on public.client_competitors for insert to authenticated
  with check ((select public.can_edit_client(client_id)));
create policy "competitors: team edits" on public.client_competitors for update to authenticated
  using ((select public.can_edit_client(client_id))) with check ((select public.can_edit_client(client_id)));
create policy "competitor runs: read assigned" on public.competitor_runs for select to authenticated
  using ((select public.can_access_client(client_id)));
create policy "competitor ads: read assigned" on public.competitor_ads for select to authenticated
  using ((select public.can_access_client(client_id)));
