/**
 * Draws a client's weekly snapshot pictures (the client snapshot and the ad performance board) into a
 * folder, without sending anything. Reads only.
 *   pnpm slack:images dnsfilter [out dir]
 */
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { appUrl } from "@/lib/reports/send"
import { snapshotImages } from "@/lib/reports/snapshot-images"
import { weeklySnapshot } from "@/lib/reports/weekly"
import { createAdminClient } from "@/lib/supabase/admin"

const slug = process.argv[2]
const out = process.argv[3] ?? "scripts/output"
async function main() {
  if (!slug) throw new Error("Usage: pnpm slack:images <client slug> [out dir]")
  const admin = createAdminClient()
  const { data: client } = await admin.from("clients").select("id").eq("slug", slug).maybeSingle()
  if (!client) throw new Error(`No client "${slug}".`)
  const snap = await weeklySnapshot(admin, client.id)
  if (!snap) throw new Error("No ad data for this client.")
  const started = Date.now()
  const pics = await snapshotImages(snap, appUrl())
  await mkdir(out, { recursive: true })
  for (const [name, buf] of Object.entries(pics)) {
    const file = path.join(out, `${slug}-${name}.png`)
    await writeFile(file, buf)
    console.log(`${file} (${Math.round(buf.length / 1024)} kB)`)
  }
  console.log(`Drawn in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}
main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
