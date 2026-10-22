# Lumaux (B&B Account Ops)

An internal web app for Bordeaux & Burgundy. For each client it shows paid media performance (from Windsor.ai), runs the weekly and monthly QA checks, plans and tracks sprint tests, builds and edits paid campaigns (always paused), and shows and creates action points in Notion. Notion stays the system of record.

This file holds only the hard rules and an index. **Everything else (decisions, field mappings, how each feature works, gotchas, which files hold what) is in the context bank.** Before working on a part of Lumaux, use the `lumaux-context` skill (`corepack pnpm context search "<words>"`). When a piece of work is done, or a decision is made or changed, use the `save-context` skill. Don't add feature notes here; add them to the bank.

## The client is the spine
Every page, query, table and RLS policy is scoped by `client_id`. The client list and **Today** are the only views that span clients; Today loads each client through RLS first and then reads per client. If a new query or table isn't client-scoped, stop and ask.

## Stack
- Next.js (App Router), TypeScript, Tailwind, shadcn/ui, pnpm (run it through `corepack pnpm` on this machine). Vitest.
- Supabase: Postgres, Auth (Google sign-in, `@bordeauxandburgundy.co.uk` only), RLS on every table, migrations in `supabase/migrations`. New keys only (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`).
- `@notionhq/client` v5, `notionVersion: "2026-03-11"`: query `dataSources.query`, full reads with `iterateAllDataSourceRows`.
- Windsor.ai REST for every ad platform read (through `windsorRows`). Writes: Google Ads and Meta through Windsor's MCP allowlist only; LinkedIn, Reddit and Microsoft Ads campaign builds through their own APIs. **Never call the Google Ads or Meta APIs directly.**
- Claude (`@anthropic-ai/sdk`, server-side only, `claude-opus-5-5` / `claude-sonnet-5`). Slack: weekly reports only, bot token `chat:write`.
- Vercel (Hobby), project `bbmopsapp`, deploys from GitHub `main`. Don't hardcode the domain or Supabase project: use `APP_URL` and `NEXT_PUBLIC_SUPABASE_URL`.
- All third-party keys stay server-side. Nothing secret goes in a `NEXT_PUBLIC_` variable.

## NO WRITES TO NOTION WHILE TESTING. NOTHING GETS DELETED. (Dean, 2026-09-28)
- Nothing may write to the real Notion workspace during development or testing: scripts, dev servers, tests and one-off checks.
- Scripts use `scripts/notion-readonly.ts`, which throws on any create, update, append, delete, move, comment or upload call. Never use `new Client()` directly. Tests use a mocked Notion client only.
- In the app, a real write needs `NOTION_WRITES_ENABLED=true` **and** `NOTION_DRY_RUN=false` (both default safe). Dean, or Claude in Dean's own sessions, switches them; Claude says so in the reply each time, sets `NOTION_LIVE_CLIENTS` / `WINDSOR_LIVE_CLIENTS` as narrowly as the task allows, and never switches them for scripts, tests or one-off checks. Other developers' Claude sessions never change them.
- Deletes are never allowed in any environment, in Notion, the ad platforms or our own database. There is no delete code path; things are archived or soft-removed.

## Notion write-side rules (strict)
- The app only ever **creates** pages in the Master Production data source (`2716e9bb-1958-81b0-a4e2-000bf0330ac3`): actions, sprint test briefs and email sequence briefs, plus one comment on a page it has just created. No edits to pages the app didn't create; status updates are off.
- **No new properties or select options, ever** (they break B&B's Notion automations). Existing properties and options only.
- Every write goes through `createNotionAction`: log to `notion_write_log` first, call Notion, log the result, upsert `notion_pages_mirror`. The UI reads the mirror, never Notion live.
- Read-only exceptions (never written): each client's GTM HQ tree, linked call notes, campaign proposal pages, the Content Bank. Every Notion reader for one client uses `otherClientsNotion` / `insideOtherClient` (`src/lib/knowledge/boundaries.ts`), which fails closed.
- If anything about the Notion schema or Windsor fields is ambiguous, ask. Don't guess.

## Ad platform writes (strict)
- Only the fixed allowlists in code: Windsor `src/lib/windsor/mcp.ts`; senders in `src/lib/ads-api/`. Campaigns, ad groups and ads are **created paused**; nothing is ever enabled, removed or deleted from the app. Edits are pause, budget, end date, name, keyword adds and exclusions only.
- Every write logs to `platform_write_log` first (with `idempotency_key` where set), then sends, then logs the result.
- Gates, all safe by default: `WINDSOR_WRITES_ENABLED` + `WINDSOR_DRY_RUN=false` (+ `WINDSOR_AD_WRITES_ENABLED` for ads); `ADS_API_WRITES_ENABLED` + `ADS_API_DRY_RUN=false` + `ADS_API_PLATFORMS` (+ `ADS_API_EDITS_ENABLED` for edits), narrowed by `*_LIVE_CLIENTS`. Same rule as Notion for who switches them. Slack posts are dry run unless `SLACK_REPORTS_ENABLED=true`.

## Security
- `docs/security.md` is the record; keep it current.
- `src/proxy.ts`: login redirect except `/login`, `/auth/*`, `/embed/*` and `/api/cron/*`; nonce CSP. Anything loaded from another origin must be added to the CSP there.
- Cron routes check `isCron(request)`. Any new route that calls Claude or takes uploads gets a rate limit (`src/lib/rate-limit.ts`).
- Server fetches go through `fetchFrom` (host allowlist, checked redirects, capped bodies); never fetch a URL from data or the browser directly. Redirect targets go through `safePath`.
- New tables: client-scoped RLS, no delete policies, guard triggers or column grants for server-only columns, and the `log_change()` trigger if people edit them. When the server writes for a person with the secret key, use `createAdminClient(me.id)`.
- New SQL functions: grant `authenticated` explicitly if the app calls them; security definer functions need `set search_path` and an access check up front.

## Conventions
- **Releases: branch, pull request, merge.** Every push to `main` deploys to production, so never push to `main` directly. Branch `<name>/<change>`, small commits, check at http://localhost:3000. In Dean's sessions Claude pushes, opens the PR (`.github/pull_request_template.md`) and squash-merges once every required check has passed, then says what went live; never with an unrun migration, a failing or pending check, or a conflict; another developer's PR only when Dean says so. In other developers' sessions: push and open a PR when that person says so; Dean merges.
- **Migrations**: the database is shared by localhost, previews and production. Additive only, timestamp later than every migration on `main`. Only Dean runs them, or Claude in Dean's sessions once Dean says so (Supabase `apply_migration`, naming the migration first, files from `supabase/migrations` only). Other developers' sessions never run migrations. Regenerate `src/lib/supabase/database.types.ts` with `pnpm types:db` after each one.
- **US English everywhere** (UI, docs, comments, Claude's output). Stored keys keep their old spelling. Money is always a symbol ($, £), never "USD".
- Tests for the Notion write function (mocked), pacing and the pure rule modules. Vitest.
- Server components never import functions or constants from a `"use client"` file; shared helpers live in plain modules.
- Look and feel: B&B colors and fonts (page #1a1a1a, lime #e4ff1a as the one signal, MADE Avenue for h1/h2 only, Helvetica Neue otherwise, no all caps). Ask Dean before restyling existing screens; details in the bank (`design`).
- New teammates start with `docs/onboarding.md`; the workflow is in `docs/workflow.md`.

## Context bank index
Search with `corepack pnpm context search "<words>" [--area <slug>]`; `corepack pnpm context titles <slug>` lists an area.

| area | what's there |
|---|---|
| `data-model` | roles and teams, KPI and targets per platform, budgets, currency, metrics keys, best/worst ad, fatigue, periods, scheduling |
| `clients` | per-client accounts, targets, budgets, teams, HQ pages (Star, Star Space, Filevine, Drillsense, …) |
| `notion-mapping` / `notion-writes` | Master Production properties, open/closed statuses, Briefs and Actions tabs, write rules in detail |
| `windsor` | field mapping per platform, connector quirks (LinkedIn dropped rows, Meta zeroed spend), Reddit, accounts |
| `design` / `ux` / `roles-layout` / `client-navigation` / `summary` | look and feel, sidebar, profiles, status colors, board and deck patterns, roles by feature, client sections |
| `sprints` / `claude-in-app` / `labels` | sprint tests flow, briefs, live results, Pour a Sprint, news chat, taxonomy and ad labels |
| `reporting` / `insights` | date ranges, boards, embeds, client report, the read, segments; breakdowns, Recommendations rules, Claude review, Google negatives and ads |
| `campaign-builds` / `campaign-builder-linkedin` | build runner, switches, per-platform builds and edits, planner, playbook, exclusions |
| `competitors` | competitor and keyword ads via Apify, relevance checks, budget |
| `client-brain` / `calls` / `content-library` | HQ reading, Content Bank, brief; call notes and follow-ups; content library and sequence briefs |
| `ad-previews` / `slack` / `change-log` / `admin` | creatives and covers; weekly Slack snapshot; change log and Activity; admin pages |
| `security` / `conventions` / `stack` | the long-form versions of the rules above |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
