# Working on Lumaux: getting started

For a B&B teammate joining Dean on Lumaux, with their own Claude Code. Read `CLAUDE.md` first: it's
the project's rules, and your Claude reads it on every session too. How changes get from your laptop
to production is in [workflow.md](workflow.md).

## What you need

- Access to the GitHub repo `deansteinhobel-rgb/b-bOpps` (Dean adds you as a collaborator).
- Your own Claude plan with Claude Code (the desktop app's Code tab, or the `claude` CLI).
- Node.js 24 (what CI uses) and git.
- A `@bordeauxandburgundy.co.uk` Google account (that's how you sign in to the app).
- From Dean, **through the password manager only** (never Slack, email or chat):
  - the `.env.local` values,
  - the MADE Avenue font file (licensed, so it's never in the repo, which is public).

## Setup

```bash
git clone https://github.com/deansteinhobel-rgb/b-bOpps.git lumaux
```

```bash
cd lumaux
corepack pnpm install
```

1. Create `.env.local` from `.env.example` and paste in the values from the password manager,
   including `CONTEXT_SUPABASE_URL` and `CONTEXT_SUPABASE_SECRET_KEY`: Claude Code reads Lumaux's
   decisions and feature notes from the context bank (`context-bank/README.md`), not from `CLAUDE.md`.
2. **Check the safety switches** in your `.env.local`. They must read exactly:
   ```
   NOTION_WRITES_ENABLED=false
   NOTION_DRY_RUN=true
   ```
   and the Windsor ones, if present, `WINDSOR_WRITES_ENABLED=false` and `WINDSOR_DRY_RUN=true`.
   Never change them. Only Dean (or Claude in Dean's own sessions) switches them, never on a laptop.
3. Put the font at `public/fonts/MADEAvenue-Regular.otf` (the folder is git-ignored). Without it the
   titles fall back to Georgia, which is fine for most work.
4. Start the app and sign in:
   ```bash
   corepack pnpm dev
   ```
   Open http://localhost:3000 and use "Continue with Google". If that isn't set up for localhost, this
   opens a one-time sign-in link in your browser instead:
   ```bash
   corepack pnpm dev:signin you@bordeauxandburgundy.co.uk
   ```
5. Ask Dean to give you a role (Admin → People). Until then you see nothing.

## Things to know before you change anything

- **Your laptop uses the production database.** There is one Supabase project. Anything you save in
  the app on localhost is real data that the team sees. Test on a client you're on and tidy up after
  yourself (archive, never delete).
- **Never run a migration yourself.** Write it, open a pull request, and Dean runs it. See
  [workflow.md](workflow.md#database-migrations).
- **No Notion writes while testing, and nothing gets deleted.** Scripts use
  `scripts/notion-readonly.ts`, never `new Client()`.
- Don't run the sync or backfill scripts (`sync:*`, `label`, `ideas:content`) without asking Dean:
  they write to the shared database and some call Claude, which costs money.
- `.env.local` holds keys that can read every client's data. Don't paste it into chats (Claude
  included), screenshots or tickets.

## Working with Claude Code

- Start each piece of work on its own branch (Claude can do this for you; see
  [workflow.md](workflow.md#day-to-day)).
- Claude commits locally. Tell it when to push your branch and open a pull request.
- If Claude suggests changing a write flag, deleting something or running a migration, the answer is no.
  Check with Dean.
