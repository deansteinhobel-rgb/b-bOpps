-- Ad previews (Dean, 2026-09-28: option 2). Meta and LinkedIn image URLs from Windsor expire after
-- about a week, so each image is copied into private Supabase Storage the first time we see it.
create table public.ad_creatives (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  platform public.platform not null,
  external_account_id text not null,
  ad_id text not null,
  ad_type text,                    -- e.g. Google RESPONSIVE_SEARCH_AD (text only, no image)
  source_url text,                 -- latest image URL from Windsor (may expire)
  preview_link text,               -- Meta "View ad" shareable link
  storage_path text,               -- our saved copy in the ad-previews bucket
  content_type text,
  copied_at timestamptz,
  copy_error text,
  seen_at timestamptz not null default now(),
  unique (platform, external_account_id, ad_id)
);
create index ad_creatives_client_idx on public.ad_creatives (client_id);

alter table public.ad_creatives enable row level security;
create policy "creatives: read assigned" on public.ad_creatives for select to authenticated
  using (public.can_access_client(client_id));

-- Private bucket. Files live under <client_id>/..., and the team can read their clients' files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ad-previews', 'ad-previews', false, 10485760, array['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

create policy "ad previews: read assigned" on storage.objects for select to authenticated
  using (bucket_id = 'ad-previews' and public.can_access_client(((storage.foldername(name))[1])::uuid));
