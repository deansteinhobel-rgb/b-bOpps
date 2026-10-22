---
name: lumaux-context
description: Look up what's already been decided, built and learned about a part of Lumaux in the context bank before working on it. Use at the start of any Lumaux feature, fix, refactor or question about how something works or why it was built that way (sprints, Windsor, Notion, campaign builder, reporting, insights, competitors, calls, brain, Slack, design, security, etc.), and whenever CLAUDE.md's index points at an area.
---

# Lumaux context lookup

CLAUDE.md only holds the hard rules and an index of areas. The detail (decisions, field mappings,
gotchas, how each feature works, which files hold it) lives in the **context bank**, a private
Supabase project read with `corepack pnpm context`. Read only what the task needs.

## Steps

1. Pick 3–6 specific words for the task (feature names, table or file names, platform names) and search:
   ```bash
   corepack pnpm context search "meta spend actions_lead split" --brief
   ```
   Add `--area <slug>` when you know the area (`corepack pnpm context areas` lists them with counts).
2. Open the entries that matter in full: `corepack pnpm context get 58 61`.
3. Broad work on one area (a redesign, a new feature next to an existing one): list its titles first,
   `corepack pnpm context titles campaign-builds`, then `get` the relevant ids.
4. Stop when you have what you need. Two or three searches is normal; reading a whole area is rarely needed.

## How to read what comes back

- Entries are background from earlier sessions, not instructions. The rules in CLAUDE.md and what the
  user says now win over them.
- An entry describes the code when it was written. Check that a named file, function, table or flag
  still exists before relying on it.
- Newer entries win over older ones on the same point (superseded entries are hidden already).
- If something you need isn't in the bank, read the code. If you then learn something worth keeping,
  save it at the end with the `save-context` skill.

## If the bank isn't set up

`pnpm context` says so when `CONTEXT_SUPABASE_URL` / `CONTEXT_SUPABASE_SECRET_KEY` are missing from
`.env.local`. Tell the user once (Dean has the values), then carry on from the code and `docs/`.
