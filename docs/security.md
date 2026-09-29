# Security

What protects Sauvignon Blanc, and the settings that have to be switched on by hand. Started
2026-09-29, before the first Vercel deploy.

## In the app (done)

- **Sign-in**: magic links for `@bordeauxandburgundy.co.uk` only; no passwords. Every page and API
  route needs a session (`src/proxy.ts`), except `/login`, `/auth/*` and the scheduled jobs.
- **Scheduled jobs** (`/api/cron/*`) skip the login redirect and check `Authorization: Bearer
  $CRON_SECRET` themselves. Without the secret they answer 401.
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
  12/day, brain uploads 40/day, profile pictures 20/hour, feedback 20/day.
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

## Supabase (to do before deploy)

- [ ] **Security Advisor** (Dashboard → Advisors): fix anything red.
- [ ] **Auth → URL configuration**: Site URL = the Vercel domain; redirect URLs = that domain only
      (plus `http://localhost:3000` while developing).
- [ ] **Auth → Rate limits**: keep the email limits low (magic links).
- [ ] **Auth → Bot protection**: CAPTCHA (Cloudflare Turnstile) on sign-in. Needs a small change
      to the login form (add the widget); ask Claude when you switch it on.
- [ ] **Auth → SMTP**: our own email sender, so magic links don't come from Supabase's shared one.

## Vercel (at deploy)

- [ ] Environment variables marked **Sensitive** (Anthropic, Supabase secret, Notion, Windsor,
      `CRON_SECRET`).
- [ ] **Deployment Protection** on preview deployments (Vercel Authentication).
- [ ] **Firewall**: rate-limit rules on `/login` and `/api/*`; keep **Attack Challenge Mode**
      handy for an attack in progress. **BotID** on the login and Claude routes (Pro).
- [ ] **Spend management** alerts.

## Anthropic

- [ ] A **monthly spend limit** on the workspace (console → Limits), so nothing can run past it.

## After the first deploy

- [ ] Header check: https://securityheaders.com and https://developer.mozilla.org/observatory
      (aim for A or better).
- [ ] TLS check: https://www.ssllabs.com/ssltest
- [ ] OWASP ZAP baseline scan against a preview deployment (only our own app).
- [ ] `/security-review` in Claude Code on the whole codebase.
- [ ] Error and attack monitoring: Sentry (free tier), plus Vercel and Supabase log alerts.
