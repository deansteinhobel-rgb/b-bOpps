# Security

What protects Lumaux, and the settings that have to be switched on by hand. Started
2026-09-29, before the first Vercel deploy.

## In the app (done)

- **Sign-in**: magic links for `@bordeauxandburgundy.co.uk` only; no passwords. Links point at
  `APP_URL` only in production, and every redirect after sign-in is checked (`src/lib/safe-path.ts`:
  no `//`, backslashes, encoded tricks or other schemes). Every page and API
  route needs a session (`src/proxy.ts`), except `/login`, `/auth/*`, the scheduled jobs and report
  embeds (below).
- **Scheduled jobs** (`/api/cron/*`) skip the login redirect and check `Authorization: Bearer
  $CRON_SECRET` themselves, through `isCron()` (`src/lib/cron-auth.ts`, a constant-time compare). Without the secret they answer 401. Supabase Cron (pg_cron + pg_net)
  calls them too; it reads the same secret from Supabase Vault (`cron_secret`) at run time, so it
  is never stored in a migration or the repo. Rotating `CRON_SECRET` means updating Vercel and the
  Vault secret (`vault.update_secret`) together.
- **Database**: row-level security on every table, scoped by client team; admin-only writes where
  it matters; no deletes (no DELETE policies, and DELETE is revoked from `anon` and `authenticated`
  on every table, migration 20261020000081). Tested offline with `pnpm test:db` (runs in CI).
- **Secrets** stay server-side (`.env.local`, git-ignored; Vercel environment variables). Nothing
  secret in a `NEXT_PUBLIC_` variable. Gitleaks scans every commit (below).
- **Headers** (`next.config.ts`): HSTS, `X-Frame-Options: DENY`, `nosniff`, a strict
  `Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy`; no `X-Powered-By`.
- **Content-Security-Policy** (`src/proxy.ts`): scripts only from the app, with a fresh nonce per
  request; no framing; no plugins; forms post back to the app only; images, storage and uploads
  only from our Supabase project (plus Google favicons for source chips).
- **Rate limits** per person (`src/lib/rate-limit.ts`, `take_rate_limit()` in the database):
  news chat 40/hour, campaign chat 40/hour, pours 8/day, Claude reviews 8/day, brain refreshes
  12/day, brain uploads 40/day, profile pictures 20/hour, feedback 20/day, content idea runs 6/day, test reads 30/day, call note checks 20/day (each counts at the start and again when Claude is scheduled, so a request without `first` still counts), calls added by hand 10/day, brief rebuilds 12/day, brain notes 100/day, HQ page reads 100/day,
  Notion refreshes 30/hour (edit access only), Notion actions and briefs 30/day (sequence approvals count here), ad post links 60/day, content library page reads 40/day, placements and re-picks 30/day, email angles 150/day. Call notes and the Content Bank in Notion are read only (the guarded client), like the GTM HQ.
- **Content library (2026-10-14, Plan › Content library)**: `content_pieces` and `content_sequences`
  are client-scoped with RLS (the team edits, viewers read, no deletes; archiving is server-side
  after an admin check). Guard triggers keep approval, the Notion brief link and Claude's pick for the
  server. "Read page" fetches only the client's own site (`pageHosts` in
  `src/lib/content-library/config.ts`, through `fetchFrom`: https, every redirect re-checked, HTML
  only, 3 MB cap). A Claude placement is HMAC-signed before it goes to the browser for review, so
  only what Claude actually picked is saved as "Claude's pick". Library and page text are untrusted
  data in every prompt (an injected instruction was ignored in testing). Approving sends one Master
  Production page per approval round (`brief_key` unique index, migration 20261014000058).
