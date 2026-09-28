-- Carried-forward items remember what they were (learning / mitigation / hypothesis / action) and
-- which sprint number they came from, so the next sprint can label them.
alter table public.sprint_items add column origin_kind public.sprint_item_kind;
alter table public.sprint_items add column origin_sprint_number integer;
