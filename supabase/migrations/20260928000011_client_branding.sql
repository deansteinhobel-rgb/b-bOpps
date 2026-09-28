-- Client branding: website and logo shown across the app (Sauvignon Blanc redesign).
alter table public.clients add column website text;
alter table public.clients add column logo_url text;

-- Public bucket for brand assets (client logos are public information anyway).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand', 'brand', true, 2097152, array['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'])
on conflict (id) do nothing;

update public.clients set website = 'dnsfilter.com' where slug = 'dnsfilter' and website is null;
update public.clients set website = 'camber.health' where slug = 'camber' and website is null;
