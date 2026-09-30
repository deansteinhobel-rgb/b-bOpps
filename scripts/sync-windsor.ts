/**
 * Run the Windsor sync from the command line. Reads Windsor, writes our Supabase cache only.
 *
 *   pnpm sync:windsor                 # last 14 days, all active clients (same as the daily job)
 *   pnpm sync:windsor --backfill      # last 90 days
 *   pnpm sync:windsor --backfill camber
 *   pnpm sync:windsor --history 2018-01-01 [slug]   # whole history, month by month (custom ranges)
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { syncCampaignStatuses } from "@/lib/windsor/statuses"
import { daysAgo, loadHistory, syncWindsor } from "@/lib/windsor/sync"

async function main() {
  const backfill = process.argv.includes("--backfill")
  const hi = process.argv.indexOf("--history")
  const historyFrom = hi > 0 ? process.argv[hi + 1] : null
  if (historyFrom !== null && !/^\d{4}-\d{2}-\d{2}$/.test(historyFrom ?? "")) throw new Error("--history needs a start date, e.g. --history 2018-01-01")
  const slug = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--history")
  let clientId: string | undefined
  if (slug) {
    const { data } = await createAdminClient().from("clients").select("id").eq("slug", slug).single()
    if (!data) throw new Error(`No client with slug "${slug}"`)
    clientId = data.id
  }
  if (historyFrom) {
    console.log(`Windsor history ${historyFrom} to ${daysAgo(1)}${slug ? ` for ${slug}` : ""}`)
    const failures = await loadHistory({ clientId, from: historyFrom, to: daysAgo(1), onMonth: (l) => console.log(`  ${l}`) })
    if (failures.length) {
      console.log(`\n${failures.length} month(s) need a look:`)
      for (const f of failures) console.log(`  ${f.slice(0, 300)}`)
      process.exit(1)
    }
    return
  }
  const dateFrom = daysAgo(backfill ? 90 : 14)
  const dateTo = daysAgo(1)
  console.log(`Windsor ${backfill ? "backfill" : "daily"} sync ${dateFrom} to ${dateTo}${slug ? ` for ${slug}` : ""}`)
  const results = await syncWindsor({ clientId, dateFrom, dateTo, kind: backfill ? "backfill" : "daily" })
  for (const r of results) console.log(`  ${r.account.padEnd(32)} ${r.error ? "FAILED: " + r.error : `${r.rows} rows`}`)
  for (const r of await syncCampaignStatuses({ clientId, to: daysAgo(0) })) console.log(`  status ${r.account.padEnd(25)} ${r.error ? "FAILED: " + r.error : `${r.rows} campaigns`}`)
  if (results.some((r) => r.error)) process.exit(1)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
