-- Tests that came from "Pour a Sprint" carry the suggestion they came from (Dean), so we can
-- compile how Claude's suggestions do and tune the prompt. Carried-over copies keep the link.
alter table public.sprint_tests add column recommendation_id uuid references public.sprint_recommendations (id);
create index sprint_tests_recommendation_idx on public.sprint_tests (recommendation_id) where recommendation_id is not null;

update public.sprint_tests t set recommendation_id = r.id
from public.sprint_recommendations r
where r.sprint_test_id = t.id and t.recommendation_id is null;

-- One row per suggestion with what happened to it: decision, and (if approved) the test's
-- progress and outcome in every sprint it ran in. Runs with the caller's RLS.
create view public.recommendation_results with (security_invoker = true) as
select r.id as recommendation_id, r.client_id, r.sprint_id as suggested_in_sprint_id, r.run_id,
       r.platform, r.title, r.impact, r.confidence, r.effort, r.status as decision, r.reject_reason,
       r.created_at as suggested_at, r.decided_at,
       t.id as test_id, t.sprint_id as test_sprint_id, t.status as test_status, t.outcome, t.carry_reason,
       t.findings_worked, t.findings_blockers
from public.sprint_recommendations r
left join public.sprint_tests t on t.recommendation_id = r.id;
