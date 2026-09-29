-- When the client's Notion HQ was last fully or incrementally checked for new and edited pages.
alter table public.clients add column notion_hq_checked_at timestamptz;
