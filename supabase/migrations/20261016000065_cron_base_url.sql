-- Supabase Cron reads the app's address from Vault (account move prep, 2026-10-16;
-- docs/account-move.md), so a new domain is a Vault change, not a migration.
-- Re-schedules the two hourly jobs under their existing names (cron.schedule with a known name
-- replaces the job's command). Until a Vault secret named 'app_url' exists they keep calling
-- https://bbmopsapp.vercel.app, exactly as today, so running this changes nothing on its own.
-- To point them somewhere else later, in the SQL editor:
--   select vault.create_secret('https://<new domain>', 'app_url');
-- (or vault.update_secret on its id if it already exists). No trailing slash.

select cron.schedule(
  'notion-sync-hourly',
  '5 * * * *',
  $$
  select net.http_get(
    url := coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'app_url'), 'https://bbmopsapp.vercel.app') || '/api/cron/notion',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    timeout_milliseconds := 60000
  );
  $$
);

select cron.schedule(
  'call-notes-hourly',
  '35 * * * *',
  $$
  select net.http_get(
    url := coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'app_url'), 'https://bbmopsapp.vercel.app') || '/api/cron/calls',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    timeout_milliseconds := 60000
  );
  $$
);
