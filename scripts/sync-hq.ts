/**
 * Client brain: read each client's Notion GTM HQ into client_knowledge. READ ONLY towards Notion.
 *   pnpm sync:hq                 # changed pages only
 *   pnpm sync:hq --force         # re-read every included page
 *   pnpm sync:hq --link camber=<page id>   # link a client's HQ page first
 */
import { createAdminClient } from "@/lib/supabase/admin"
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
const { data: clients } = await db.from("clients").select("id, slug").not("notion_hq_page_id", "is", null)
for (const c of clients ?? []) {
  const t = Date.now()
  const r = await syncClientHq(c.id, { force: args.includes("--force") })
  console.log(`  ${c.slug}: ${r.pages} pages found, ${r.added} new, ${r.read} read${r.errors.length ? `, ${r.errors.length} errors: ${r.errors.slice(0, 3).join(" | ")}` : ""} (${((Date.now() - t) / 1000).toFixed(0)}s)`)
}
