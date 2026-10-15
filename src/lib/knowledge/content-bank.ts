import "server-only"
import { iterateAllDataSourceRows, type Client } from "@notionhq/client"
import { otherClientsNotion } from "@/lib/knowledge/boundaries"
import { notion, pageText, propText, type Prop } from "@/lib/knowledge/notion-hq"
import { CONTENT_BANK } from "@/lib/notion/config"
import { throttled } from "@/lib/notion/throttle"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * The Content Bank as a Client brain source (Dean, 2026-10-15). One shared Notion database holds
 * content pieces, transcripts and source notes for every client, told apart by a free-text "Client"
 * property ("FileVine", "DNSFilter"). READ ONLY: everything goes through the guarded client.
 *
 * Client isolation: a row only ever lands in the brain of a client its Client names (case and
 * spacing ignored, against the client's name and its Notion Client option), and the match is checked
 * again right before its text is stored. Rows whose Client changes away are soft-removed.
 */

const COLLECTION = "content_bank"
const P = CONTENT_BANK.prop

type BankRow = { id: string; last_edited_time: string; created_time: string; properties: Record<string, Prop> }

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")
/** The client names a row's Client field holds: one, or several separated by commas, semicolons, slashes or lines. */
export const bankClients = (value: string) => value.split(/[,;/|\n]+/).map(normName).filter(Boolean)
const prop = (row: BankRow, name: string) => (row.properties[name] ? propText(row.properties[name]) : "").trim()
const pathOf = (row: BankRow) => [prop(row, P.format), prop(row, P.tags)].filter(Boolean).join(" · ")

async function clientNames(clientId: string) {
  const { data } = await createAdminClient().from("clients").select("name, notion_client_option").eq("id", clientId).single()
  if (!data) throw new Error("Client not found")
  return new Set([data.name, data.notion_client_option].filter(Boolean).map((s) => normName(String(s))))
}
const isFor = (row: BankRow, names: Set<string>) => bankClients(prop(row, P.client)).some((c) => names.has(c))

/** The row's properties, then its body (the notes). */
function header(row: BankRow) {
  const lines = [
    `Content Bank entry: ${prop(row, P.title) || "Untitled"}`,
    ...[
      ["Client", P.client],
      ["Format", P.format],
      ["Tags", P.tags],
      ["Date added", P.dateAdded],
      ["Added by", P.addedBy],
      ["Summary", P.summary],
      ["Source note", P.sourceNote],
    ].map(([label, key]) => [label, prop(row, key)] as const).filter(([, v]) => v).map(([label, v]) => `${label}: ${v}`),
  ]
  if (!prop(row, P.dateAdded)) lines.push(`Date added: ${row.created_time.slice(0, 10)}`)
  return lines.join("\n")
}

/**
 * Step 1: match the Content Bank's rows to this client (properties only, a few requests even for
 * hundreds of rows). New rows are added and count toward the brief; rows edited in Notion are marked
 * for re-reading; rows gone from the bank, or now for another client, are soft-removed. Writes only
 * our own database.
 */
export async function discoverContentBank(clientId: string) {
  const db = createAdminClient()
  const names = await clientNames(clientId)
  const n = notion()
  const query: Client["dataSources"]["query"] = (args) => throttled(() => n.dataSources.query(args))
  const mine: BankRow[] = []
  for await (const page of iterateAllDataSourceRows({ dataSources: { query } } as unknown as Client, { data_source_id: CONTENT_BANK.dataSourceId, page_size: 100 })) {
    if ("properties" in page && isFor(page as unknown as BankRow, names)) mine.push(page as unknown as BankRow)
  }

  const { data: existing } = await db.from("client_knowledge").select("id, notion_page_id, notion_collection, removed_at").eq("client_id", clientId).eq("source", "notion")
  const byId = new Map((existing ?? []).map((e) => [normName(e.notion_page_id ?? ""), e]))
  const now = new Date().toISOString()
  let added = 0
  for (const row of mine) {
    const known = byId.get(normName(row.id))
    const fields = { title: prop(row, P.title) || "Untitled", path: pathOf(row), last_edited_time: row.last_edited_time }
    if (!known) {
      await db.from("client_knowledge").insert({ client_id: clientId, source: "notion", notion_collection: COLLECTION, notion_page_id: row.id, notion_kind: "page", include: true, ...fields })
      added++
    } else if (known.notion_collection === COLLECTION) {
      await db.from("client_knowledge").update({ ...fields, removed_at: null }).eq("id", known.id)
    }
  }
  const keep = new Set(mine.map((r) => normName(r.id)))
  const gone = (existing ?? []).filter((e) => e.notion_collection === COLLECTION && !e.removed_at && !keep.has(normName(e.notion_page_id ?? "")))
  if (gone.length) await db.from("client_knowledge").update({ removed_at: now }).in("id", gone.map((g) => g.id))
  return { entries: mine.length, added, removed: gone.length }
}

/** Included Content Bank rows that need reading: never read, edited in Notion since, or read before `since`. */
export async function staleEntries(clientId: string, since?: string) {
  const { data } = await createAdminClient().from("client_knowledge").select("id, notion_page_id, last_edited_time, synced_at, content").eq("client_id", clientId).eq("source", "notion").eq("notion_collection", COLLECTION).eq("include", true).is("removed_at", null)
  return (data ?? []).filter((k) => !k.content || !k.synced_at || (k.last_edited_time && k.last_edited_time > k.synced_at) || (since && k.synced_at < since))
}

/** Step 2: read stale rows (properties and body) until `budgetMs` runs out. Returns how many are left. */
export async function readContentBank(clientId: string, opts: { since?: string; budgetMs?: number } = {}) {
  const started = Date.now()
  const todo = await staleEntries(clientId, opts.since)
  if (!todo.length) return { read: 0, remaining: 0, errors: [] as string[] }
  const [names, skip] = await Promise.all([clientNames(clientId), otherClientsNotion(clientId)])
  let read = 0
  const errors: string[] = []
  for (const k of todo) {
    if (opts.budgetMs && Date.now() - started > opts.budgetMs) break
    const err = await readEntry(k.id, k.notion_page_id!, names, skip)
    if (err) errors.push(err)
    read++
  }
  return { read, remaining: todo.length - read, errors }
}

async function readEntry(knowledgeId: string, pageId: string, names: Set<string>, skip: Set<string>) {
  const db = createAdminClient()
  const n = notion()
  const now = new Date().toISOString()
  try {
    const row = (await throttled(() => n.pages.retrieve({ page_id: pageId }))) as unknown as BankRow & { parent?: { data_source_id?: string; database_id?: string }; in_trash?: boolean }
    const inBank = normName(row.parent?.data_source_id ?? "") === normName(CONTENT_BANK.dataSourceId) || normName(row.parent?.database_id ?? "") === normName(CONTENT_BANK.databaseId)
    // Checked again right before storing: the row must still be in the bank and still name this client.
    if (!inBank || row.in_trash || !isFor(row, names)) {
      await db.from("client_knowledge").update({ removed_at: now, synced_at: now }).eq("id", knowledgeId)
      return null
    }
    const body = await pageText(n, pageId, 0, skip)
    const text = `${header(row)}${body ? `\n\n## Notes\n${body}` : ""}`
    await db.from("client_knowledge").update({ title: prop(row, P.title) || "Untitled", path: pathOf(row), last_edited_time: row.last_edited_time, content: text, content_chars: text.length, synced_at: now, error: null, updated_at: now }).eq("id", knowledgeId)
    return null
  } catch (e) {
    await db.from("client_knowledge").update({ error: (e as Error).message.slice(0, 300), synced_at: now }).eq("id", knowledgeId)
    return (e as Error).message
  }
}

/** Both steps in one go, for scripts and the nightly job (no time budget). */
export async function syncContentBank(clientId: string, opts: { force?: boolean } = {}) {
  const d = await discoverContentBank(clientId)
  const r = await readContentBank(clientId, { since: opts.force ? new Date().toISOString() : undefined })
  return { ...d, ...r }
}

/** Reads one row on demand (after someone ticks it). */
export async function readContentBankEntry(knowledgeId: string) {
  const { data: k } = await createAdminClient().from("client_knowledge").select("id, client_id, notion_page_id").eq("id", knowledgeId).eq("notion_collection", COLLECTION).single()
  if (k) await readEntry(k.id, k.notion_page_id!, await clientNames(k.client_id), await otherClientsNotion(k.client_id))
}

/** A short list of the client's Content Bank entries for prompts (title, format, date, summary), newest first. */
export async function contentBankForPrompt(clientId: string, opts: { limit?: number; summaryChars?: number; notesChars?: number } = {}) {
  const { data } = await createAdminClient()
    .from("client_knowledge")
    .select("title, path, content")
    .eq("client_id", clientId)
    .eq("notion_collection", COLLECTION)
    .eq("include", true)
    .is("removed_at", null)
    .not("content", "is", null)
    .order("last_edited_time", { ascending: false })
    .limit(opts.limit ?? 20)
  return (data ?? []).map((k) => {
    const content = k.content ?? ""
    const [head, notes = ""] = content.split("\n\n## Notes\n")
    const field = (label: string) => head.match(new RegExp(`^${label}: (.*)$`, "m"))?.[1] ?? ""
    const summary = field("Summary").slice(0, opts.summaryChars ?? 300)
    const excerpt = opts.notesChars ? notes.replace(/\s+/g, " ").slice(0, opts.notesChars) : ""
    return `- ${k.title}${k.path ? ` (${k.path})` : ""}, added ${field("Date added") || "–"}${summary ? `: ${summary}` : ""}${excerpt ? `\n  Notes excerpt: ${excerpt}` : ""}`
  })
}
