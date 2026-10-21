-- Every change a person makes in Lumaux is recorded (Dean, 2026-10-21: "as long as we record every
-- single change by a user in the app, whether it's an app action or a platform action, we should be
-- good"; builds and edits are tested on real clients, and fixed in the platform when needed).
--
-- One append-only table, written by triggers on every table people change, so nothing depends on
-- remembering to log. Who: auth.uid() for the person's own client; for the server's client (secret
-- key) acting for a person, the x-lumaux-actor request header (createAdminClient(actorId)). Changes
-- with neither (cron jobs, syncs) aren't recorded here: they're the app's own work, not a person's.
-- Platform writes and Notion writes keep their own logs (platform_write_log, notion_write_log), and
-- changes made inside the platforms are in platform_changes; Admin → Activity reads all four.

create table public.change_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  client_id uuid references public.clients (id),
  profile_id uuid not null references public.profiles (id),
  table_name text not null,
  row_id text,
  label text,                          -- the row's name when it has one (title, name, keyword, email…)
  op text not null check (op in ('insert', 'update', 'delete')),
  changes jsonb not null default '{}'   -- insert: the new values; update: {column: {from, to}}; delete: the old values
);
create index change_log_at_idx on public.change_log (at desc);
create index change_log_client_idx on public.change_log (client_id, at desc);
create index change_log_profile_idx on public.change_log (profile_id, at desc);

-- Written only by the trigger (security definer); the client's team reads, admins read everything
-- (people, invites and other rows with no client). Never updated or deleted.
alter table public.change_log enable row level security;
create policy "change log: team and admins read" on public.change_log for select to authenticated
  using ((select public.is_admin()) or (client_id is not null and public.can_access_client(client_id)));

-- The person behind a change: the signed-in user, or the person the server says it's acting for.
-- A malformed header is ignored rather than failing the write.
create function public.change_actor() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  header text;
begin
  if (select auth.uid()) is not null then
    return (select auth.uid());
  end if;
  if coalesce((select auth.role()), '') <> 'service_role' then
    return null;
  end if;
  begin
    header := nullif(current_setting('request.headers', true), '')::json ->> 'x-lumaux-actor';
  exception when others then
    return null;
  end;
  if header ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return header::uuid;
  end if;
  return null;
end
$$;

-- Long values (briefs, notes, snapshots) are cut to 300 characters: the log says what changed, the
-- row itself keeps the whole value.
create function public.change_value(v jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when v is null then 'null'::jsonb
              when length(v::text) <= 300 then v
              else to_jsonb(left(case when jsonb_typeof(v) = 'string' then v #>> '{}' else v::text end, 300) || '…') end
$$;

-- Trigger arguments: extra columns to ignore for that table (on top of the usual bookkeeping ones).
create function public.log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.change_actor();
  n jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  o jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  ignore text[] := array['id', 'created_at', 'updated_at', 'last_seen_at', 'synced_at'] || coalesce(tg_argv::text[], '{}');
  diff jsonb := '{}';
  k text;
  row_ref jsonb := coalesce(n, o);
  cid uuid;
begin
  if actor is null or not exists (select 1 from public.profiles where id = actor) then
    return null;
  end if;
  cid := case when tg_table_name = 'clients' then (row_ref ->> 'id')::uuid
              when row_ref ? 'client_id' then nullif(row_ref ->> 'client_id', '')::uuid end;

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if not (k = any (ignore)) and (n -> k) is distinct from (o -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_object('from', public.change_value(o -> k), 'to', public.change_value(n -> k)));
      end if;
    end loop;
    if diff = '{}' then
      return null; -- only bookkeeping columns moved (e.g. last seen)
    end if;
  else
    for k in select jsonb_object_keys(row_ref) loop
      if not (k = any (ignore)) and (row_ref -> k) <> 'null'::jsonb then
        diff := diff || jsonb_build_object(k, public.change_value(row_ref -> k));
      end if;
    end loop;
  end if;

  insert into public.change_log (client_id, profile_id, table_name, row_id, label, op, changes)
  values (cid, actor, tg_table_name, row_ref ->> 'id',
          left(coalesce(row_ref ->> 'title', row_ref ->> 'name', row_ref ->> 'keyword', row_ref ->> 'full_name', row_ref ->> 'email', row_ref ->> 'code', row_ref ->> 'insight_key'), 200),
          lower(tg_op), diff);
  return null;
end
$$;

revoke all on function public.change_actor() from public, anon;
revoke all on function public.log_change() from public, anon, authenticated;
revoke all on function public.change_value(jsonb) from public, anon;

-- Every table people change, directly or through the server acting for them.
do $$
declare
  t text;
begin
  foreach t in array array[
    'clients', 'client_team', 'client_team_invites', 'team_invites', 'profiles', 'client_platform_accounts',
    'conversion_field_tiers', 'client_budgets', 'client_goals', 'client_goal_values', 'check_definitions',
    'check_runs', 'check_results', 'sprints', 'sprint_tests', 'sprint_items', 'sprint_changes',
    'sprint_ai_runs', 'sprint_recommendations', 'insight_actions', 'call_commitment_actions', 'client_calls',
    'client_knowledge', 'client_briefs', 'content_idea_actions', 'content_pieces', 'content_sequences',
    'client_competitors', 'competitor_keywords', 'report_links', 'feedback', 'ad_creatives', 'campaign_builds'
  ] loop
    execute format('create trigger log_change after insert or update or delete on public.%I for each row execute function public.log_change()', t);
  end loop;
end
$$;
