/**
 * Competitor ads from the command line: queue this week's runs and keep pumping until they're all
 * collected. Reads the public ad libraries through Apify; writes only our database and storage.
 *   pnpm sync:competitors dnsfilter   # queue (skips anything read in the last 3 days) and collect
 *   pnpm sync:competitors dnsfilter --force --sources meta   # read Meta again now
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { COMPETITOR_SOURCES, type CompetitorSource } from "@/lib/competitors/sources"
import { pump, queueWeek } from "@/lib/competitors/sync"

async function main() {
  const slug = process.argv[2]
  if (!slug) throw new Error("Usage: pnpm sync:competitors <client slug>")
  const db = createAdminClient()
  const { data: client } = await db.from("clients").select("id, name").eq("slug", slug).single()
  if (!client) throw new Error(`No client "${slug}"`)
  const at = process.argv.indexOf("--sources")
  const sources = at > -1 ? (process.argv[at + 1].split(",").filter((s) => (COMPETITOR_SOURCES as readonly string[]).includes(s)) as CompetitorSource[]) : undefined
  console.log(`${client.name}: queued ${(await queueWeek({ clientId: client.id, force: process.argv.includes("--force"), sources })).queued} runs`)
  for (let pass = 1; pass <= 40; pass++) {
    const r = await pump({ clientId: client.id, maxCopies: 200 })
    console.log(`  pass ${pass}: started ${r.started}, collected ${r.collected} (${r.ads} ads), failed ${r.failed}, closed ${r.closed}, images ${r.copied}${r.errors.length ? `, errors: ${r.errors.join("; ")}` : ""}`)
    if (!r.open) break
    await new Promise((res) => setTimeout(res, 20_000))
  }
}
main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
