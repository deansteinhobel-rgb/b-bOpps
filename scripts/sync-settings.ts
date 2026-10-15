/**
 * Platform settings (Google location option, networks, AI Max; Meta Advantage+ audience, locations and
 * Audience Network; LinkedIn Audience Network) into platform_settings. Reads Windsor; writes only our database.
 *   pnpm sync:settings            # every client (same as the daily job)
 *   pnpm sync:settings dnsfilter  # one client
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { syncPlatformSettings } from "@/lib/windsor/settings"
import { daysAgo } from "@/lib/windsor/sync"

const slug = process.argv[2]
let clientId: string | undefined
if (slug) {
  const { data } = await createAdminClient().from("clients").select("id").eq("slug", slug).single()
  if (!data) throw new Error(`No client ${slug}`)
  clientId = data.id as string
}
const t = Date.now()
for (const r of await syncPlatformSettings({ clientId, to: daysAgo(0) })) console.log(`  ${r.account.padEnd(28)} ${r.error ? `FAILED: ${r.error}` : `${r.rows} rows`}`)
console.log(`Done in ${Math.round((Date.now() - t) / 1000)}s`)
