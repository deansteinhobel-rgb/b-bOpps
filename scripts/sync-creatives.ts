/**
 * Ad previews from the command line: record preview links and copy images into storage.
 * Reads Windsor; writes only our database and storage.
 *   pnpm sync:creatives              # ads seen in the last 3 days (daily)
 *   pnpm sync:creatives --days 90    # first fill / backfill
 */
import { daysAgo } from "@/lib/windsor/sync"
import { syncCreatives } from "@/lib/windsor/creatives"

const i = process.argv.indexOf("--days")
const days = i > -1 ? Number(process.argv[i + 1]) : 3
const started = Date.now()
syncCreatives({ dateFrom: daysAgo(days), dateTo: daysAgo(1), maxCopies: 1000 })
  .then((results) => {
    for (const r of results) console.log(`  ${r.account.padEnd(28)} ${r.error ? `FAILED: ${r.error}` : `${r.ads} ads, ${r.copied} images saved, ${r.failed} failed`}`)
    console.log(`Done in ${((Date.now() - started) / 1000).toFixed(0)}s`)
  })
  .catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
