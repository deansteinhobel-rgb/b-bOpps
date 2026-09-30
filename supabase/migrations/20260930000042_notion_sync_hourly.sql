-- Hourly Notion mirror sync via Supabase Cron (Dean, 2026-09-30), so sprint tests follow their
-- Notion brief within the hour. Vercel Hobby cron only runs once a day; the Vercel 03:00 job stays.
-- The call is read-only towards Notion (the route uses the guarded client).
-- The bearer token is read from Vault at run time: store it once in the SQL editor with
--   select vault.create_secret('<CRON_SECRET from Vercel>', 'cron_secret');
-- Until that secret exists the route answers 401 and nothing happens.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'notion-sync-hourly',
  '5 * * * *',
  $$
  select net.http_get(
    url := 'https://bbmopsapp.vercel.app/api/cron/notion',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    timeout_milliseconds := 60000
  );
  $$
);
