---
name: save-context
description: Save what this Lumaux session decided or learned to the context bank, so later sessions can find it without re-deriving it. Use when a piece of Lumaux work is finished (before or after opening its pull request), when the user makes or changes a decision ("from now on…", "Dean: …"), when you hit a non-obvious gotcha (an API quirk, a platform limit, a slow query and its fix), or when the user says "save this", "remember this for Lumaux" or "add it to the bank".
---

# Save to the Lumaux context bank

The bank (`corepack pnpm context`) replaces the long feature notes that used to live in CLAUDE.md.
Each entry is **one fact** a future session would otherwise have to rediscover.

## What to save

- **decision**: something the user decided and why (who, when). E.g. "Reddit target $750, view-through included".
- **rule**: a constraint that must hold (only if it isn't already one of CLAUDE.md's hard rules).
- **gotcha**: a quirk that cost time: an API that drops rows, a limit, a workaround, and how we handle it.
- **how_it_works**: how a feature is put together: the flow, the tables, the files, the cron, the gates.
- **mapping**: field or ID mappings (Windsor fields, Notion properties, account IDs).
- **todo**: something deliberately left for later, with what's pending and on whom.

Don't save what the code or git history already says plainly, step-by-step narration of the session,
secrets or keys of any kind, or guesses. Client names, account IDs and Notion IDs are fine (the bank is private).

## Steps

1. Draft the entries. Each one:
   - `area`: an existing slug where it fits (`corepack pnpm context areas`), else a new lowercase slug.
   - `title`: a findable one-line claim, not a label ("Windsor Meta zeroes spend when actions_* come with metrics", not "Meta issue").
   - `body`: 40–250 words, plain US English, the why included. Name files as `src/...` paths.
   - `kind`, `files` (paths it concerns), `decided_by` and `decided_on` (absolute `YYYY-MM-DD`) for decisions.
2. Check for an existing entry on the same point: `corepack pnpm context search "<words>" --brief`.
   If the new one changes it, add `"supersedes": <old id>`; if it only adds a detail, prefer
   `corepack pnpm context update <id> <file.json>` with the new `body` (the old text is kept in history).
3. Show the user the titles (and the ids it supersedes) in a short list and ask before saving,
   unless they already asked you to save.
4. Write them to a JSON file in your scratchpad (an object or an array) and run
   `corepack pnpm context add <file.json>`. Report the new ids in one line.

```json
[
  {
    "area": "windsor",
    "kind": "gotcha",
    "title": "Windsor's Meta connector zeroes spend when actions_* fields come with metrics",
    "body": "Asking for actions_lead together with spend over more than one day returns every row, but spend and impressions are 0 on all days except the last ... So Meta's action fields come in their own request (splitFieldsFor) and are merged by date, campaign and ad (mergeSplitRows).",
    "files": ["src/lib/windsor/client.ts"],
    "decided_by": "Dean",
    "decided_on": "2026-10-21"
  }
]
```

Nothing is ever deleted from the bank. A wrong entry is superseded by a corrected one.
