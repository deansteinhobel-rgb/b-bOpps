-- Thought leader ads (Dean, 2026-10-01): Windsor returns no post link, title or image for many
-- LinkedIn thought leader ads (Star's run mostly on them). The team can paste the post's link once;
-- it's kept apart from Windsor's preview_link so the daily sync never overwrites it, and the app
-- then copies the image from the public post page. Written by the server only (after the canEdit
-- check), so there are still no write policies on ad_creatives. Additive.
alter table public.ad_creatives
  add column manual_post_link text,
  add column manual_post_link_by uuid references public.profiles (id),
  add column manual_post_link_at timestamptz;
