# Moving Lumaux to B&B's team accounts

The runbook for moving GitHub, Vercel, Supabase and Windsor off personal accounts and onto B&B's
own. The rule of thumb: **transfer, don't rebuild.** Supabase, Vercel and GitHub can all move a
project between accounts and keep everything in it, so the app's code, keys and data stay the same.
Windsor can't, so it's the one we rebuild.

Transfer rules and prices change. Check each service's current docs before the day.

## What's tied to an account today

| What | Where it lives | Changes if… |
|---|---|---|
| `bbmopsapp.vercel.app` | `supabase/config.toml` (site URL, redirects), Vercel `APP_URL`, Supabase Cron jobs, every Notion "QA Document" link and report embed already written | the domain changes |
| Supabase project `mazdffcxbgfspjemqhqx` | `supabase/config.toml`, `NEXT_PUBLIC_SUPABASE_URL`, the Google OAuth redirect URI, `supabase/.temp` (local link) | we make a new project instead of transferring |
| GitHub `deansteinhobel-rgb/b-bOpps` | `docs/onboarding.md`, `docs/workflow.md` (clone URL, ruleset command), each developer's `git remote` | the repo moves (old URLs redirect) |
| Windsor key | `WINDSOR_API_KEY` (REST reads and the MCP negative-keyword push) | always: Windsor has no transfer |

The code itself reads the app's address from `APP_URL` and the Supabase address from
`NEXT_PUBLIC_SUPABASE_URL` (the brand font included). Once migration `20261016000065_cron_base_url`
has run, Supabase Cron reads the app's address from a Vault secret named `app_url` (falling back to
`https://bbmopsapp.vercel.app`), so a new domain needs no migration.

## Before the day

- [ ] **Env var inventory.** Copy every Vercel environment variable (Production and Preview) and
      `.env.local` into the team password manager. Values marked Sensitive can't be read back later.
