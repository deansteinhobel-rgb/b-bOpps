# B&B Account Ops

An internal web app for Bordeaux & Burgundy. For each client it shows paid media performance (from Windsor.ai), runs the weekly and monthly QA checks, and shows and creates action points in Notion. Notion stays the system of record.

**Current phase: 0 (discovery).** Only the throwaway scripts in `/scripts` exist. Don't write app code until the Notion and Windsor mappings are confirmed.

## The client is the spine
Every page, query, table and RLS policy is scoped by `client_id`. In v1 the client list is the only view that spans clients. If a new query or table isn't client-scoped, stop and ask.

## Stack (decided)
- Next.js (latest stable, App Router), TypeScript, Tailwind, shadcn/ui, pnpm (run it through `corepack pnpm` on this machine).
- Supabase: Postgres, Auth (magic link, `@bordeauxandburgundy.co.uk` only) and RLS on every table. Migrations live in the repo (`supabase/migrations`).
- `@notionhq/client` v5 with `notionVersion: "2026-03-11"`. A database contains data sources. Query `dataSources.query`, not databases. Use `iterateAllDataSourceRows` for full reads (plain pagination stops at 10k rows).
- Windsor.ai REST only (`connectors.windsor.ai/{linkedin|google_ads|facebook}`). Never call the LinkedIn, Google Ads or Meta APIs directly.
- HubSpot: stubbed. Slack: on hold. Build the post function, but it does nothing unless `SLACK_WEBHOOK_URL` is set.
- Vercel (Hobby for now) for hosting.
- All third-party keys stay server-side. Nothing secret goes in a `NEXT_PUBLIC_` variable.

## Notion write-side rules (strict)
- The app writes to Notion in one way only: **creating an action page** with the mapped properties. Updating status on pages the app created is **off in v1** (pending confirmation, because the team changes statuses by hand once work is verified).
- No deletes, ever. No edits to pages the app didn't create.
- Every write goes through one server-side function. It logs to `notion_write_log` first, calls Notion, updates the log with the result, then upserts `notion_pages_mirror`.
- `NOTION_DRY_RUN=true` means log only. It defaults to true in development.
- The UI reads the mirror, never Notion live. Show "synced X minutes ago" and an "Open in Notion" link. Properties only, no page bodies.

## Decisions from Phase 0 answers (2026-09-28)
- First admin: dean.steinhobel@bordeauxandburgundy.co.uk. Other new users get a profile with no role until an admin assigns one.
- Notion: a single "master production board", split by client, not separate Clients/Actions/Briefs databases. The mapping is pending `notion-inspect.ts`. The Source, created-by and check-link properties don't exist yet.
- Conversions: Google Ads uses conversions. LinkedIn and Meta use conversions plus leads.
- Currency: one per client. A mapped ad account must be in the client's currency.
- Metrics unique key: `(platform, external_account_id, date, ad_id)`. Rows with no ad use `ad_id = ''`.
- Budgets: monthly budget per client per platform, with optional per-campaign budgets. Pacing uses the campaign budget where one is set.
- Best/worst ad: rank by cost per conversion when at least 2 eligible ads have 3 or more conversions, otherwise by CTR. Eligible means spend strictly above the account's median ad spend over the last 7 days.
- Ad fatigue: "live" means impressions in the last 2 available days. First seen is capped at the backfill window (90 days) and shown as "90+".
- Periods: weeks run Monday to Sunday, Europe/London. Months are calendar months. A scheduled job creates check runs; one is also created on first open if missing.
- Red not actioned: 24 hours after `checked_at` with no `notion_action_page_id`. Flag-to records the person and appears in their "Flagged to me" list. Slack notifications come later.
- Scheduling: Vercel Hobby cron only runs once a day. Proposal: Supabase Cron (pg_cron + pg_net) calls the sync routes, with `CRON_SECRET`. Pending confirmation.

## Conventions
- Small steps, one commit per working step, clear messages.
- Tests only for the Notion write function (mocked) and pacing. Use Vitest.
- If anything about the Notion schema or Windsor fields is ambiguous, ask. Don't guess.
- Keep this file current when a decision changes.
