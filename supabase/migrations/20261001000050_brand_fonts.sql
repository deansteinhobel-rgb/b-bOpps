-- Brand fonts (2026-10-01): MADE Avenue is licensed, so it can't live in the public GitHub repo.
-- It's served from the public "brand" bucket instead (fonts/, uploaded with `pnpm upload:font`).
-- Additive: the bucket keeps every image type it already allows.
update storage.buckets
set allowed_mime_types = (
  select array_agg(distinct t) from unnest(allowed_mime_types || array['font/otf', 'font/ttf', 'font/woff', 'font/woff2']) as t
)
where id = 'brand';
