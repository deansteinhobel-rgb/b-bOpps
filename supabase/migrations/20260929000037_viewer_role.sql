-- Viewer role (Dean, 2026-09-29): everyone in B&B's Notion workspace can use the app read-only.
-- Viewers see every client; they can't create or change anything (checks, sprints, tests, change
-- log, notes, insights). Comparisons use role::text so the new enum value isn't needed in this
-- transaction.
alter type public.app_role add value if not exists 'viewer';

create or replace function public.is_viewer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role::text = 'viewer');
$$;

-- Read access: admins, GTM leads and viewers see every client; others see their teams.
create or replace function public.can_access_client(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or public.is_viewer() or exists (
    select 1 from public.client_team
    where client_id = cid and profile_id = auth.uid() and removed_at is null
  );
$$;

-- Write access: read access, and not a viewer.
create or replace function public.can_edit_client(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_access_client(cid) and not public.is_viewer();
$$;

revoke execute on function public.is_viewer(), public.can_edit_client(uuid) from public, anon;
grant execute on function public.is_viewer(), public.can_edit_client(uuid) to authenticated;

-- Every team write policy now needs edit access.
alter policy "results: team creates" on public.check_results with check (public.can_edit_client(client_id));
alter policy "results: team updates" on public.check_results using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));
alter policy "runs: team creates" on public.check_runs with check (public.can_edit_client(client_id));
alter policy "briefs: team corrects" on public.client_briefs with check (public.can_edit_client(client_id) and written_by = 'person');
alter policy "knowledge: team adds notes" on public.client_knowledge with check (public.can_edit_client(client_id) and source = 'note');
alter policy "knowledge: team edits notes" on public.client_knowledge using (public.can_edit_client(client_id) and source = 'note') with check (public.can_edit_client(client_id) and source = 'note');
alter policy "insight actions: team logs" on public.insight_actions with check (public.can_edit_client(client_id) and profile_id = (select auth.uid()));
alter policy "sprint changes: team creates" on public.sprint_changes with check (public.can_edit_client(client_id));
alter policy "sprint changes: team updates" on public.sprint_changes using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));
alter policy "sprint items: team creates" on public.sprint_items with check (public.can_edit_client(client_id));
alter policy "sprint items: team updates" on public.sprint_items using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));
alter policy "sprint tests: team creates" on public.sprint_tests with check (public.can_edit_client(client_id));
alter policy "sprint tests: team updates" on public.sprint_tests using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));
alter policy "sprints: team creates" on public.sprints with check (public.can_edit_client(client_id));
alter policy "sprints: team updates" on public.sprints using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));
