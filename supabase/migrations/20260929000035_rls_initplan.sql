-- Supabase performance advisor (lint 0003): call auth.uid() once per query, not once per row, by
-- wrapping it in a sub-select. Same rules, same results.
alter policy "profiles: team reads" on public.profiles using (id = (select auth.uid()) or public.has_role());
alter policy "profiles: own details" on public.profiles using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter policy "write log: read own or admin" on public.notion_write_log using (public.is_admin() or profile_id = (select auth.uid()));
alter policy "insight actions: team logs" on public.insight_actions with check (public.can_access_client(client_id) and profile_id = (select auth.uid()));
alter policy "feedback: own or admin reads" on public.feedback using (profile_id = (select auth.uid()) or public.is_admin());
alter policy "feedback: anyone with a role sends" on public.feedback with check (profile_id = (select auth.uid()) and public.has_role());
