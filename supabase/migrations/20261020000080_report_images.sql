-- Pictures for the weekly Slack snapshot (Dean, 2026-10-20: "easy to see", like Databox's snapshots).
-- The server draws two PNGs per post (the client snapshot and the ad performance board) and keeps them
-- here at <client_id>/<week start>/<kind>-<time>.png; Slack shows them through 90-day signed links.
-- Private, server-written (secret key), no policies: nobody reads the bucket directly. No deletes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-images', 'report-images', false, 5242880, array['image/png'])
on conflict (id) do nothing;
