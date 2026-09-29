# Sauvignon Blanc (B&B Account Ops)

An internal web app for Bordeaux & Burgundy. For each client it shows paid media performance (from Windsor.ai), runs the weekly and monthly QA checks, and shows and creates action points in Notion. Notion stays the system of record.

**Current phase: 1 (build).** Phase 0 is complete: the Notion and Windsor mappings are confirmed (2026-09-28). The check wording in `seed/checks.md` is a draft Dean is still editing.

## The client is the spine
Every page, query, table and RLS policy is scoped by `client_id`. In v1 the client list is the only view that spans clients. If a new query or table isn't client-scoped, stop and ask.

## Stack (decided)
- Next.js (latest stable, App Router), TypeScript, Tailwind, shadcn/ui, pnpm (run it through `corepack pnpm` on this machine).
- Supabase: Postgres, Auth (magic link, `@bordeauxandburgundy.co.uk` only) and RLS on every table. Migrations live in the repo (`supabase/migrations`).
- `@notionhq/client` v5 with `notionVersion: "2026-03-11"`. A database contains data sources. Query `dataSources.query`, not databases. Use `iterateAllDataSourceRows` for full reads (plain pagination stops at 10k rows).
- Windsor.ai REST only (`connectors.windsor.ai/{linkedin|google_ads|facebook}`). Never call the LinkedIn, Google Ads or Meta APIs directly.
- Claude (Anthropic API, `@anthropic-ai/sdk`, key `ANTHROPIC_API_KEY`, plus `ANTHROPIC_WORKSPACE_ID` when the key isn't scoped to a workspace, sent as the `anthropic-workspace-id` header; server-side only): sprint suggestions use `claude-opus-5-5`, the news chat uses `claude-sonnet-5`, both with the web search and web fetch server tools. See "Claude in the app" below.
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
- The app only ever **creates** Master Production pages, of two kinds: **an action** (from a red check or the New action form) and **a sprint test brief** (one row per test, Dean 2026-09-28). Both use the same properties and existing options. Updating status on pages the app created is **off in v1** (pending confirmation, because the team changes statuses by hand once work is verified).
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
- Ad fatigue: "live" means impressions in the last 2 available days. First seen is capped at the backfill window (90 days) and shown as "90+". **Overview tiles (Dean): every live ad compares its first 14 days with its last 14 days**, CTR or cost per result (toggle). First seen is red when over 30 days ago (`AD_OLD_DAYS`); the last-14 value is red when worse. Only compared once the windows don't overlap (27+ days) and the first 14 days are in our data. The fatigue *check* still lists live ads 45+ days old (seed/checks.md).
- Periods: weeks run Monday to Sunday, Europe/London. Months are calendar months. A scheduled job creates check runs; one is also created on first open if missing.
- Red not actioned: 24 hours after `checked_at` with no `notion_action_page_id`. A red can't be saved without findings (they pre-fill the Notion action). Saving snapshots the pre-loaded numbers into `auto_data`, recomputed on the server; saved checks show that snapshot, unsaved ones show live numbers. Flag-to records the person and appears in their "Flagged to me" list. Slack notifications come later.
- Scheduling: Vercel Hobby cron only runs once a day. Proposal: Supabase Cron (pg_cron + pg_net) calls the sync routes, with `CRON_SECRET`. Pending confirmation.

## Notion mapping (from notion-inspect, 2026-09-28. Confirmed by Dean)
- Source: data source **Master Production** `2716e9bb-1958-81b0-a4e2-000bf0330ac3` (database page `2716e9bb19588036bc5fe7bc7c46b71e`). **This is the only Notion database the app ever writes to** (Dean). **Exception for reading (Dean, 2026-09-29): each client's GTM HQ page tree in B&B's Notion (e.g. "Camber GTM HQ", "DNSFilter GTM HQ") may be read, never written, to feed the Client brain.** The same no-writes, no-deletes rule applies to them. The connection can also see "From Camber Internal Notion". Never use it.
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
- Actions tab = rows the app created (`created_by_app`, via the "B&B Ops app · " prefix); Briefs tab = every other row. Action owners are picked by Notion user from profiles plus `team_invites`, so people who haven't signed in yet can own actions.
- Briefs tab shows **paid media only** by default (Dean): Production Type "Paid Media" or "Google Ad Campaign", or "Status Paid" set to anything but N/A, plus sub-items of a matching parent. A "Show all briefs" toggle shows the rest.
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
- Windsor backfill of 90 days takes ~6 minutes for 6 accounts, too long for one Vercel request. The admin "Backfill 90 days" runs one account × 30-day window per request (~6s each), driven from the browser.
- Google Ads refuses some field combinations in one request (HTTP 400). Request segment-type conversion fields separately.
- Plan: store the conversion and lead field IDs **per `client_platform_accounts` row** (`conversion_fields`, `lead_fields` text[]), with the defaults above. Meta needs this.
- Accounts on the key: LinkedIn (Filevine, DNSFilter, Camber), Google Ads (DNSFilter, Camber), Facebook (Filevine, "DNSFilter X", Camber). Everything is in USD so far.
- Supabase uses the new keys: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`. The legacy anon and service_role keys are deprecated by the end of 2026.

## Look and feel: "Sauvignon Blanc" by Bordeaux & Burgundy (2026-09-28)
- The app is called **Sauvignon Blanc**, endorsed "by Bordeaux & Burgundy" (`AppMark` in `src/components/brand.tsx`). It's **dark, like bordeauxandburgundy.com**: background #0a0a0a, cards #121212, borders #242424, warm off-white text, **lime #e4ff1a as the primary accent** (primary buttons are lime with ink text), secondary pinks, purples and lavenders.
- Fonts: MADE Avenue (serif, falling back to Georgia) for h1/h2 page and section titles only. Everything else uses Helvetica Neue (falling back to Arial). h3 is sans semibold. The font files are licensed: get them from the B&B web team.
- Modern SaaS layout: a **left sidebar** (app mark, Clients, Learnings, Admin, the client list with logos, the profile) that becomes a top bar with a menu under `lg`. Pages use `PageHeader` / `SectionHeader`. Prefer one `surface` container with `divide-y` rows over boxes inside boxes. Put detail behind expandable rows (see /learnings).
- Branding components: `ClientLogo` (clients.logo_url, initials otherwise; `pnpm fetch:logos` saves website icons to the public "brand" bucket, and Admin can set a logo URL), `PlatformIcon` / `PlatformLabel` (LinkedIn, Google Ads, Meta marks). Use them wherever a client or platform is named.
- Creatives: `AdThumb` shows a large hover preview (base-ui preview card, in a portal so tables don't clip it).
- RAG colours are tuned for dark (#4ade80 / #fbbf24 / #f87171 with 12% backgrounds) and never use lime.
- `/design` is a **development-only** preview with sample data, used to check the look without signing in. It 404s in production.

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

## Ad previews (built 2026-09-28)
- `ad_creatives` holds each ad's latest Windsor image URL, Meta preview link and ad type. Images are copied once into the private `ad-previews` bucket at `<client_id>/<platform>/<ad_id>.<ext>`. Meta and LinkedIn URLs expire after about a week, so we always show our copy, via signed URLs (1 hour) under storage RLS.
- Fields: LinkedIn `creative_thumbnail`; Meta `image_url`/`thumbnail_url` + `ad_preview_shareable_link`; Google `ad_image_ad_image_url`, `ad_responsive_display_ad_marketing_images_1`, `ad_multi_asset_ad_marketing_images_1`. Google search ads are text only: we store their copy in `ad_creatives.text_ad` (`ad_responsive_search_ad_headlines` / `_descriptions` / `_path1` / `_path2`, `ad_final_urls`, fetched in a separate request) and draw a **mock Google result** (`SearchAdMock` in `ad-thumb.tsx`: pinned headlines in their slots, then the rest in order). Windsor has no image for **LinkedIn document ads** (`NATIVE_DOCUMENT`, via `creative_content_data_share_ad_context_ad_type`) or **Google Demand Gen multi-asset ads** (asset IDs only, no URLs), so those show their ad type instead.
- Windsor's LinkedIn preview lookups are slow (~3 min for 90 days on DNSFilter). Daily: `/api/cron/creatives` (last 3 days, max 40 new images). Admin backfill: previews for the last 14 days in 7-day windows. First fill: `pnpm sync:creatives --days 90`.
- Check snapshots store ad keys (`auto_data.adKeys`), never image URLs, so they don't go stale.

## Admin (/admin)
- /admin/clients: client list, new client, **unmapped Notion pages** grouped by Client option. /admin/clients/[slug]: details, team, ad accounts (picked from the Windsor key's account list), conversion/lead fields per account, budgets by month (this month and next), chunked backfill.
- /admin/people: app roles for signed-in people, and invites (role + Notion user) for people who haven't signed in yet.
- Saving a client re-links mirrored Notion pages with that Client option straight away. This is our database only; Notion isn't touched.
- Removing someone from a team sets `removed_at` (soft). RLS and sign-up ignore removed rows. There are still no DELETE policies.

## Sprints: the main loop of the app (Dean, 2026-09-28)
- Two-week sprints, **the same fortnight for every client**, on alternate Mondays from **Sprint 1 = Mon 28 Sep 2026** (`src/lib/sprints/periods.ts`). One sprint per client.
- **The unit is a test** (`sprint_tests`). The flow, shown as a board on the Sprint tab:
  1. **Planned** on the sprint's first Monday: platform, what we're testing, assets to brief in, what success looks like (metric + target and/or words), owner, deadline.
  2. **Brief the team**: creates ONE Master Production row via `createNotionAction` (operation `create_test_brief`, Production Type "Paid Media", status "New", Project Lead = owner, due = deadline, the full plan in Description, QA Document = link to the test). Dry run by default like every Notion write.
  3. **Ready to launch** happens automatically when the brief's Master Status is **"Client Approved" or "Production Complete"** (`READY_STATUSES`). The card shows "what we created" from the brief's links (Figma Board, Campaign Folder, Brief Uploads / Links, Useful Links, Proposal Deck). In test mode, or for a brief made outside the app, "Mark ready" does it by hand.
  4. **Mark live**: live date plus the campaigns it runs in (picked from Windsor), so results vs the success target are measured automatically (`campaign_totals`).
  5. **Findings**: what worked, the blocker, notes.
  6. **Outcome**: proven / disproven / inconclusive, or **carried over** with a reason (deadline, setup time, too short live, awaiting approval, other). Carried tests are copied, with their progress, into the next sprint (`carryTests`).
- The **sprint review fills itself in from the tests** (highlights = live tests + numbers, top learnings = "what worked", challenges = blockers, mitigation = carry-overs, progress = counts). The team only writes the key takeaway. Closing needs a key takeaway, and every test called or carried.
- The change log (with Windsor-detected suggestions) and the red checks / Notion actions sit in collapsed sections below. `/learnings` = every called test with its findings, across sprints and clients.
- The old sprint_items (goal, hypotheses, learnings, mitigations) are still in the schema but no longer in the UI.
- History before the app lives in a closed **Sprint 0** per client (`seed/history.json`, `pnpm seed:history`, safe to re-run). DNSFilter entries are real (Dean). **Camber entries are MOCK, titles "Mock:"**, to be replaced with real findings from Esa.
- No deletes anywhere. Tables `sprints`, `sprint_tests`, `sprint_changes`, `sprint_items` (RLS by client team).

## UX patterns (2026-09-28)
- **Status is colour only** (Dean): green/amber/red render as a coloured dot (`StatusBadge` with no label, or `StatusDot`). The colour name is kept for screen readers and tooltips. Words only when they add meaning ("Proven", "On target", "N/A", "No budget").
- **Checks are a stacked deck** (`checks/check-deck.tsx`): the current check in front with the next two peeking behind it. Saving slides it away and brings the next forward, "Skip for now" moves it to the back, the done pile can be reopened, and there's a List view as a fallback.
- **Budget pacing panel** on the Overview (`pacing-panel.tsx`): sliders show spend against the month's budget, a marker for where spend should be today, and a 100% marker. By platform, or by campaign (filterable by platform). **Edit / Set budget** writes this month's `client_budgets` row (platform: campaign_id ''; campaign: its id). Admins and GTM leads only (RLS), and it invalidates the cached numbers.
- **Ad fatigue** is a grid of compact tiles (`fatigue-panel.tsx`): platform logo, ad preview, first seen, first vs last 14 days (name on hover and in the detail). Click one to expand the detail (both windows, change, preview).
- **Briefs** are grouped into stages by Master Status (In production, With the client, Approved, Not started, On hold, Done), with a summary strip, status pills, type chips, lead avatars, relative due dates (overdue in red) and expandable sub-items.
- **Easter eggs from the website hero** (`src/components/fx`): `ParticleAmpersand` (lime dot "&" that scatters from the cursor: login, the clients header, "all checks done"), `Starfield` (faint background), `Sparkle` (specks around primary buttons on hover). All pause when hidden and respect reduced motion. Keep them subtle and rare.

## Claude in the app (Dean, 2026-09-28)
- **"Pour me a sprint"** (Sprint tab, `sprint/ai-panel.tsx`): Claude suggests 3–5 tests for the sprint. It reads a compact brief (`src/lib/ai/context.ts`: 12 weeks of weekly numbers per platform, pacing, top campaigns, best/worst ads, fatigue, every past test with outcome and findings, this sprint's plan, logged changes, earlier approved/rejected suggestions with reasons), then researches B2B paid media trends and platform news (Google, Bing, LinkedIn, Meta, Reddit, ChatGPT Ads, X) with web search, and submits through a `submit_sprint_plan` tool (`src/lib/ai/generate.ts`).
- Runs in the background (`POST /api/sprint-ai` + `after()`, maxDuration 300s). Progress is stored on `sprint_ai_runs` and fills the wine glass (`WinePour`); the page polls `GET /api/sprint-ai?run=`.
- **Layout** (Dean: less clutter, clear priority): a ranked review queue like Linear triage / Google Ads recommendations. Tabs (To review, Approved, Rejected), a list ranked by impact ×3 + confidence ×2 − effort (#1 = "Top pick"; "Quick win" = low effort; "Bold bet" = low confidence or unconnected platform), and a detail pane: title and one-line summary, 2–3 key-number tiles, expected impact beside what success looks like, impact/confidence/effort meters, then the long text folded into sections, sources as favicon chips, and one clear next step in a sticky footer. Claude returns `summary`, `impact`, `expected_impact` and `evidence` for this.
- **Before the first pour** it's a small banner that should pop (Dean): travelling lime/violet glow border (`.pour-border`), a resting glass that pours on hover (`WinePour hoverPour` inside `group/pour`), and `PourButton`, which fills with wine from the bottom on hover. Keep hovering and it fills to the brim (~2s), spills down the glass to a puddle (~4s), then drips off the banner onto the "Tests this sprint" heading (`Drips`, sized for the page's 40px `space-y-10` gap). Leaving drains it; reduced motion skips it. No "Claude" or "sommelier" labels. Once suggestions exist the heading is **"Your suggested sprints"**.
- **Money is always a symbol** ($, £, €), never "USD"/"GBP" (Dean): `currencySymbol` / `withSymbols` in `src/lib/format.ts`; Claude is told to write symbols and its text is also passed through `withSymbols`.
- **Review → approve** (Dean): suggestions start as Draft; Review (edit) marks them Reviewed; Approve (owner + deadline) creates a Planned `sprint_test`; Reject needs a reason, which Claude reads next time. **GTM leads and admins only** (RLS `is_admin()`); the client's team can read. Nothing goes to Notion until "Brief the team" on the planned test (still dry-run gated). No deletes.
- **Approved suggestions stay traceable** (Dean): `sprint_tests.recommendation_id` links a test to its suggestion (kept on carry-over). Those tests show a green **"Pour a Sprint suggestion"** tag (`PourTag` in `test-card.tsx`) on the board and in /learnings, which also has a "Pour a Sprint only" filter. The `recommendation_results` view (security invoker) gives one row per suggestion with its decision, reject reason and the test's status and outcome, for tuning the prompt.
- Any platform may be suggested; Reddit, Bing, X and ChatGPT Ads aren't connected (Dean: they may be considered, but won't be connected for now). Approved ones are planned as "Several platforms" with the platform in the title and "track by hand" in the brief.
- **The news cellar** (`src/components/news-chat.tsx`, `POST /api/news-chat`): floating chat, bottom right on every page, for anyone with a role. Streams answers with cited sources and sends no client data. **Suggested questions** (`NEWS_STARTERS` in `src/lib/ai/news-starters.ts`) asked as the first message are answered from a **shared 7-day cache** (`news_answers`, server-only, RLS with no policies; not client-scoped because it's public news only, Dean 2026-09-28), with "Get a fresh answer" to bypass it. The same question asked at the same moment on one server waits for one answer. Free-form questions aren't cached or stored.
- Client performance data goes to Anthropic's API (Dean confirmed that's fine, 2026-09-28). Web content is treated as untrusted data in every prompt. Usage (tokens, searches) is saved on each run. Web tools are `allowed_callers: ["direct"]` (without it the 2026-03 tools let Claude script its own searches, which ran away in testing). First real run (DNSFilter, 2026-09-28): 154s, 8 searches, 4 fetches, ~278k input / 12k output tokens.

## Client brain (Dean, 2026-09-29)
- A **Brain** tab per client (`clients/[slug]/brain`): everything we know about the client, condensed into a **client brief** that "Pour me a sprint" reads every time (`briefForPrompt` in `src/lib/knowledge/brief.ts`, added to `src/lib/ai/context.ts`), together with the team's must-knows.
- **Sources** (`client_knowledge`, client-scoped, soft-removed only):
  - **The client's GTM HQ in B&B's Notion** (`clients.notion_hq_page_id`: Camber GTM HQ, DNSFilter GTM HQ). **Read only, never written, never deleted** (Dean). `src/lib/knowledge/notion-hq.ts` finds the HQ's pages and databases (through toggles/columns, plus one page level inside them; the menu lives on a child page) and reads the ticked ones as text (sub-pages one level, inline databases up to 150 rows; embeds, images and videos can't be read). Default picks (Dean): messaging, ICP/personas, reporting, strategy, plans, audits, proposals, initiatives; admin tooling, templates, contacts, design system, DAM and production boards are left out. GTM leads and admins change the ticks.
  - **Must-knows**: short team notes typed Target / Rule / Note. Always passed to Claude verbatim and they win over other sources.
  - **Files**: PDF, TXT, MD, CSV up to 10 MB, in the private `client-files` bucket. The browser uploads straight to storage with a signed upload URL (Vercel caps request bodies at 4.5 MB); PDFs go to Claude as documents.
- **The brief** (`client_briefs`, versioned, no deletes): Claude (`claude-opus-5-5`, no web tools) writes fixed sections (Who we sell to, Targets and KPIs, Positioning and key messages, What's happening now, What we've learned, Rules and things to avoid, Gaps and open questions), each bullet tagged with its source. Only rebuilt when the sources changed (digest). The team can **correct the brief** (a new `written_by = 'person'` version, used straight away and kept by Claude on the next rebuild).
- **Refreshing** is done in steps the browser drives (`POST /api/client-brain` with step `discover`, then `read` in ~60s batches until none are left, then `brief` in the background), because the Notion API allows ~3 requests a second and a full HQ read takes minutes. Nightly: `/api/cron/brain` (CRON_SECRET), run hourly overnight; each run handles the client with the oldest brief within ~4 minutes. Script: `pnpm sync:hq [--force]`.

## Performance tab and insights (Dean, 2026-09-29), in phases
1. **Reporting dashboard** (Performance tab, **built 2026-09-29**): `clients/[slug]/performance` (+ `/[platform]/[campaignId]`). Period 7/14/30/90 days vs the previous period, platform filter (URL params). Metric cards with sparklines; "Why did it move?" (clicks = impressions × CTR, results = clicks × conversion rate, spend = clicks × CPC, cost per result = CPC ÷ conversion rate); metric comparison as **two charts on one timeline, never a dual axis**, previous period dashed; platform split as 100% bars; sortable campaign table; drill-down with ads (previews) and linked sprint tests. Data: `campaign_daily` / `campaign_ads` SQL functions, `getPerformance` in `src/lib/metrics/performance.ts`, cached like the Overview. Platform colours (validated for dark): LinkedIn `#7f6ae0`, Google Ads `#869a14`, Meta `#cf4f86`, always with the logo and name.
- **Supabase returns at most 1,000 rows per request**: use `rpcAll` (`src/lib/supabase/rpc-all.ts`) for any SQL function that can return more (it pages with `.range`).
- **GA4** is connected in Windsor for Camber (Dean, 2026-09-29), others later: landing page performance for paid search goes into phase 2.
2. **New Windsor data**: Google search terms, keywords (match type, quality score), impression share (lost to budget / rank); LinkedIn member company, job title, seniority, industry, function; Meta age, gender, placement, device, frequency, reach, learning stage; current paid social targeting where Windsor exposes it.
3. **Insights feed** ("Optimise now"), rules with these thresholds (**confirmed by Dean**): keyword opportunity = search term with 2+ conversions in 30 days that isn't a keyword; negative = search term that spent 2x target CPL with 0 conversions in 30 days, or clashes with the ICP; impression share lost to budget > 10% while CPL is under target, lost to rank > 30%; no spend in the last 2 days on a campaign that spent the week before; ad CTR up 30%+ (last 7 vs previous 7 days, 1,000+ impressions); campaign 7-day CPL > 1.5x target or > 1.5x its own 30-day average; no results in 14 days after spending 1x target CPL; audiences to add / exclude by CPL and CTR; LinkedIn companies to exclude; Meta ideas (lookalikes from high-intent events, frequency > 4, placement / age skews, ad sets stuck in learning).
4. **Claude on top**: ranks and writes up the feed daily, weekly trend read per campaign, "Ask about this campaign". Uses the Client brain, the numbers and the web.
- **No writes to the ad platforms** for now (Dean): insights offer copyable lists, a Notion action, "make it a sprint test", done / snooze / dismiss. When we get platform API access we can look at writing to them.
- **Audiences** (Dean): check current paid social targeting and whether useful audiences are included in, or missing from, campaigns that would benefit. **Always read the campaign name and its Notion brief to understand the campaign's goal** before judging it.
- **LinkedIn company exclusions** (Dean): look at who interacted with our ads (member company) and flag companies that aren't ICP; the team excludes them in the platform.
