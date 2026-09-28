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
- Notion: a single "master production board", not separate Clients/Actions/Briefs databases. Board views are *grouped* by a `Client` property, so a group is not a separate database. Visible properties: Project (title), Production Type (e.g. Landing Page, Campaign, Paid Media, Email, Blog), Client, Priority, Date of Brief, Project Lead (people), Vertical. The rows look like briefs/projects. Where action points live is still open. The mapping is pending `notion-inspect.ts`. The Source, created-by and check-link properties don't exist yet.
- Conversions: Google Ads uses conversions. LinkedIn and Meta use conversions plus leads.
- Currency: one per client. A mapped ad account must be in the client's currency.
- Metrics unique key: `(platform, external_account_id, date, ad_id)`. Rows with no ad use `ad_id = ''`.
- Budgets: monthly budget per client per platform, with optional per-campaign budgets. Pacing uses the campaign budget where one is set.
- Best/worst ad: rank by cost per conversion when at least 2 eligible ads have 3 or more conversions, otherwise by CTR. Eligible means spend strictly above the account's median ad spend over the last 7 days.
- Ad fatigue: "live" means impressions in the last 2 available days. First seen is capped at the backfill window (90 days) and shown as "90+".
- Periods: weeks run Monday to Sunday, Europe/London. Months are calendar months. A scheduled job creates check runs; one is also created on first open if missing.
- Red not actioned: 24 hours after `checked_at` with no `notion_action_page_id`. Flag-to records the person and appears in their "Flagged to me" list. Slack notifications come later.
- Scheduling: Vercel Hobby cron only runs once a day. Proposal: Supabase Cron (pg_cron + pg_net) calls the sync routes, with `CRON_SECRET`. Pending confirmation.

## Notion mapping (from notion-inspect, 2026-09-28, PROPOSED, pending confirmation)
- Source: data source **Master Production** `2716e9bb-1958-81b0-a4e2-000bf0330ac3` (database page `2716e9bb19588036bc5fe7bc7c46b71e`). The only other shared data source is "From Camber Internal Notion" (slide content). Ignore it.
- **Client is a `select` property ("Client"), not a relation.** So `clients.notion_client_option` (the exact option name, e.g. "Camber") replaces `clients.notion_page_id`. Mirrored rows resolve `client_id` by matching that name. Rows whose name has no match go to the admin "unmapped" list.
- Rows are briefs/projects, which drive the Briefs tab: title `Project`, `Production Type`, `Master Status` (status), `Priority`, `Project Lead`, `Date of Brief - Completion of Project`, `Description of Request`, parent/child via `Parent item` / `Child Item`.
- `Master Status` puts every option in the "To-do" group, so status groups can't mean open/closed. "Open" needs an explicit list of statuses.
- Relations pointing to databases that aren't shared (e.g. "Camber HQ", "DNS HQ") show up in rows but not in the schema. Ignore them.
- Actions created by the app would be new rows on this board (proposal). The field mapping for them is pending: see the open questions in chat.

## Windsor field mapping (from windsor-inspect, 2026-09-28. Numbers confirmed against the platforms by Dean)
| ours | linkedin | google_ads | facebook |
|---|---|---|---|
| campaign_id / name | `campaign_id` / `campaign` (an Ad Set in the LinkedIn UI) | `campaign_id` / `campaign` | `campaign_id` / `campaign` |
| ad_id / ad_name | `creative_id` / `sponsored_creative_content_title` (`ad_name` is deprecated) | `ad_id` / `ad_name` | `ad_id` / `ad_name` |
| spend | `spend` | `spend` | `spend` |
| impressions, clicks | `impressions`, `clicks` | `impressions`, `clicks` | `impressions`, `clicks` (`link_clicks` also available) |
| conversions | `externalwebsiteconversions` (? vs `conversions`) | `conversions` | no single field. Custom events differ per client |
| leads | `oneclickleads` | n/a | `actions_lead` (or `actions_leadgen_grouped` / `actions_onsite_conversion_lead_grouped`) |
- Responses are `{ data: [...] }` with numbers as numbers. Filter with `select_accounts=<id>`. The account IDs come from `onboard.windsor.ai/api/common/ds-accounts?datasource=...`.
- LinkedIn form fields (e.g. `lead_type`) can't be requested together with metrics. Windsor returns HTTP 400.
- Plan: store the conversion and lead field IDs **per `client_platform_accounts` row** (`conversion_fields`, `lead_fields` text[]), with the defaults above. Meta needs this.
- Accounts on the key: LinkedIn (Filevine, DNSFilter, Camber), Google Ads (DNSFilter, Camber), Facebook (Filevine, "DNSFilter X", Camber). Everything is in USD so far.
- Supabase uses the new keys: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`. The legacy anon and service_role keys are deprecated by the end of 2026.

## Look and feel (from bordeauxandburgundy.com)
- Fonts: **MADE Avenue** (serif) for headings, falling back to Georgia. **Helvetica Neue** (400/700) for UI and body text, falling back to Helvetica and Arial. Small uppercase labels use letter-spacing of 0.1–0.2em.
- The MADE Avenue and Helvetica Neue files are licensed fonts. Get them, and confirm the licence covers this app, from the B&B web team. Until then, use the fallbacks.
- Colours: ink `#111111` / `#1a1a1a`, white, warm off-white surfaces `#f0eeea` / `#e8e6e0`, signature lime accent `#e4ff1a` (buttons, highlights). Secondary palette: pinks and purples `#e84fcf` `#e0359a` `#cc50e8` and lavenders `#b8bae8` `#9496d0` `#6a6db8`.
- The site is black with lime. The app is dense with data, so use a black header/nav with lime accents, and warm off-white content areas for tables (pending confirmation).
- Never use lime to mean "green" status. RAG colours must stay clearly separate from the brand accent.

## Conventions
- Small steps, one commit per working step, clear messages.
- Tests only for the Notion write function (mocked) and pacing. Use Vitest.
- If anything about the Notion schema or Windsor fields is ambiguous, ask. Don't guess.
- Keep this file current when a decision changes.
