-- Lumaux context bank: what we've decided and learned while building Lumaux, for Claude Code sessions.
-- Lives in its own Supabase project, never in the Lumaux database. Run once in that project's SQL editor.
-- Read and written by scripts/context.ts with the project's secret key; nothing is exposed to the Data API.
-- Entries are never deleted: a changed decision gets a new entry and the old one is superseded.

create extension if not exists pg_trgm with schema extensions;

create table public.context_entries (
  id bigint generated always as identity primary key,
  area text not null check (area ~ '^[a-z0-9-]+$'),
  title text not null,
  body text not null,
  kind text not null check (kind in ('rule', 'decision', 'how_it_works', 'gotcha', 'mapping', 'todo')),
  files text[] not null default '{}',
  tags text[] not null default '{}',
  decided_by text,
  decided_on date,
  source text,
  superseded_by bigint references public.context_entries (id),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector
);

create index context_entries_search on public.context_entries using gin (search);
create index context_entries_title_trgm on public.context_entries using gin (title extensions.gin_trgm_ops);
create index context_entries_area on public.context_entries (area) where superseded_by is null;

-- Every version of an entry, so an edit never loses what it said before.
create table public.context_entry_history (
  id bigint generated always as identity primary key,
  entry_id bigint not null references public.context_entries (id),
  title text not null,
  body text not null,
  changed_at timestamptz not null default now()
);

create function public.context_entries_before_write() returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  if tg_op = 'UPDATE' and (old.title is distinct from new.title or old.body is distinct from new.body) then
    insert into context_entry_history (entry_id, title, body) values (old.id, old.title, old.body);
  end if;
  new.updated_at := now();
  new.search :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('english', new.area || ' ' || array_to_string(new.tags, ' ') || ' ' || array_to_string(new.files, ' ')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.body, '')), 'C');
  return new;
end $$;

create trigger context_entries_before_write before insert or update on public.context_entries
  for each row execute function public.context_entries_before_write();

create function public.context_no_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'Context entries are never deleted: supersede them instead.';
end $$;

create trigger context_entries_no_delete before delete on public.context_entries
  for each row execute function public.context_no_delete();
create trigger context_entry_history_no_delete before delete on public.context_entry_history
  for each row execute function public.context_no_delete();

-- Ranked search over current entries. Words are OR-ed; title matches and recent decisions rank higher.
create function public.search_context(q text, p_area text default null, p_limit int default 10)
returns table (id bigint, area text, kind text, title text, body text, files text[], decided_on date, rank real)
language sql stable set search_path = public, extensions as $$
  with query as (
    select case when coalesce(trim(q), '') = '' then null
      else websearch_to_tsquery('english', regexp_replace(trim(q), '\s+', ' or ', 'g')) end as tsq
  )
  select e.id, e.area, e.kind, e.title, e.body, e.files, e.decided_on,
    (coalesce(ts_rank_cd(e.search, query.tsq, 32), 0) + similarity(e.title, coalesce(q, '')))::real as rank
  from context_entries e, query
  where e.superseded_by is null
    and (p_area is null or e.area = p_area)
    and (query.tsq is null or e.search @@ query.tsq or e.title % q)
  order by rank desc, e.decided_on desc nulls last, e.id desc
  limit p_limit
$$;

-- One row per area: how many current entries and the latest decision date.
create view public.context_areas with (security_invoker = true) as
  select area, count(*) as entries, max(decided_on) as latest
  from public.context_entries where superseded_by is null
  group by area order by area;

alter table public.context_entries enable row level security;
alter table public.context_entry_history enable row level security;
revoke all on public.context_entries, public.context_entry_history, public.context_areas from anon, authenticated;
revoke execute on function public.search_context(text, text, int) from public, anon, authenticated;
grant execute on function public.search_context(text, text, int) to service_role;
