-- Aikido findings, 2026-10-13.

-- 1. One live Notion page per test brief and per check action. A double-click or a script can no
--    longer create two Master Production rows: the second log insert fails, and createNotionAction
--    stops before calling Notion ("no log, no write"). A failed write (success = false) can be retried;
--    dry runs never count.
create unique index notion_write_log_one_brief_per_test on public.notion_write_log (sprint_test_id)
  where operation = 'create_test_brief' and not dry_run and success is not false and sprint_test_id is not null;
create unique index notion_write_log_one_action_per_check on public.notion_write_log (check_result_id)
  where operation = 'create_action' and not dry_run and success is not false and check_result_id is not null;

-- 2. Profile pictures (unrestricted file upload): the app uploads them with the server key after
--    checking type, size and a rate limit, so signed-in users don't need to write the bucket
--    themselves. The bucket takes only small images.
update storage.buckets set file_size_limit = 1048576, allowed_mime_types = array['image/webp', 'image/png', 'image/jpeg'] where id = 'avatars';
drop policy if exists "avatars: own folder insert" on storage.objects;
drop policy if exists "avatars: own folder update" on storage.objects;
