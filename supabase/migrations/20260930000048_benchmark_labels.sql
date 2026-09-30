-- Labels for comparing clients (Dean, 2026-09-30: the data we gather is the selling point; in time
-- we want to show prospects what works per industry, backed by our own tests). Four additions, all
-- client-scoped and additive. The lists live in src/lib/taxonomy.ts; the short ones are mirrored
-- here as check constraints so the data stays comparable. Nothing is deleted.

-- 1. Client labels: industry, sales motion, deal size band (ACV, US dollars), target regions.
alter table public.clients
  add column industry text,
  add column sub_industry text,             -- free text, e.g. "DNS security for MSPs"
  add column sales_motion text check (sales_motion in ('plg', 'sales_led', 'hybrid')),
  add column deal_size_band text check (deal_size_band in ('under_10k', '10k_50k', '50k_150k', '150k_500k', 'over_500k')),
  add column regions text[] not null default '{}'
    check (regions <@ array['na', 'uk', 'europe', 'mea', 'apac', 'latam']::text[]);

-- 2. The lever a sprint test pulls, and who set it (a person, Claude, or a rule from the source it
-- came from). The success metric already exists; the app now always stores one.
alter table public.sprint_tests
  add column lever text check (lever in ('audience', 'message', 'creative', 'format', 'offer', 'landing_page', 'bidding', 'structure', 'channel', 'measurement')),
  add column lever_source text check (lever_source in ('person', 'claude', 'rule'));
-- Pour a Sprint suggestions carry Claude's lever, copied onto the test when approved.
alter table public.sprint_recommendations
  add column lever text check (lever in ('audience', 'message', 'creative', 'format', 'offer', 'landing_page', 'bidding', 'structure', 'channel', 'measurement'));

-- 3. Claude's classification of every ad: format, content type, offer, hook, topic, audience. From
-- the saved image and copy where we have them, otherwise from the ad and campaign names. Written by
-- the server only (daily job and `pnpm label`); re-labelled only when what it saw changes.
create table public.ad_labels (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  platform public.platform not null,
  external_account_id text not null,
  ad_id text not null,
  format text not null,
  content_type text not null,
  offer text not null,
  hook text not null,
  topic text,                       -- short, e.g. "AI threats in DNS security"
  audience text,                    -- who the ad speaks to, if it says (e.g. "IT managers at MSPs")
  summary text,                     -- one line: what the ad is
  basis text not null check (basis in ('image', 'copy', 'name')),
  confidence text not null check (confidence in ('high', 'medium', 'low')), -- low = a vague name; leave out of benchmarks
  input_digest text not null,       -- what Claude saw, so edits re-label
  model text not null,
  labelled_at timestamptz not null default now(),
  unique (platform, external_account_id, ad_id)
);
create index ad_labels_client_idx on public.ad_labels (client_id);
alter table public.ad_labels enable row level security;
create policy "ad labels: read assigned" on public.ad_labels for select to authenticated
  using ((select public.can_access_client(client_id)));

-- 4. Each account's conversion and lead fields mapped to a standard result tier (lead, MQL, demo...),
-- so results compare across clients. Admins set them on the client's admin page.
create table public.conversion_field_tiers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  account_id uuid not null references public.client_platform_accounts (id) on delete cascade,
  field text not null,              -- the Windsor field ID, e.g. oneclickleads
  tier text not null check (tier in ('micro', 'lead', 'mql', 'trial', 'demo', 'sql', 'opportunity', 'customer', 'mixed')),
  description text,                 -- what the event is, e.g. "Demo request + free trial form"
  updated_by_profile_id uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  unique (account_id, field)
);
create index conversion_field_tiers_client_idx on public.conversion_field_tiers (client_id);
create trigger conversion_field_tiers_updated_at before update on public.conversion_field_tiers
  for each row execute function public.set_updated_at();
alter table public.conversion_field_tiers enable row level security;
create policy "conversion tiers: read assigned" on public.conversion_field_tiers for select to authenticated
  using ((select public.can_access_client(client_id)));
create policy "conversion tiers: admin inserts" on public.conversion_field_tiers for insert to authenticated
  with check ((select public.is_admin()));
create policy "conversion tiers: admin updates" on public.conversion_field_tiers for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
