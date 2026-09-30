-- The app may add ONE comment to a Master Production page it has just created (the brief for the
-- team, with people tagged; Dean, 2026-09-30). Each comment gets its own write log row, logged
-- before the call like every other Notion write. Additive: widens the allowed operations only.
alter table public.notion_write_log drop constraint notion_write_log_operation_check;
alter table public.notion_write_log add constraint notion_write_log_operation_check check (operation in ('create_action', 'create_test_brief', 'create_comment'));
