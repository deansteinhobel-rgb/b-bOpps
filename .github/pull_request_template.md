## What changed

<!-- One or two sentences. What can someone see or do now that they couldn't before? -->

## How to check it

<!-- The page(s) to open on the Vercel preview or localhost, and what to look for. -->

## Checklist

- [ ] Checked on localhost or the Vercel preview
- [ ] No Notion writes while testing: the Notion and Windsor write flags were left at their safe values
- [ ] No deletes, and no new Notion properties or select options
- [ ] New queries and tables are scoped by `client_id`, with RLS
- [ ] **Migration?** If yes: it's additive only, its timestamp is later than every migration on `main`, and Dean runs it (say when it needs to run: before or after merging)
- [ ] New outside origins (images, scripts, fetches) are added to the CSP in `src/proxy.ts`
- [ ] New routes that call Claude or take uploads have a rate limit
- [ ] `CLAUDE.md` updated if a decision or rule changed
