-- Google search ads have no image. Keep their copy (headlines, descriptions, paths, final URL, from
-- Windsor) so the app can draw a mock of the search result instead (Dean).
alter table public.ad_creatives add column text_ad jsonb;
comment on column public.ad_creatives.text_ad is
  'Responsive search ad copy: { headlines: [{ text, pinned }], descriptions: [{ text, pinned }], path1, path2, finalUrl }';