- [ ] **Backup.** A `pg_dump` of the database, and keep the licensed font file somewhere safe (it
      isn't in git).
- [ ] **Font in the bucket.** On 2026-10-16 `brand/fonts/MADEAvenue-Regular.otf` wasn't in storage
      ("Object not found"), so production headings fall back to Georgia. Upload it once with
      `pnpm upload:font <file>`.
- [ ] **Plans.** A Vercel **Pro** team (Hobby can't belong to a team, and is non-commercial). A
      Supabase organization on the plan we want. A **paid Windsor plan** that covers every account
      below and the MCP server (it was a Trial on 2026-09-30).
- [ ] **People.** Dean plus at least one more admin (George or Esa) in every account, and the second
      developer where they need it. Dean must be an owner of both Supabase organizations to transfer.
- [ ] **Windsor logins.** Someone who can sign in to each platform with access to every account:
      LinkedIn (DNSFilter, Camber, Proactis Global, Star account, Filevine), Google Ads (DNSFilter,
      Camber, Star Space), Meta (Filevine, "DNSFilter X", Camber), GA4 (Camber 256531554, Proactis
      319384806).
- [ ] **Run migration `20261016000065_cron_base_url`** (Dean). On its own it changes nothing.
- [ ] **Pick a window** away from the scheduled jobs: Vercel crons run 00:00–07:15 UTC (plus 12:00),
      Supabase Cron at :05 and :35 every hour. Freeze merges to `main` for the move.

## 1. GitHub: transfer the repo

1. Settings → General → Transfer ownership → the B&B organization. Old URLs redirect.
2. Check the `main` ruleset survived (Settings → Rules). If not, re-apply `.github/main-ruleset.json`
   against the new path.
3. CI uses no repository secrets, so CI, CodeQL, Gitleaks and Dependabot carry on. Check one run.
4. Decide with the org that a **public** repo is fine (the font and client content are kept out).
5. Each developer: `git remote set-url origin https://github.com/<org>/b-bOpps.git`.
6. Update the repo path in `docs/onboarding.md` and `docs/workflow.md`.

## 2. Vercel: transfer the project

1. Project `bbmopsapp` → Settings → General → Transfer project → the B&B Pro team. Env vars,
   deployments, crons (`vercel.json`), region (`dub1`) and `bbmopsapp.vercel.app` come with it.
2. Install the **Vercel GitHub app on the B&B organization** and reconnect the repo (Settings →
   Git). Do this **before the next merge**, or production stops deploying.
3. Check every env var against the inventory, for Production and Preview. Preview keeps the safe
   write switches (`NOTION_WRITES_ENABLED=false`, `NOTION_DRY_RUN=true`, `WINDSOR_WRITES_ENABLED=false`,
   `WINDSOR_DRY_RUN=true`) and no `CRON_SECRET`.
4. **Keep `bbmopsapp.vercel.app`**, even if we add a custom domain: Notion links and report embeds
   point at it. If we do add one (say `lumaux.bordeauxandburgundy.co.uk`), see "Changing the domain".
5. With Pro, finish the open Vercel items in `docs/security.md` (Sensitive vars, Deployment
   Protection, Firewall, spend alerts).

## 3. Supabase: transfer the project

1. Project Settings → General → Transfer project → the B&B organization. Run the pre-transfer
   check it shows and clear anything it flags.
2. The project ID, URL, keys, database, storage, Auth users and providers, Vault (`cron_secret`,
   `app_url`) and Supabase Cron jobs all stay. Nothing in Vercel or the code changes.
3. A plan change can restart the database; expect a minute or two.
4. Afterwards: `npx supabase link --project-ref mazdffcxbgfspjemqhqx` on each machine (refreshes
   `supabase/.temp`), and `npx supabase config diff` should show nothing.

**Don't** make a new project and copy across unless the transfer is refused. That would mean new
keys, re-running every migration, copying storage (ad previews, client files, avatars, the font),
re-creating Auth users and the Google provider, Vault secrets, and changing the Google OAuth
redirect URI and `supabase/config.toml`.

## 4. Windsor: rebuild on the new account

1. Connect each data source on the new account with the logins above.
2. Check the new key sees the **same account IDs**: `onboard.windsor.ai/api/common/ds-accounts?datasource=…`
   for linkedin, google_ads, facebook and googleanalytics4. Our `client_platform_accounts` rows and
   all stored history depend on those IDs, not on the key, so nothing needs a backfill.
3. Set the new `WINDSOR_API_KEY` in Vercel (Production and Preview) and in each `.env.local`.
4. Turn negative-keyword pushes off while switching (`WINDSOR_WRITES_ENABLED=false`, Dean), and back
   on once a dry run against the new key works.
5. Cancel the old Windsor plan only after a full day of clean syncs.

## Also on personal accounts

- **Anthropic.** If the key is on a personal console: a key in a B&B organization (and workspace),
  swap `ANTHROPIC_API_KEY` / `ANTHROPIC_WORKSPACE_ID`, and set a monthly spend limit.
- **Notion integration.** Keep the existing integration and make sure a B&B workspace owner owns it.
  A new integration means a new `NOTION_TOKEN` and re-sharing Master Production, every client's HQ
  and both call-notes databases (EMEA, NAM) with it.
- **Google sign-in.** If the OAuth client is in a personal Google Cloud project, make one in a B&B
  project (Internal consent screen, redirect URI
  `https://mazdffcxbgfspjemqhqx.supabase.co/auth/v1/callback`) and put its ID and secret in Supabase
  → Auth → Providers → Google.
- **Claude artifacts** (George's design system, the Camber content library) live on personal
  claude.ai accounts.
- Later: the Slack webhook and any Cloudflare Turnstile keys belong in B&B accounts from the start.

## Changing the domain (only if we do)

1. Add the domain in Vercel and keep `bbmopsapp.vercel.app` as well.
2. `APP_URL` in Vercel = the new address (no trailing slash).
3. `supabase/config.toml`: `site_url` and `additional_redirect_urls`, then
   `npx supabase config diff` and `config push`.
4. Vault: `select vault.create_secret('https://<new domain>', 'app_url');` (needs migration
   `20261016000065`).
5. CSP: nothing to do (it's built from `self` and the Supabase URL).

## Check after each step

- [ ] Sign in with Google works on production.
- [ ] A page with MADE Avenue headings loads the font (no 404 in the network tab).
- [ ] Vercel: the next scheduled jobs succeed (Logs, filter `/api/cron`).
- [ ] Supabase Cron: `select * from cron.job_run_details order by start_time desc limit 10;` and the
      `net._http_response` rows show 200s for `/api/cron/notion` and `/api/cron/calls`.
- [ ] Windsor: the next daily sync succeeds for every account (`windsor_sync_runs`; a run fails if it doesn't reconcile).
- [ ] A Notion report embed still opens.
- [ ] A pull request gets a Vercel preview and CI runs.
