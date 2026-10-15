-- One create per ad per test per day, enforced by the database (Aikido, PR #16): two submissions of
-- the same ad at the same moment can't both get a log row, and without a log row nothing is sent to
-- Google Ads. The key is the test, the London day and a hash of the exact ad. A write that fails
-- clears its key so it can be tried again. Additive only.
alter table public.platform_write_log add column idempotency_key text;
create unique index platform_write_log_idempotency_idx on public.platform_write_log (idempotency_key) where idempotency_key is not null;
