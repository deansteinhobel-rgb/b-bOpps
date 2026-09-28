-- Sprints (Dean, 2026-09-28): the main loop of the app. Two-week sprints, the same fortnight for
-- every client (alternate Mondays from 2026-09-28), one sprint per client:
--   plan (goal, hypotheses, carried-forward items) → change log → review (the six boxes) →
--   close and carry the chosen learnings/mitigations into the next sprint.
-- Kept in the app only (no Notion writes). No deletes: items are "dropped", changes "dismissed".

create type public.sprint_item_kind as enum ('hypothesis', 'learning', 'mitigation', 'action', 'carried');
create type public.sprint_item_status as enum ('open', 'done', 'dropped');
create type public.hypothesis_outcome as enum ('proven', 'disproven', 'inconclusive');
create type public.change_type as enum ('budget', 'creative', 'targeting', 'bidding', 'landing_page', 'tracking', 'structure', 'other');

create table public.sprints (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  number integer not null,
  start_date date not null,
  end_date date not null,
  goal text,
  -- Review board
  key_takeaway text,
  highlights text,
  challenges text,          -- "Challenge & hypotheses why"
  progress_made text,
  summary jsonb,            -- numbers snapshot taken when the sprint is closed
  closed_at timestamptz,
  closed_by_profile_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, start_date)
);
create index sprints_client_idx on public.sprints (client_id, start_date desc);
create trigger sprints_updated_at before update on public.sprints for each row execute function public.set_updated_at();

create table public.sprint_items (
  id uuid primary key default gen_random_uuid(),
  sprint_id uuid not null references public.sprints (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  kind public.sprint_item_kind not null,
  text text not null,
  status public.sprint_item_status not null default 'open',
  outcome public.hypothesis_outcome,          -- hypotheses only
  carry_forward boolean not null default false, -- chosen at close; copied into the next sprint
  carried_from_item_id uuid references public.sprint_items (id),
  check_result_id uuid references public.check_results (id),
  notion_page_id text,
  created_by_profile_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sprint_items_sprint_idx on public.sprint_items (sprint_id);
create index sprint_items_client_kind_idx on public.sprint_items (client_id, kind);
create trigger sprint_items_updated_at before update on public.sprint_items for each row execute function public.set_updated_at();

create table public.sprint_changes (
  id uuid primary key default gen_random_uuid(),
  sprint_id uuid not null references public.sprints (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  changed_on date not null,
  platform public.platform,
  campaign_name text,
  type public.change_type not null default 'other',
  description text not null,
  hypothesis_item_id uuid references public.sprint_items (id),
  source text not null default 'manual' check (source in ('manual', 'detected')),
  detected_key text,                         -- stable key for Windsor-detected changes
  status text not null default 'logged' check (status in ('logged', 'dismissed')),
  created_by_profile_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (client_id, detected_key)
);
create index sprint_changes_sprint_idx on public.sprint_changes (sprint_id, changed_on);

-- Items and changes must belong to the same client as their sprint.
create function public.sprint_child_client_matches() returns trigger
language plpgsql as $$
begin
  if new.client_id is distinct from (select client_id from public.sprints where id = new.sprint_id) then
    raise exception 'client_id must match the sprint';
  end if;
  return new;
end $$;
create trigger sprint_items_client_guard before insert or update on public.sprint_items for each row execute function public.sprint_child_client_matches();
create trigger sprint_changes_client_guard before insert or update on public.sprint_changes for each row execute function public.sprint_child_client_matches();

alter table public.sprints enable row level security;
alter table public.sprint_items enable row level security;
alter table public.sprint_changes enable row level security;

-- The client's team (and admins) read and write their client's sprints. No DELETE policies.
create policy "sprints: read assigned" on public.sprints for select to authenticated using (public.can_access_client(client_id));
create policy "sprints: team creates" on public.sprints for insert to authenticated with check (public.can_access_client(client_id));
create policy "sprints: team updates" on public.sprints for update to authenticated using (public.can_access_client(client_id)) with check (public.can_access_client(client_id));
create policy "sprint items: read assigned" on public.sprint_items for select to authenticated using (public.can_access_client(client_id));
create policy "sprint items: team creates" on public.sprint_items for insert to authenticated with check (public.can_access_client(client_id));
create policy "sprint items: team updates" on public.sprint_items for update to authenticated using (public.can_access_client(client_id)) with check (public.can_access_client(client_id));
create policy "sprint changes: read assigned" on public.sprint_changes for select to authenticated using (public.can_access_client(client_id));
create policy "sprint changes: team creates" on public.sprint_changes for insert to authenticated with check (public.can_access_client(client_id));
create policy "sprint changes: team updates" on public.sprint_changes for update to authenticated using (public.can_access_client(client_id)) with check (public.can_access_client(client_id));

-- Windsor events inside a date range, for auto-detected change suggestions:
-- ads first seen in the range, and ads whose last impressions fell in the range (stopped running).
-- SECURITY INVOKER: RLS on windsor_daily_metrics applies.
create function public.sprint_ad_events(p_client uuid, p_from date, p_to date)
returns table (
  platform public.platform, external_account_id text, ad_id text, ad_name text, campaign_name text,
  first_seen date, last_seen date, data_through date, spend_in_range numeric
)
language sql stable as $$
  with lifetimes as (
    select platform, external_account_id, ad_id, max(ad_name) as ad_name, max(campaign_name) as campaign_name,
           min(date) filter (where impressions > 0) as first_seen,
           max(date) filter (where impressions > 0) as last_seen,
           min(date) as data_from,
           sum(spend) filter (where date between p_from and p_to) as spend_in_range
    from public.windsor_daily_metrics
    where client_id = p_client and ad_id <> ''
    group by platform, external_account_id, ad_id
  ),
  through as (
    select platform, external_account_id, max(date) as data_through
    from public.windsor_daily_metrics where client_id = p_client
    group by platform, external_account_id
  )
  select l.platform, l.external_account_id, l.ad_id, l.ad_name, l.campaign_name, l.first_seen, l.last_seen, t.data_through, coalesce(l.spend_in_range, 0)
  from lifetimes l join through t using (platform, external_account_id)
  where l.first_seen is not null
    and ((l.first_seen between p_from and p_to and l.first_seen > l.data_from)
      or (l.last_seen between p_from and p_to and l.last_seen < t.data_through - 1));
$$;
grant execute on function public.sprint_ad_events(uuid, date, date) to authenticated;