- **Aikido scan fixes (2026-10-13)**:
  - **Client isolation for Notion reads** (`src/lib/knowledge/boundaries.ts`): a client's HQ discovery, page reads and call notes never step into another client's HQ or own call notes; linked call pages inside them aren't followed; linking another client's source, or a Client option another client already reads, is refused. The shared **Content Bank** (Dean, 2026-10-15) is read row by row only: a row reaches a client's brain only when its Client names that client (checked again right before storing), and HQ reads never read the bank whole (`otherClientsNotion`, `databaseText`).
  - **Storage paths**: brain files only as `<client id>/<time>-<safe name>`; avatar folders are profile UUIDs; ad images only `<client>/<platform>/<safe ad id>`.
  - **Outbound fetches** (ad images, LinkedIn posts, and since 2026-10-14 content library pages on the client's own site): an https host allowlist, re-checked on every redirect.
  - **One live Notion page per test brief and per check action**: unique indexes on `notion_write_log` (migration 20261013000057).
  - **Avatars bucket**: 1 MB, images only, server uploads only.
  - **Negative keywords**: a negative that would block a different converting search term is refused on the server.
  - **Suggestions**: decisions claim the row atomically; archived pours can't be decided.
  - **CSV export**: formula cells are escaped.
  - **Auth errors**: logged as JSON.
  - **GitHub Actions**: pinned to commit SHAs, with no persisted checkout credentials.
  - **Accepted**:
    - CSP `style-src 'unsafe-inline'`: the UI sets widths and colors inline, and styles can't run code.
    - CSP `img-src` includes `tpc.googlesyndication.com` and `i.ytimg.com` (2026-10-19): Google Ads asset images and YouTube thumbnails for Performance Max and Demand Gen load from Google in the browser, including on shared client report links. Only URLs on those hosts are kept (`mergeAssets`), and nothing is fetched on the server.
    - `scripts/dev-signin.ts` passing a one-time link to the local browser: localhost only, and the link is single-use.
- **Code review fixes (2026-10-20)**:
  - **Isolation fails closed**: `insideOtherClient` ends the walk only when Notion says a parent can't be opened (not found, restricted); a rate limit or outage throws, and a tree deeper than 20 levels counts as another client's. `otherClientsNotion` throws when it can't load the other clients' pages. Linking call notes, and every call sync, walk the source's parents, so a database nested inside another client's HQ is refused; a shared database's Client option that names another client is refused even before that client links it.
  - **Integrity guards** (migration 20261020000081): Pour a Sprint suggestions keep Claude's reasoning and origin, and are reviewed and decided only as yourself; runs are started only as yourself, generating; goal values must match the goal's client; a new test can't arrive with a Notion brief or another creator (carry-overs within a client excepted); invites can't be deleted.
  - **Outbound fetches**: Slack snapshot pictures go through `fetchFrom` (our storage and the CSP's logo hosts) with a 5 MB cap; ad images and post pages are read with a byte cap (`readBytes`). Every Windsor read goes through `windsorRows` (`src/lib/windsor/rest.ts`) with a timeout.
  - **Inputs**: brain uploads take type and size from storage, not the browser; chat routes check the posted messages (`chatHistory`); full call re-reads are admin only; only people who can edit the client redo the shared weekly campaign read; the brain refresh returns no raw Notion or database errors.
- **Change log (2026-10-21)**: every insert, update or delete a person makes is recorded by a trigger
  (`log_change()`, security definer) in `change_log`, which nobody can write, edit or delete. The
  server names the person it acts for with the `x-lumaux-actor` header, trusted only for the service
  role (signed-in users can't claim to be someone else: their own `auth.uid()` always wins). Team
  reads its clients' rows, admins read all (Admin → Activity).
- **Campaign builds through the ad platforms' APIs (2026-10-21)**: refresh tokens live in Supabase
  Vault, readable and writable only by the service role (`ads_api_token` / `set_ads_api_token`);
  access tokens stay in server memory and are never logged. Each sender has a fixed list of create
  calls (no generic request, no update, enable or delete) and forces paused statuses; LinkedIn image
  bytes only go to `*.linkedin.com`. Writes need three switches plus the platform listed
  (`ADS_API_*`), log before sending, and use idempotency keys so a step is never sent twice. Only
  admins and GTM leads on the client can build, rate-limited to 20 a day.
- **Campaign builder (2026-10-21)**: the planner, naming and research call Claude server-side with
  rate limits (`campaign_plan`, `playbook_research`); client notes, proposals and campaign names are
  treated as data in the prompts, and web content as untrusted (research only, no client data in
  it). Ad images go to the private `campaign-assets` bucket through signed upload links under the
  client's folder, and a build refuses another client's path. LinkedIn reads (typeahead, matched
  audiences, a campaign, the account's company page) are fixed GET paths with checked ids. Edits to
  live campaigns need a fourth switch (`ADS_API_EDITS_ENABLED`), read and log the value before,
  send one partial update from a fixed list of fields, and can only ever set a status of PAUSED.
  `ad_playbooks` and every-client rules aren't client-scoped (public research and B&B's own
  rules); every-client rules are admin-edited, client rules follow `can_edit_client`.
- **Generate a campaign brief (2026-10-23)**: `/api/campaign-brief` calls Claude server-side (no web
  tools) for anyone who can edit the client, rate-limited (`campaign_brief`, 30 a day); the request,
  pasted notes and all client context are data in the prompt. `campaign_briefs` is client-scoped
  (`can_access_client` read, no insert, update or delete policies: the server writes with
  `createAdminClient(me.id)` after the RLS read, and briefs are archived, never deleted). The Word
  export reads through RLS. "Send to Notion" goes through `createNotionAction` (operation
  `create_campaign_brief`, the brief as the new page's `children`), one live page per brief.
  Attached files (up to 3: PDF, Word, TXT, MD, CSV, 10 MB) upload through a signed link into the
  client's own folder in the private `client-files` bucket (`brain_upload` limit); the start route
  checks each path's shape and the type and size storage holds before Claude reads it, and file
  contents are data in the prompt.
- **Builds and edits on every platform (2026-10-21)**: Google Ads and Meta go through Windsor's
  MCP write actions with a fixed allowlist per connector (`src/lib/windsor/mcp.ts`; never an
  enable, remove or delete action, and creates are forced paused), Reddit and Microsoft Ads through
  their own APIs with fixed paths. Meta images are handed over as a one-hour signed link to the
  client's own `campaign-assets` file (path checked). Accounts, campaigns and ad sets come from our
  own data, never the browser; Meta targeting edits read the whole targeting first and change one
  field. The same switches, roles, rate limits and write log as LinkedIn apply.
- **Report embeds for Notion** (`/embed/report/<token>`, Dean 2026-09-29: "anyone with the link,
  view only"): the link's token (192 random bits, `report_links`) is the only key. It shows one
  board of one client and nothing else: no session is read or set, no links into the app, and the
  page reads only through the link row (admin client, server-side). Only Notion may frame these
  pages (`frame-ancestors` notion.so, *.notion.so, *.notion.site; no `X-Frame-Options` there, since
  it can't name a site); every other page stays `DENY`. `noindex`, `Referrer-Policy: no-referrer`.
  Admins, GTM leads and the client's AMs create and turn off links (RLS `can_share_reports`); the
  client's team (not viewers) can read them; a turned-off link stops at once; links are never
  deleted. No rate limit (there's no person to count by): the numbers come from the shared cache,
  and a token can't be guessed. If a link leaks, turn it off in Reporting → Embed in Notion.
- **Notion**: no writes while testing (two flags, both safe by default; only Dean, or Claude in Dean's own sessions, changes them).
- **Claude**: web content is treated as untrusted data in every prompt; web tools can't be
  scripted by the model; token use is saved per run.

## In GitHub (files added; switch these on in Settings → Code security)

| What | File | Switch on |
|---|---|---|
| CI: types, lint, tests, database access tests, `pnpm audit` (high and critical fail) | `.github/workflows/ci.yml` | Runs by itself. Add it as a required check on `main` (Settings → Branches). |
| Dependabot: vulnerable and outdated packages, weekly | `.github/dependabot.yml` | **Dependabot alerts** and **Dependabot security updates** |
| CodeQL code scanning (security-extended queries) | `.github/workflows/codeql.yml` | **Code scanning** (results in the Security tab) |
| Gitleaks: keys in any commit, full history | `.github/workflows/secret-scan.yml` + `.gitleaks.toml` | Runs by itself. Also turn on GitHub **Secret scanning** and **Push protection** (blocks a push that contains a key). |

## Supabase

Done (2026-09-29, `supabase db advisors --linked`):
- [x] **Security Advisor**: no errors. Fixed: `search_path` pinned on every function (18 warnings),
      and nothing in `public` is callable without signing in (6 warnings; migration 0034). Checked
      from outside with the public key: functions refuse, tables return nothing.
- [x] **Performance Advisor**: access rules call `auth.uid()` once per query (migration 0035).
- Accepted, by design: signed-in users can call `is_admin`, `is_viewer`, `has_role`,
  `my_client_ids`, `can_access_client`, `can_edit_client` and `can_share_reports` (the access
  rules need them; they only answer about the caller), `take_rate_limit` and `touch_last_seen`
  (they only touch your own record); two permissive update rules on profiles (admin, and own
  details). `creative_modified_state`, `news_answers` and `rate_limit_events` have RLS on with no
  policies on purpose: only the server (secret key) reads and writes them. Leaked password
  protection is off (we don't use passwords). Last checked 2026-10-13.
- Re-run any time: `npx supabase db advisors --linked --type security`.

To do in the dashboard (they need the Vercel domain or a Cloudflare account):
- [x] **Auth → URL configuration** (2026-09-29, `supabase/config.toml`, `npx supabase config push`):
      Site URL `https://bbmopsapp.vercel.app`; redirect URLs = `/auth/confirm` on that domain and on
      localhost only. `APP_URL` in Vercel is the same domain.
- [ ] **Auth → Rate limits**: keep the email limits low (magic links).
- [ ] **Auth → Bot and abuse protection**: turn on CAPTCHA with **Cloudflare Turnstile** (free):
      create a Turnstile widget for the domain, put its **secret** key in Supabase and its **site**
      key in Vercel as `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. The login form and CSP switch it on by
      themselves when that variable is set.
- [ ] **Auth → SMTP**: our own email sender, so magic links don't come from Supabase's shared one.
- [ ] Optional: **Leaked password protection** (we don't use passwords, but it's free).

## Vercel

Done (2026-09-29): project `bbmopsapp` (Hobby), deployed from GitHub `main` to
https://bbmopsapp.vercel.app; functions in Dublin (`dub1`, next to the database); every
environment variable stored as Secret except `APP_URL` and the Notion flags (set to the safe values:
writes off, dry run on); 12 daily scheduled jobs (`vercel.json`), checked end to end.


- [ ] Environment variables marked **Sensitive** (Anthropic, Supabase secret, Notion, Windsor,
      `CRON_SECRET`, `SLACK_BOT_TOKEN`, the `*_ADS_CLIENT_SECRET`s, `MICROSOFT_ADS_DEVELOPER_TOKEN`).
- [ ] **Deployment Protection** on preview deployments (Vercel Authentication).
- [ ] **Firewall**: rate-limit rules on `/login` and `/api/*`; keep **Attack Challenge Mode**
      handy for an attack in progress. **BotID** on the login and Claude routes (Pro).
- [ ] **Spend management** alerts.

## Slack

The Lumaux Slack app (2026-10-20) posts the weekly snapshot and nothing else: bot scope `chat:write`
only, no user scopes, no events, no interactivity endpoint (its buttons are plain links into the app,
behind sign-in). It only posts to channels it has been invited to. `SLACK_BOT_TOKEN` is server-side
only; the App-level token (`xapp-…`, Socket Mode) isn't used and isn't stored. Ad names and goal names
in posts are escaped (`&`, `<`, `>`), so they can't ping a channel or add links.
Ad images in posts are signed links to our private `ad-previews` copies, valid for 90 days
(anyone with the link can open that one image for that long; they're ads that ran publicly).

## Apify (competitor ads)

Competitor ads (2026-10-20) are read once a week from the public Meta Ad Library, Google Ads
Transparency Center and LinkedIn Ad Library through Apify actors. `APIFY_TOKEN` is server-side only.
The app calls `api.apify.com` only (through `fetchFrom`, response bodies capped), runs only the three
actors fixed in `src/lib/competitors/sources.ts`, and never logs in to any ad platform: the actors read
public library pages. Competitor images are copied into the private `ad-previews` bucket under
`<client_id>/competitor/` (the same storage policy), from the ad image hosts plus Google's display ad
CDN (`2mdn.net`), so the CSP needs nothing new. Ad copy is untrusted text: Claude's prompts say so.
LinkedIn's terms forbid scraping its Ad Library; Dean accepted that risk for B&B (2026-10-20).

- [ ] A **usage limit** on the Apify account (Billing → Limits). A week costs about $1.

## Anthropic

- [ ] A **monthly spend limit** on the workspace (console → Limits), so nothing can run past it.

## After the first deploy

- [x] Header check: Mozilla Observatory **A+ (125, 12 of 12 tests)** on 2026-09-29
      (https://developer.mozilla.org/en-US/observatory/analyze?host=bbmopsapp.vercel.app).
- [ ] TLS check: https://www.ssllabs.com/ssltest
- [ ] OWASP ZAP baseline scan against a preview deployment (only our own app).
- [ ] `/security-review` in Claude Code on the whole codebase.
- [ ] Error and attack monitoring: Sentry (free tier), plus Vercel and Supabase log alerts.
