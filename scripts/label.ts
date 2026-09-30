/**
 * Labels for comparing clients, from the command line (the same as the daily /api/cron/labels job,
 * without its limits). Claude labels every ad that has spent (format, content type, offer, hook,
 * topic, audience) and picks a lever for sprint tests that have none. Writes ad_labels and
 * sprint_tests.lever only; nothing outside our database.
 *   pnpm label                   every client with an ad account
 *   pnpm label dnsfilter         one client
 *   pnpm label --tests           tests only
 *   pnpm label --max 50          at most 50 ads per client (a trial run)
 *   pnpm label --force           re-label ads that already have a label
 */
import { labelAds } from "@/lib/labels/ads"
import { labelTests } from "@/lib/labels/tests"
import { createAdminClient } from "@/lib/supabase/admin"

const args = process.argv.slice(2)
const flag = (f: string) => args.includes(f)
const maxAt = args.indexOf("--max")
const max = maxAt >= 0 ? Number(args[maxAt + 1]) : undefined
const slug = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--max")

const db = createAdminClient()
const { data: accounts } = await db.from("client_platform_accounts").select("client_id, clients(slug, name)").eq("active", true)
const clients = [...new Map((accounts ?? []).map((a) => [a.client_id, a.clients as unknown as { slug: string; name: string }])).entries()].filter(([, c]) => !slug || c.slug === slug)
if (!clients.length) throw new Error(slug ? `No client "${slug}" with an ad account.` : "No clients with an ad account.")

const total = { input_tokens: 0, output_tokens: 0 }
for (const [clientId, c] of clients) {
  const t = await labelTests(clientId)
  total.input_tokens += t.usage.input_tokens
  total.output_tokens += t.usage.output_tokens
  console.log(`${c.name}: ${t.labeled} test levers`)
  if (flag("--tests")) continue
  const started = Date.now()
  const a = await labelAds(clientId, { max, force: flag("--force"), onBatch: (done, left) => console.log(`  ${c.name}: ${done} ads labeled, ${left} to go (${Math.round((Date.now() - started) / 1000)}s)`) })
  total.input_tokens += a.usage.input_tokens
  total.output_tokens += a.usage.output_tokens
  console.log(`${c.name}: ${a.labeled} ads labeled${a.left ? `, ${a.left} left` : ""}`)
}
// Claude Opus 5.5: $4 / $20 per million input / output tokens.
console.log(`Tokens: ${total.input_tokens} in, ${total.output_tokens} out (about $${((total.input_tokens * 4 + total.output_tokens * 20) / 1e6).toFixed(2)})`)
