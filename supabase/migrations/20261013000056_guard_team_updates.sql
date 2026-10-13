-- Security audit 2026-10, M5: team members could change columns through the API that the app keeps
-- for admins or the server, because the team update policies cover every column. These guards
-- refuse those changes unless the caller is an admin / GTM lead or the server (secret key: no
-- auth.uid()), like guard_profile_fields. Columns the team edits in the app are untouched.

-- Sprint tests: archiving (works like a delete) and renaming are admin only; the Notion brief and
-- where a test came from (suggestion, call, content idea, insight, carried-over test) are set by the
-- app only, and the author never changes.
create function public.guard_sprint_test_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.archived_at is not null then raise exception 'Only admins can archive a test'; end if;
    return new;
  end if;
  if new.archived_at is distinct from old.archived_at then raise exception 'Only admins can archive a test'; end if;
  if new.title is distinct from old.title then raise exception 'Only admins and GTM leads can rename a test'; end if;
  if (new.notion_page_id, new.briefed_at) is distinct from (old.notion_page_id, old.briefed_at) then
    raise exception 'The Notion brief is set by the app only';
  end if;
  if (new.recommendation_id, new.call_commitment_id, new.content_idea_id, new.insight_key, new.carried_from_test_id, new.created_by_profile_id, new.created_at)
     is distinct from (old.recommendation_id, old.call_commitment_id, old.content_idea_id, old.insight_key, old.carried_from_test_id, old.created_by_profile_id, old.created_at) then
    raise exception 'Where a test came from and who created it can''t be changed';
  end if;
  return new;
end $$;
create trigger sprint_tests_guard before insert or update on public.sprint_tests for each row execute function public.guard_sprint_test_fields();

-- Check results: the numbers snapshot (auto_data) is computed on the server, and the Notion action
-- link is set by the app when it creates the action, so a red can't be marked "actioned" by hand.
create function public.guard_check_result_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.auto_data is not null or new.notion_action_page_id is not null then
      raise exception 'Check numbers and Notion actions are set by the app only';
    end if;
    return new;
  end if;
  if (new.auto_data, new.notion_action_page_id) is distinct from (old.auto_data, old.notion_action_page_id) then
    raise exception 'Check numbers and Notion actions are set by the app only';
  end if;
  if (new.check_run_id, new.check_definition_id) is distinct from (old.check_run_id, old.check_definition_id) then
    raise exception 'A check result can''t be moved';
  end if;
  return new;
end $$;
create trigger check_results_guard before insert or update on public.check_results for each row execute function public.guard_check_result_fields();

-- Sprints: anyone on the team closes a sprint; only admins reopen one (as in the app), and a sprint's
-- client, number and dates never change.
create function public.guard_sprint_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null or public.is_admin() then return new; end if;
  if old.closed_at is not null and new.closed_at is distinct from old.closed_at then
    raise exception 'Only admins can reopen a sprint';
  end if;
  if (new.client_id, new.number, new.start_date, new.end_date) is distinct from (old.client_id, old.number, old.start_date, old.end_date) then
    raise exception 'A sprint''s client, number and dates can''t be changed';
  end if;
  return new;
end $$;
create trigger sprints_guard before update on public.sprints for each row execute function public.guard_sprint_fields();

revoke execute on function public.guard_sprint_test_fields(), public.guard_check_result_fields(), public.guard_sprint_fields() from public, anon, authenticated;
