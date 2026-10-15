/**
 * Client brain: read each client's Notion GTM HQ and its Content Bank rows into client_knowledge.
 * READ ONLY toward Notion.
 *   pnpm sync:hq                 # changed pages only
 *   pnpm sync:hq --force         # re-read every included page
 *   pnpm sync:hq dnsfilter       # one client
 *   pnpm sync:hq --link camber=<page id>   # link a client's HQ page first
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { syncContentBank } from "@/lib/knowledge/content-bank"
import { syncClientHq } from "@/lib/knowledge/notion-hq"

const db = createAdminClient()
const args = process.argv.slice(2)
const li = args.indexOf("--link")
if (li > -1) {
  for (const pair of args[li + 1].split(",")) {
    const [slug, page] = pair.split("=")
    const { error } = await db.from("clients").update({ notion_hq_page_id: page }).eq("slug", slug)
    console.log(error ? `  ${slug}: ${error.message}` : `  linked ${slug} → ${page}`)
  }
}
const only = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--link")
const { data: clients } = await db.from("clients").select("id, slug, notion_hq_page_id").eq("active", true)
for (const c of (clients ?? []).filter((c) => !only || c.slug === only)) {
  const t = Date.now()
  const force = args.includes("--force")
  // One client's failure (e.g. its HQ page not shared with the connection) doesn't stop the others.
  if (c.notion_hq_page_id) {
    const r = await syncClientHq(c.id, { force }).catch((e: Error) => {
      console.log(`  ${c.slug}: HQ failed: ${e.message}`)
      return null
    })
    if (r) console.log(`  ${c.slug}: ${r.pages} pages found, ${r.added} new, ${r.read} read, ${r.remaining} left${r.errors.length ? `, ${r.errors.length} errors: ${r.errors.slice(0, 3).join(" | ")}` : ""} (${((Date.now() - t) / 1000).toFixed(0)}s)`)
  }
  const b = await syncContentBank(c.id, { force }).catch((e: Error) => {
    console.log(`  ${c.slug}: Content Bank failed: ${e.message}`)
    return null
  })
  if (b && (b.entries || b.removed)) console.log(`  ${c.slug}: Content Bank ${b.entries} entries, ${b.added} new, ${b.removed} removed, ${b.read} read${b.errors.length ? `, ${b.errors.length} errors: ${b.errors.slice(0, 3).join(" | ")}` : ""}`)
}
