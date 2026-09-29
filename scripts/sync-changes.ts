/**
 * Platform change history (Google Ads change history, Meta activity log, LinkedIn edited ads) into
 * platform_changes. Reads Windsor; writes only our database.
 *   pnpm sync:changes              # yesterday and today (same as the daily job)
 *   pnpm sync:changes --days 29    # backfill, a few days at a time (Google keeps 30 days, today included)
 */
import { syncPlatformChanges } from "@/lib/windsor/changes"
import { daysAgo } from "@/lib/windsor/sync"

const i = process.argv.indexOf("--days")
// Google Ads refuses change history older than 30 days (today included).
const days = Math.min(29, i > -1 ? Number(process.argv[i + 1]) : 1)
const t = Date.now()
// Busy Google accounts log tens of thousands of changes a day: go 3 days at a time.
for (let end = 0; end <= days; end += 3) {
  const from = daysAgo(Math.min(days, end + 2))
  const to = daysAgo(end)
  const results = await syncPlatformChanges({ from, to })
  for (const r of results) console.log(`  ${from}..${to}  ${r.account.padEnd(28)} ${r.error ? `FAILED: ${r.error}` : `${r.rows} grouped changes`} (${r.seconds}s)`)
}
console.log(`Done in ${Math.round((Date.now() - t) / 1000)}s`)
