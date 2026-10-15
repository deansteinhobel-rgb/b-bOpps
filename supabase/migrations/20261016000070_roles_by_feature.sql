-- Roles by feature (Dean, 2026-10-15): one layout for everyone, and roles only decide what you can run.
--   Admin, GTM lead, account manager, paid media specialist: every feature, on the clients they can see.
--   Content writer (new): sees every client like a viewer and can generate content ideas.
--   Viewer: view only.
-- The Admin area (clients, people, ad accounts, result tiers, feedback triage) stays with admins and GTM
-- leads (is_admin), and so does archiving. Additive only: no tables or rows are removed.
-- Comparisons use role::text so the new enum value isn't needed in this transaction.

alter type public.app_role add value if not exists 'content_writer';

-- Viewers and content writers see every client and change nothing (can_edit_client, my_client_ids and
-- can_access_client all read this).
create or replace function public.is_viewer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role::text in ('viewer', 'content_writer'));
$$;

-- Content ideas: everyone who can edit the client, plus content writers.
create function public.can_run_content_ideas(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_edit_client(cid) or (
    public.can_access_client(cid)
    and exists (select 1 from public.profiles where id = auth.uid() and role::text = 'content_writer')
  );
$$;
revoke execute on function public.can_run_content_ideas(uuid) from public, anon;
grant execute on function public.can_run_content_ideas(uuid) to authenticated;

-- Sharing reports: anyone who can edit the client (was admins, GTM leads and the client's AMs).
create or replace function public.can_share_reports(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_edit_client(cid);
$$;

-- Pour a Sprint: anyone who can edit the client starts a pour and reviews, approves or rejects suggestions.
alter policy "ai runs: admins create" on public.sprint_ai_runs with check (public.can_edit_client(client_id));
alter policy "ai runs: admins create" on public.sprint_ai_runs rename to "ai runs: team creates";
alter policy "recommendations: admins update" on public.sprint_recommendations
  using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));
alter policy "recommendations: admins update" on public.sprint_recommendations rename to "recommendations: team updates";

-- Budgets: anyone who can edit the client sets this month's figures.
alter policy "budgets: admin inserts" on public.client_budgets with check (public.can_edit_client(client_id));
alter policy "budgets: admin inserts" on public.client_budgets rename to "budgets: team inserts";
alter policy "budgets: admin updates" on public.client_budgets using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));
alter policy "budgets: admin updates" on public.client_budgets rename to "budgets: team updates";

-- Client goals: anyone who can edit the client adds a goal or updates its figures.
alter policy "goals: admins create" on public.client_goals with check (public.can_edit_client(client_id));
alter policy "goals: admins create" on public.client_goals rename to "goals: team creates";
alter policy "goals: admins update" on public.client_goals using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));
alter policy "goals: admins update" on public.client_goals rename to "goals: team updates";
alter policy "goal values: admins create" on public.client_goal_values with check (public.can_edit_client(client_id));
alter policy "goal values: admins create" on public.client_goal_values rename to "goal values: team creates";
alter policy "goal values: admins update" on public.client_goal_values using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));
alter policy "goal values: admins update" on public.client_goal_values rename to "goal values: team updates";

-- Sprint tests: renaming is for anyone who can edit the client (the update policy already checks that);
-- archiving stays admin only, and the Notion brief and a test's origin stay with the app.
create or replace function public.guard_sprint_test_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.archived_at is not null then raise exception 'Only admins can archive a test'; end if;
    return new;
  end if;
  if new.archived_at is distinct from old.archived_at then raise exception 'Only admins can archive a test'; end if;
  if (new.notion_page_id, new.briefed_at) is distinct from (old.notion_page_id, old.briefed_at) then
    raise exception 'The Notion brief is set by the app only';
  end if;
  if (new.recommendation_id, new.call_commitment_id, new.content_idea_id, new.insight_key, new.carried_from_test_id, new.created_by_profile_id, new.created_at)
     is distinct from (old.recommendation_id, old.call_commitment_id, old.content_idea_id, old.insight_key, old.carried_from_test_id, old.created_by_profile_id, old.created_at) then
    raise exception 'Where a test came from and who created it can''t be changed';
  end if;
  return new;
end $$;

-- Sprints: anyone who can edit the client closes or reopens one; a sprint's client, number and dates
-- never change.
create or replace function public.guard_sprint_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null or public.is_admin() then return new; end if;
  if (new.client_id, new.number, new.start_date, new.end_date) is distinct from (old.client_id, old.number, old.start_date, old.end_date) then
    raise exception 'A sprint''s client, number and dates can''t be changed';
  end if;
  return new;
end $$;

revoke execute on function public.guard_sprint_test_fields(), public.guard_sprint_fields() from public, anon, authenticated;
