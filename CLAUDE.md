# B&B Account Ops

An internal web app for Bordeaux & Burgundy. For each client it shows paid media performance (from Windsor.ai), runs the weekly and monthly QA checks, and shows and creates action points in Notion. Notion stays the system of record.

**Current phase: 1 (build).** Phase 0 is complete: the Notion and Windsor mappings are confirmed (2026-09-28). The check wording in `seed/checks.md` is a draft Dean is still editing.

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

## NO WRITES TO NOTION WHILE TESTING. NOTHING GETS DELETED. (Dean, 2026-09-28)
- Nothing may write to the real Notion workspace during development or testing. That covers scripts, dev servers, tests and one-off checks.
- Scripts use `scripts/notion-readonly.ts`, which throws on any create, update, append, delete, move, comment or upload call. Never use `new Client()` directly.
- In the app, a real write needs `NOTION_WRITES_ENABLED=true` **and** `NOTION_DRY_RUN=false`. Both default to the safe value. Dean alone decides when to switch them. Never change them from the safe values yourself, in `.env.local` or anywhere else.
- Tests use a mocked Notion client only.
- Deletes are never allowed in any environment. There is no delete code path.

## Notion write-side rules (strict)
- The app writes to Notion in one way only: **creating an action page** with the mapped properties. Updating status on pages the app created is **off in v1** (pending confirmation, because the team changes statuses by hand once work is verified).
- No deletes, ever. No edits to pages the app didn't create.
- Every write goes through one server-side function. It logs to `notion_write_log` first, calls Notion, updates the log with the result, then upserts `notion_pages_mirror`.
- `NOTION_DRY_RUN=true` means log only. It defaults to true in development.
- The UI reads the mirror, never Notion live. Show "synced X minutes ago" and an "Open in Notion" link. Properties only, no page bodies.

## Decisions from Phase 0 answers (2026-09-28)
- First admin: dean.steinhobel@bordeauxandburgundy.co.uk. Other new users get a profile with no role until an admin assigns one.
- Notion: a single "Master Production" board, grouped by a `Client` select. See "Notion mapping" below.
- **Data model change: `client_team` (client_id, profile_id, role) replaces `clients.am_profile_id` / `pm_profile_id` / `specialist_profile_id`.** Reason: DNSFilter and Camber each have two AMs (Danny and Kieran). RLS scopes by membership of `client_team`. Roles: `admin | gtm_lead | am | specialist`. **`gtm_lead` oversees all performance marketing and has admin rights**, seeing every client (Dean, 2026-09-28). The paid media specialist (Andrea) owns the checks by default. There is no PM role; each check's owner is set in `seed/checks.md`.
- Team: DNSFilter: Dean (GTM lead), Andrea (specialist), Danny and Kieran (AM). Camber: Esa (GTM lead), Andrea, Danny and Kieran. Details are in `seed/clients.json`.
- KPI: `cost_per_result` = spend / (conversions + leads). Targets: DNSFilter $300, Camber $200. Budgets are in the seed file.
- Conversions: Google Ads uses conversions. LinkedIn and Meta use conversions plus leads.
- Currency: one per client. A mapped ad account must be in the client's currency.
- Metrics unique key: `(platform, external_account_id, date, campaign_id, ad_id)`. Rows with no ad use `ad_id = ''`; campaign_id is included so campaign-level rows don't collide.
- Schema: `supabase/migrations`. Test RLS offline with `pnpm test:db` (in-memory Postgres; never touches the real project). Team roles come from `team_invites` / `client_team_invites` on first sign-in, so nobody creates accounts for others.
- Budgets: **per month** (`client_budgets`: client_id, platform, campaign_id nullable, month, amount). Budgets vary month to month (e.g. leftover Q3 budget spent in September). A new month copies the previous month's figures until someone edits them. Optional per-campaign budgets; pacing uses the campaign budget where one is set. The seed file's budgets are the default monthly amounts. September 2026 pacing (DNSFilter LinkedIn 135%, Google 127%; Camber Meta 133%) is intentional, per Dean.
- Best/worst ad: rank by cost per conversion when at least 2 eligible ads have 3 or more conversions, otherwise by CTR. Eligible means spend strictly above the account's median ad spend over the last 7 days.
- Ad fatigue: "live" means impressions in the last 2 available days. First seen is capped at the backfill window (90 days) and shown as "90+".
- Periods: weeks run Monday to Sunday, Europe/London. Months are calendar months. A scheduled job creates check runs; one is also created on first open if missing.
- Red not actioned: 24 hours after `checked_at` with no `notion_action_page_id`. A red can't be saved without findings (they pre-fill the Notion action). Saving snapshots the pre-loaded numbers into `auto_data`, recomputed on the server; saved checks show that snapshot, unsaved ones show live numbers. Flag-to records the person and appears in their "Flagged to me" list. Slack notifications come later.
- Scheduling: Vercel Hobby cron only runs once a day. Proposal: Supabase Cron (pg_cron + pg_net) calls the sync routes, with `CRON_SECRET`. Pending confirmation.

