-- Integrity guards from the October code review (2026-10-20). Additive: no table or column changes.
--
-- 1. Nothing gets deleted: the invite tables had "for all" admin policies, which include DELETE.
--    They become select / insert / update, and DELETE is revoked from signed-in and signed-out
--    users on every table (the app has no delete path; the server's secret key is unaffected).
-- 2. Pour a Sprint suggestions: the team update policy (070) covered whole rows, so Claude's
--    reasoning, where a suggestion came from and who decided it could be rewritten directly.
-- 3. Pour a Sprint runs: the team creates a run only as itself, generating, with nothing filled in.
-- 4. Goal values must belong to the goal's client.
-- 5. Sprint tests: a new test can't arrive with a Notion brief or someone else as its creator,
--    except a carry-over, which copies them from a test of the same client.

-- 1. No deletes ---------------------------------------------------------------------------------
drop policy "team_invites: admin all" on public.team_invites;
drop policy "client_team_invites: admin all" on public.client_team_invites;
create policy "team_invites: admin reads" on public.team_invites for select to authenticated using (public.is_admin());
create policy "team_invites: admin inserts" on public.team_invites for insert to authenticated with check (public.is_admin());
create policy "team_invites: admin updates" on public.team_invites for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "client_team_invites: admin reads" on public.client_team_invites for select to authenticated using (public.is_admin());
create policy "client_team_invites: admin inserts" on public.client_team_invites for insert to authenticated with check (public.is_admin());
create policy "client_team_invites: admin updates" on public.client_team_invites for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke delete on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke delete on tables from anon, authenticated;

-- 2. Suggestions ---------------------------------------------------------------------------------
-- The team edits the plan (title, hypothesis, brief notes, success) and decides as itself.
create function public.guard_recommendation_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null or public.is_admin() then return new; end if;
  if (new.run_id, new.client_id, new.sprint_id, new.position, new.created_at)
     is distinct from (old.run_id, old.client_id, old.sprint_id, old.position, old.created_at) then
    raise exception 'Where a suggestion came from can''t be changed';
  end if;
  if (new.platform, new.assets, new.why_data, new.why_market, new.sources, new.confidence, new.effort,
      new.summary, new.impact, new.expected_impact, new.evidence, new.lever, new.call_commitment_id)
     is distinct from (old.platform, old.assets, old.why_data, old.why_market, old.sources, old.confidence, old.effort,
      old.summary, old.impact, old.expected_impact, old.evidence, old.lever, old.call_commitment_id) then
    raise exception 'Claude''s reasoning can''t be edited';
  end if;
  if new.reviewed_by_profile_id is distinct from old.reviewed_by_profile_id
     and new.reviewed_by_profile_id is distinct from (select auth.uid()) then
    raise exception 'You can only review as yourself';
  end if;
  if new.decided_by_profile_id is distinct from old.decided_by_profile_id
     and new.decided_by_profile_id is not null and new.decided_by_profile_id is distinct from (select auth.uid()) then
    raise exception 'You can only decide as yourself';
  end if;
  if new.sprint_test_id is distinct from old.sprint_test_id and new.sprint_test_id is not null
     and not exists (select 1 from public.sprint_tests t where t.id = new.sprint_test_id and t.recommendation_id = new.id) then
    raise exception 'That test wasn''t planned from this suggestion';
  end if;
  return new;
end $$;
create trigger sprint_recommendations_guard before update on public.sprint_recommendations
  for each row execute function public.guard_recommendation_fields();
create trigger sprint_recommendations_client_guard before insert or update on public.sprint_recommendations
  for each row execute function public.sprint_child_client_matches();

-- 3. Runs ----------------------------------------------------------------------------------------
alter policy "ai runs: team creates" on public.sprint_ai_runs with check (
  public.can_edit_client(client_id)
  and requested_by_profile_id = (select auth.uid())
  and status = 'generating' and market_summary is null and news = '[]'::jsonb
  and finished_at is null and archived_at is null
);
create trigger sprint_ai_runs_client_guard before insert or update on public.sprint_ai_runs
  for each row execute function public.sprint_child_client_matches();

-- 4. Goal values ---------------------------------------------------------------------------------
create function public.goal_value_client_matches() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.client_id is distinct from (select g.client_id from public.client_goals g where g.id = new.goal_id) then
    raise exception 'client_id must match the goal';
  end if;
  if (select auth.uid()) is not null then new.updated_by_profile_id := (select auth.uid()); end if;
  return new;
end $$;
create trigger client_goal_values_client_guard before insert or update on public.client_goal_values
  for each row execute function public.goal_value_client_matches();

-- 5. Sprint tests (the update rules are unchanged from 070) ----------------------------------------
create or replace function public.guard_sprint_test_fields() returns trigger
language plpgsql set search_path = '' as $$
declare
  src public.sprint_tests;
begin
  if (select auth.uid()) is null or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.archived_at is not null then raise exception 'Only admins can archive a test'; end if;
    if new.carried_from_test_id is not null then
      select * into src from public.sprint_tests where id = new.carried_from_test_id;
      if src.id is null or src.client_id is distinct from new.client_id then
        raise exception 'A test can only be carried over within its client';
      end if;
    end if;
    -- A carry-over copies the brief and creator from the test it carries; anything else starts clean.
    if (new.notion_page_id, new.briefed_at) is distinct from (src.notion_page_id, src.briefed_at)
       and (new.notion_page_id is not null or new.briefed_at is not null) then
      raise exception 'The Notion brief is set by the app only';
    end if;
    if new.created_by_profile_id is distinct from (select auth.uid())
       and new.created_by_profile_id is distinct from src.created_by_profile_id then
      raise exception 'You can only create a test as yourself';
    end if;
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

revoke execute on function public.guard_recommendation_fields(), public.goal_value_client_matches(), public.guard_sprint_test_fields()
  from public, anon, authenticated;
