-- Sprint tests can be archived, never deleted (Dean, 2026-09-30: DNSFilter's Sprint 1 tests were mock/test data).
-- An archived test is hidden from every signed-in read; admin-client reads filter archived_at themselves.
alter table public.sprint_tests add column archived_at timestamptz;

alter policy "sprint tests: read assigned" on public.sprint_tests
  using (public.can_access_client(client_id) and archived_at is null);