## Notion mapping (from notion-inspect, 2026-09-28. Confirmed by Dean)
- Source: data source **Master Production** `2716e9bb-1958-81b0-a4e2-000bf0330ac3` (database page `2716e9bb19588036bc5fe7bc7c46b71e`). The only other shared data source is "From Camber Internal Notion" (slide content). Ignore it.
- **Client is a `select` property ("Client"), not a relation.** So `clients.notion_client_option` (the exact option name, e.g. "Camber") replaces `clients.notion_page_id`. Mirrored rows resolve `client_id` by matching that name. Rows whose name has no match go to the admin "unmapped" list.
- Rows are briefs/projects, which drive the Briefs tab: title `Project`, `Production Type`, `Master Status` (status), `Priority`, `Project Lead`, `Date of Brief - Completion of Project`, `Description of Request`, parent/child via `Parent item` / `Child Item`.
- `Master Status` puts every option in the "To-do" group, so status groups can't mean open/closed. "Open" needs an explicit list of statuses.
- Relations pointing to databases that aren't shared (e.g. "Camber HQ", "DNS HQ") show up in rows but not in the schema. Ignore them.
- **No new properties or select options, ever.** They would disrupt B&B's Notion automations. Use existing properties only.
- Actions created by the app are new rows on this board:
  | app | Notion property | value |
  |---|---|---|
  | title | `Project` (title) | e.g. "Camber: LinkedIn overspend 24%" |
  | client | `Client` (select) | the client's exact option name |
  | owner | `Project Lead` (people) | the chosen profile's notion_user_id |
  | due date | `Date of Brief - Completion of Project` (date) | |
  | status on create | `Master Status` (status) | "New" |
  | type | `Production Type` (select) | "Paid Media" (existing option; no new options allowed) |
  | created-by | `Brief Submitted by` (text) | "B&B Ops app · {full name}" (this prefix marks app-created rows) |
  | findings | `Description of Request` (text) | the check's findings |
  | link back | `QA Document` (url) | the check result's URL in the app |
- Closed = `Master Status` "Production Complete". Every other status counts as open.
- Briefs tab: the client's rows, sub-items nested under `Parent item`, sorted by due date. "Production Complete" is hidden behind a "Show completed" toggle.
- v1 clients: **Camber** and **DNSFilter**.

## Windsor field mapping (from windsor-inspect, 2026-09-28. Numbers confirmed against the platforms by Dean)
| ours | linkedin | google_ads | facebook |
|---|---|---|---|
| campaign_id / name | `campaign_id` / `campaign` (an Ad Set in the LinkedIn UI) | `campaign_id` / `campaign` | `campaign_id` / `campaign` |
| ad_id / ad_name | `creative_id` / `sponsored_creative_content_title` (`ad_name` is deprecated) | `ad_id` / `ad_name` | `ad_id` / `ad_name` |
| spend | `spend` | `spend` | `spend` |
| impressions, clicks | `impressions`, `clicks` | `impressions`, `clicks` | `impressions`, `clicks` (`link_clicks` also available) |
| conversions | `externalwebsiteconversions` | `conversions` (primary actions; `all_conversions` includes secondary) | per client: DNSFilter `conversions_offsite_conversion_fb_pixel_custom_marketingqualifiedlead`; Camber none (pending) |
| leads | `oneclickleads` (not `oneclickleadformopens`) | n/a (search = conversions only) | `actions_lead` |
- Responses are `{ data: [...] }` with numbers as numbers. Filter with `select_accounts=<id>`. The account IDs come from `onboard.windsor.ai/api/common/ds-accounts?datasource=...`.
- LinkedIn form fields (e.g. `lead_type`) can't be requested together with metrics. Windsor returns HTTP 400.
- Rule (Dean): use the conversion field that has data over the last 14 days. See `pnpm scan:conversions`. 14-day scan (to 2026-09-27): LinkedIn externalwebsiteconversions Camber 1 / DNSF 32, oneclickleads 4 / 7; Google conversions 1 / 151.08; Meta actions_lead 14 / 25, DNSF MQL custom event 24. Meta `custom_conversion_action_count` (2232 / 3904) is implausibly high. Excluded, pending Dean.
- LinkedIn: its account-level spend differs slightly (<1%) from the sum of its campaigns and creatives (e.g. Camber Sept +$76, DNSFilter −$71). We store campaign/creative-level rows, which match LinkedIn's campaign breakdown exactly.
- Windsor backfill of 90 days takes ~6 minutes for 6 accounts: too long for one Vercel request, so the admin backfill must run in chunks.
- Google Ads refuses some field combinations in one request (HTTP 400). Request segment-type conversion fields separately.
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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
