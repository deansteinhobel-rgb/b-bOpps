/**
 * Run the Windsor sync from the command line. Reads Windsor, writes our Supabase cache only.
 *
 *   pnpm sync:windsor                 # last 3 days, all active clients (same as the daily job)
 *   pnpm sync:windsor --backfill      # last 90 days
 *   pnpm sync:windsor --backfill camber
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { syncCampaignStatuses } from "@/lib/windsor/statuses"
import { daysAgo, syncWindsor } from "@/lib/windsor/sync"

async function main() {
  const backfill = process.argv.includes("--backfill")
  const slug = process.argv.slice(2).find((a) => !a.startsWith("--"))
  let clientId: string | undefined
  if (slug) {
    const { data } = await createAdminClient().from("clients").select("id").eq("slug", slug).single()
    if (!data) throw new Error(`No client with slug "${slug}"`)
    clientId = data.id
  }
  const dateFrom = daysAgo(backfill ? 90 : 3)
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
