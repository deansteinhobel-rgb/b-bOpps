# Lumaux (B&B Account Ops)

Internal app for Bordeaux & Burgundy: client performance, weekly QA checks and Notion action points in one place.

- **New here?** Start with [docs/onboarding.md](docs/onboarding.md).
- **How changes reach production, and how to roll back:** [docs/workflow.md](docs/workflow.md).
- **The project's rules and decisions:** [CLAUDE.md](CLAUDE.md).
- **Security:** [docs/security.md](docs/security.md).

## Setup

1. Install [Node.js](https://nodejs.org) 24.
2. Open a terminal in this folder and run:
   ```
   corepack pnpm install
   ```
3. Copy `.env.example` to a new file called `.env.local` and fill in the values. Each line has a comment explaining it.
   - `.env.local` is private and never uploaded to GitHub. Don't share its contents in chat or email.
4. `corepack pnpm dev`, then open http://localhost:3000.
