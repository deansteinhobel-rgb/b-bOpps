/**
 * Takes today's live ads and ad fatigue copy for every client (or one), as the daily Windsor sync does.
 * Writes only our database (ad_fatigue_snapshots).
 *   pnpm snapshot:ads             # every client
 *   pnpm snapshot:ads dnsfilter   # one client
 */
import { snapshotAdFatigue } from "@/lib/metrics/fatigue-snapshot"
import { createAdminClient } from "@/lib/supabase/admin"

const slug = process.argv[2]
const admin = createAdminClient()
const started = Date.now()
async function main() {
  const { data: clients, error } = await admin.from("clients").select("id, slug")
  if (error) throw new Error(error.message)
  const picked = (clients ?? []).filter((c) => !slug || c.slug === slug)
  if (!picked.length) throw new Error(`No client "${slug}".`)
  const results = await snapshotAdFatigue(admin, picked.map((c) => c.id as string))
  for (const r of results) console.log(`  ${String(picked.find((c) => c.id === r.client_id)?.slug).padEnd(14)} ${r.error ? `FAILED: ${r.error}` : `${r.ads} ads`}`)
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(0)}s`)
}
main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
