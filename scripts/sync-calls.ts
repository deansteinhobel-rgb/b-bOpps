/**
 * Client call notes: read each client's call notes from Notion (READ ONLY), have Claude read them,
 * then run the follow-up check.
 *   pnpm sync:calls                       # every client with call notes linked
 *   pnpm sync:calls proactis --full       # one client, re-read every call
 *   pnpm sync:calls --link proactis=<Notion link or id>
 *   pnpm sync:calls --link proactis=<link>,star-global=<link>   # a shared database: each client's
 *                                         # Client option comes from its name, or --option <name>
 *   pnpm sync:calls --no-ai               # Notion only
 */
import { extractPending } from "@/lib/calls/extract"
import { checkFollowUps } from "@/lib/calls/followups"
import { notionIdFrom, optionFor, resolveCallSource, syncCallNotes } from "@/lib/calls/notion"
import { createAdminClient } from "@/lib/supabase/admin"

const db = createAdminClient()
const args = process.argv.slice(2)
const oi = args.indexOf("--option")
const opt = oi > -1 ? args[oi + 1] : undefined
const li = args.indexOf("--link")
if (li > -1) {
  for (const pair of args[li + 1].split(",")) {
    const [slug, link] = pair.split("=")
    const id = notionIdFrom(link)
    if (!id) { console.log(`  ${slug}: not a Notion link`); continue }
    const src = await resolveCallSource(id)
    // A database shared by several clients: this client's Client option, from --option or its name.
    const { data: client } = await db.from("clients").select("name, notion_client_option").eq("slug", slug).single()
    const option = src.clientOptions ? (opt && src.clientOptions.includes(opt) ? opt : optionFor(src.clientOptions, [client?.name, client?.notion_client_option])) : null
    if (src.clientOptions && !option) { console.log(`  ${slug}: "${src.title}" is shared. Pick one with --option: ${src.clientOptions.join(", ")}`); continue }
    const { error } = await db
      .from("clients")
      .update({ call_notes_notion_id: src.id, call_notes_kind: src.kind, call_notes_client_option: option, call_notes_title: src.title, call_notes_checked_at: null })
      .eq("slug", slug)
    console.log(error ? `  ${slug}: ${error.message}` : `  linked ${slug} → ${src.kind} "${src.title}"${option ? ` (Client: ${option})` : ""}`)
  }
}
const only = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--link" && args[i - 1] !== "--option")
let q = db.from("clients").select("id, slug").not("call_notes_notion_id", "is", null)
if (only) q = q.eq("slug", only)
const { data: clients } = await q
for (const c of clients ?? []) {
  const t = Date.now()
  let s = await syncCallNotes(c.id, { full: args.includes("--full") })
  while (s.remaining > 0) s = await syncCallNotes(c.id)
  console.log(`  ${c.slug}: ${s.found} calls found, ${s.read} read (${((Date.now() - t) / 1000).toFixed(0)}s)`)
  if (args.includes("--no-ai")) continue
  const e = await extractPending(c.id)
  console.log(`  ${c.slug}: ${e.extracted} read by Claude (${((Date.now() - t) / 1000).toFixed(0)}s)`)
  const f = await checkFollowUps(c.id)
  console.log(`  ${c.slug}: ${f.checked} open follow-ups checked, ${f.acted} seen happening, ${f.due} new reminders`)
}
