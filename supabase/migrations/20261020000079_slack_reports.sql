-- Weekly Slack snapshot (Dean, 2026-10-20): every Monday from 08:00 London, one post per client with ad
-- data, 10 minutes apart, to the reporting channel (clients.slack_channel overrides it per client).
-- Slack is for these reports only; the earlier notifications (feedback, Notion actions, call reminders)
-- were taken out.
--
-- slack_posts logs every post, written by the server only (admin client), read by admins. A row is
-- written before Slack is called ('sending'), then marked sent, failed or dry_run. One scheduled post
-- per client per week: the unique index refuses a second while one is sending or sent. Manual sends
-- from Admin (tests) don't count. No deletes.
create table public.slack_posts (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients (id),
  kind text not null default 'weekly_snapshot' check (kind in ('weekly_snapshot')),
  period_start date not null,        -- the Monday of the week reported on
  period_end date not null,          -- its Sunday
  channel text,
  manual boolean not null default false,
  status text not null check (status in ('sending', 'sent', 'failed', 'dry_run')),
  slack_ts text,                     -- the message's timestamp in Slack, once sent
  message jsonb,                     -- what was sent (text and blocks)
  error text,
  sent_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index slack_posts_once_idx on public.slack_posts (client_id, kind, period_start)
  where not manual and status in ('sending', 'sent', 'dry_run');
create index slack_posts_recent_idx on public.slack_posts (created_at desc);

alter table public.slack_posts enable row level security;
create policy "slack posts: admins read" on public.slack_posts for select to authenticated using (public.is_admin());

-- Every 10 minutes on Monday mornings (UTC). 07:00-10:50 UTC covers 08:00 London in summer and winter
-- time; the route itself waits until 08:00 London and sends one client per call, so posts land
-- 10 minutes apart. Uses the same Vault secrets as the other jobs (cron_secret, app_url).
select cron.schedule(
  'slack-weekly-report',
  '*/10 7-10 * * 1',
  $$
  select net.http_get(
    url := coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'app_url'), 'https://bbmopsapp.vercel.app') || '/api/cron/slack-report',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    timeout_milliseconds := 120000
  );
  $$
);
