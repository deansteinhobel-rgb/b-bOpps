# B&B Account Ops

Internal app for Bordeaux & Burgundy: client performance, weekly QA checks and Notion action points in one place.

Right now the project is in **Phase 0 (discovery)**. It only has two inspection scripts. They read Notion and Windsor.ai so we can agree how their data maps to the app, and they don't change anything.

## Setup

1. Install [Node.js](https://nodejs.org) 20 or newer.
2. Open a terminal in this folder and run:
   ```
   corepack pnpm install
   ```
3. Copy `.env.example` to a new file called `.env.local` and fill in the values. Each line has a comment explaining it.
   - `.env.local` is private and never uploaded to GitHub. Don't share its contents in chat or email.

## Phase 0 scripts

Share every Notion database or page you want inspected with the integration first: open it in Notion, then **••• → Connections →** add the integration.

```
corepack pnpm inspect:notion
corepack pnpm inspect:windsor
```

Each script prints what it found plus a **proposed mapping** to confirm or correct. The full output is saved in `scripts/output/`, which is also kept off GitHub.
