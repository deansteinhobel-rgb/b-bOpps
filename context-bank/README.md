# Context bank

What we've decided and learned while building Lumaux, for Claude Code sessions. It replaced the long
feature notes in `CLAUDE.md` (2026-10-22), which now holds only the hard rules and an index.

- **Where**: its own Supabase project (not the Lumaux database, which holds client data and is shared
  with production). Private: nothing is exposed to the Data API; `scripts/context.ts` uses the secret key.
- **Setup** (once per project): run `schema.sql` in the project's SQL editor.
- **Setup** (once per developer): add `CONTEXT_SUPABASE_URL` and `CONTEXT_SUPABASE_SECRET_KEY` to `.env.local`
  (values from Dean / the password manager).
- **Use**: Claude reads it through the `lumaux-context` skill and writes to it through `save-context`
  (`.claude/skills/`). By hand: `corepack pnpm context` prints the commands.
- **Never deleted**: a changed decision is a new entry that supersedes the old one; edits keep the old
  text in `context_entry_history`.
