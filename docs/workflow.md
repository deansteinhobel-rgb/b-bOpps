# How changes reach production

Two or more people work on Lumaux, each with their own Claude Code. Every push to `main` deploys
to production (https://bbmopsapp.vercel.app), so nobody pushes to `main` directly: changes go through
a branch and a pull request, and **Dean approves every merge** (Dean's own Claude sessions may merge Dean's pull requests once every check has passed, Dean 2026-10-15; see CLAUDE.md). The ruleset in
`.github/main-ruleset.json` enforces this on GitHub once it's switched on (see "One-time setup").

## Day to day

1. Get the latest `main` and start a branch named after you and the change:
   ```bash
   git switch main
   git pull
   git switch -c dean/pacing-tooltips
   ```
2. Work and commit locally in small steps (Claude does this). Check it on http://localhost:3000.
3. When it's ready for someone else to see, push the branch and open a pull request:
   ```bash
   git push -u origin dean/pacing-tooltips
   gh pr create --fill
   ```
   Fill in the template's "How to check it" and checklist.
4. GitHub runs the checks (types, lint, tests, RLS tests, `pnpm audit`, CodeQL, Gitleaks) and Vercel
   builds a **preview** of the branch with its own URL (linked on the pull request).
5. Dean reviews the change on the preview or on localhost, then merges (squash). The merge deploys to
   production. In Dean's own sessions Claude merges Dean's pull requests once every check has passed.
6. If `main` moved while you were working, bring your branch up to date before merging:
   ```bash
   git switch main
   git pull
   git switch dean/pacing-tooltips
   git merge main
   ```

Keep pull requests small: one change each. Two people editing the same files at once means merge
conflicts, so say in the team chat what you're picking up.

## Database migrations

There is **one database** for localhost, previews and production. A migration is live for everyone
the moment it runs, whatever branch it came from, and rolling the code back doesn't undo it.

- **Additive only**: new tables, columns, functions and policies. Never drop or rename anything the
  live app reads. If something must go, stop using it in one release and remove it in a later one,
  with Dean's go-ahead.
- **Dean runs every migration** (`npx supabase db push`). Nobody else does, and Claude never does on
  someone else's laptop.
- **Name it after the latest one on `main`**: the timestamp prefix must be later than every file in
  `supabase/migrations` on `main` when you open the pull request. If someone else's migration lands
  first, rename yours.
- Say in the pull request whether it runs **before merging** (the new code needs it; the usual case,
  safe because it's additive) or after.
- Test it offline first with `corepack pnpm test:db` (in-memory Postgres; never touches the real
  project).

Planned (before launch): a second Supabase project for development, so localhost and previews stop
writing to production data. Until then, treat localhost as production.

## Releases and rolling back

After a release Dean is happy with, tag it so there's a named version to go back to:

```bash
git switch main
git pull
git tag -a v1.0 -m "First release with two developers"
git push origin v1.0
```

Number them `v1.0`, `v1.1`, ... (`v2.0` for a big change). To see the tags: `git tag -n`.

**If production breaks**, in this order:

1. **Roll back on Vercel** (fastest, no rebuild): Vercel → project `bbmopsapp` → Deployments →
   the last good production deployment → **Instant Rollback**. Hobby only rolls back to the deployment
   just before the current one; for an older one, open it and choose **Redeploy** (it rebuilds the
   code as it was, with today's environment variables). The scheduled jobs follow the deployment.
2. **Fix `main`**: revert the bad change through a pull request, so the next deploy doesn't bring it
   back:
   ```bash
   git switch -c dean/revert-pacing-tooltips
   git revert <commit>
   git push -u origin dean/revert-pacing-tooltips
   gh pr create --fill
   ```
   To compare with the last release: `git diff v1.0 main`.
3. **Database**: code rollback leaves migrations in place, which is fine because they're additive. If
   data itself is damaged, restore from Supabase's backups (Dashboard → Database → Backups); that's
   Dean's call.

## One-time setup (Dean)

### GitHub

1. Add the teammate: repo → Settings → Collaborators → Add people (they get write access).
2. Protect `main` with a ruleset (repo → Settings → Rules → Rulesets → New branch ruleset, target the
   default branch): require a pull request with 1 approval (dismiss stale approvals on new pushes),
   require the status checks **checks** (CI), **gitleaks** and **analyze** (CodeQL), block force pushes
   and block deletions. Let repository admins bypass it for pull requests only, so you can still
   merge your own (GitHub won't let you approve your own) but nobody pushes to `main` directly. Or
   apply `.github/main-ruleset.json`, which does exactly that, from a terminal:
   ```bash
   gh api -X POST repos/deansteinhobel-rgb/b-bOpps/rulesets --input .github/main-ruleset.json
   ```
3. Settings → General → Pull Requests: allow squash merging only, and tick "Automatically delete head
   branches".

### Vercel

1. **Preview environment variables**: Settings → Environment Variables. Every variable the app needs
   must exist for **Preview**, and the write switches must be the safe values there, whatever
   production has: `NOTION_WRITES_ENABLED=false`, `NOTION_DRY_RUN=true`,
   `WINDSOR_WRITES_ENABLED=false`, `WINDSOR_DRY_RUN=true`, and no `WINDSOR_AD_WRITES_ENABLED`. Leave `CRON_SECRET` out of Preview
   (scheduled jobs only run in production) and set `APP_URL` for Preview to the preview's own URL
   pattern, or sign-in links will point at production.
2. **Signing in on a preview**: add the preview URLs to Supabase Auth's redirect list in
   `supabase/config.toml` (`additional_redirect_urls`, e.g.
   `"https://bbmopsapp-*-<your-vercel-team>.vercel.app/auth/confirm**"`), then
   `npx supabase config diff` and `config push`. Until then, review on localhost.
3. **Hobby limits**: Hobby is for one person, and may refuse to build a preview for a commit someone
   else made. If that happens, or before launch, move the project to Pro (one seat per developer),
   which also allows Instant Rollback to any earlier deployment.

### Supabase

- Check the plan's backups (Dashboard → Database → Backups). Before launch, consider point-in-time
  recovery (a paid add-on) so a bad change can be undone to the minute.
- Add the teammate to the Supabase organization only if they need the dashboard (read-only is enough
  for most work). They don't need it to run the app.

### The teammate

Send them [onboarding.md](onboarding.md), the `.env.local` values and the font through the password
manager.
