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
  $CRON_SECRET` themselves. Without the secret they answer 401. Supabase Cron (pg_cron + pg_net)
  calls them too; it reads the same secret from Supabase Vault (`cron_secret`) at run time, so it
  is never stored in a migration or the repo. Rotating `CRON_SECRET` means updating Vercel and the
  Vault secret (`vault.update_secret`) together.
- **Database**: row-level security on every table, scoped by client team; admin-only writes where
  it matters; no deletes. Tested offline with `pnpm test:db` (runs in CI).
- **Secrets** stay server-side (`.env.local`, git-ignored; Vercel environment variables). Nothing
  secret in a `NEXT_PUBLIC_` variable. Gitleaks scans every commit (below).
- **Headers** (`next.config.ts`): HSTS, `X-Frame-Options: DENY`, `nosniff`, a strict
  `Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy`; no `X-Powered-By`.
- **Content-Security-Policy** (`src/proxy.ts`): scripts only from the app, with a fresh nonce per
  request; no framing; no plugins; forms post back to the app only; images, storage and uploads
  only from our Supabase project (plus Google favicons for source chips).
- **Rate limits** per person (`src/lib/rate-limit.ts`, `take_rate_limit()` in the database):
  news chat 40/hour, campaign chat 40/hour, pours 8/day, Claude reviews 8/day, brain refreshes
  12/day, brain uploads 40/day, profile pictures 20/hour, feedback 20/day, content idea runs 6/day, test reads 30/day, call note checks 20/day. Call notes in Notion are read only (the guarded client), like the GTM HQ.
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
- **Notion**: no writes while testing (two flags, both safe by default; only Dean changes them).
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
- Accepted, by design: signed-in users can call `is_admin`, `has_role`, `can_access_client` (the
  access rules need them), `take_rate_limit` and `touch_last_seen` (they only touch your own
  record); two permissive update rules on profiles (admin, and own details).
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
      `CRON_SECRET`).
- [ ] **Deployment Protection** on preview deployments (Vercel Authentication).
- [ ] **Firewall**: rate-limit rules on `/login` and `/api/*`; keep **Attack Challenge Mode**
      handy for an attack in progress. **BotID** on the login and Claude routes (Pro).
- [ ] **Spend management** alerts.

## Anthropic

- [ ] A **monthly spend limit** on the workspace (console → Limits), so nothing can run past it.

## After the first deploy

- [x] Header check: Mozilla Observatory **A+ (125, 12 of 12 tests)** on 2026-09-29
      (https://developer.mozilla.org/en-US/observatory/analyze?host=bbmopsapp.vercel.app).
- [ ] TLS check: https://www.ssllabs.com/ssltest
- [ ] OWASP ZAP baseline scan against a preview deployment (only our own app).
- [ ] `/security-review` in Claude Code on the whole codebase.
- [ ] Error and attack monitoring: Sentry (free tier), plus Vercel and Supabase log alerts.
