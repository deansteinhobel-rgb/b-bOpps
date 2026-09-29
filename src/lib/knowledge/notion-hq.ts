import "server-only"
import type { Client } from "@notionhq/client"
import { NOTION_VERSION } from "@/lib/notion/config"
import { readOnlyNotion } from "@/lib/notion/readonly"
import { throttled } from "@/lib/notion/throttle"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Reads a client's GTM HQ page tree in B&B's Notion for the Client brain. READ ONLY: it uses the
 * guarded client, so any write throws before a request is sent (Dean: read, never write, never
 * delete). Only pages and databases found under the client's own HQ page are ever read.
 */

// Default picks (Dean, 2026-09-29): strategy, ICP/personas, messaging, reporting, plans,
// proposals. Admin tooling, templates, contacts and production boards are left out.
const INCLUDE = /messaging|persona|\bicp\b|kpi|pipeline performance|channel performance|sales overview|\babx\b|smb|overview|strategy|events|website|proposal|content pivot|tla concepts|chatgpt|working on these|audit|pod.?plan|paid media review|cost per lead|a\/b testing|campaign|feature-led|squeeze|naming standard|new ad project|account health/i
const EXCLUDE = /file link|account access|kick-?off|design system|content dam|systems directory|walkthrough|points of contact|clay|template|production board|email qa|live lp links|newsletter opt-in|crm optimization|crm setup|raymond|content calendar|sales journey/i
export const defaultInclude = (title: string) => INCLUDE.test(title) && !EXCLUDE.test(title)

const MAX_PAGE_CHARS = 40_000
const MAX_DB_ROWS = 150

type Candidate = { id: string; kind: "page" | "database"; title: string; path: string; lastEdited: string | null }
type Block = { id: string; type: string; has_children: boolean; [k: string]: unknown }
type RichText = { plain_text: string; href?: string | null }

function notion() {
  const token = process.env.NOTION_TOKEN
  if (!token) throw new Error("NOTION_TOKEN is not set")
  return readOnlyNotion(token, NOTION_VERSION)
}

async function children(n: Client, id: string): Promise<Block[]> {
  const out: Block[] = []
  let cursor: string | undefined
  do {
    const r = await throttled(() => n.blocks.children.list({ block_id: id, start_cursor: cursor, page_size: 100 }))
    out.push(...(r.results as unknown as Block[]))
    cursor = r.has_more ? (r.next_cursor ?? undefined) : undefined
  } while (cursor)
  return out
}

const rt = (a: RichText[] | undefined) => (a ?? []).map((x) => (x.href && !x.plain_text.startsWith("http") ? `${x.plain_text} (${x.href})` : x.plain_text)).join("")
// Blocks that can hold sub-pages in an HQ layout. Lists, tables and quotes are skipped during
// discovery (their text is still read when the page itself is read).
const CONTAINERS = new Set(["toggle", "column_list", "column", "callout", "heading_1", "heading_2", "heading_3", "synced_block"])
const titleOf = (b: Block) => String((b[b.type] as { title?: string })?.title ?? "Untitled").trim() || "Untitled"

/**
 * Every page and database under the HQ, through toggles and columns: the HQ's own pages, plus the
 * pages one level inside them (the HQ menu lives on a child page). Deeper sub-pages are read as
 * part of their parent. Returns them with their place in the tree.
 */
export async function discoverHq(rootId: string): Promise<Candidate[]> {
  const n = notion()
  const found: Candidate[] = []
  const seen = new Set<string>()
  async function walk(id: string, path: string[], pageDepth: number) {
    for (const b of await children(n, id)) {
      if (b.type === "child_page" || b.type === "child_database") {
        if (seen.has(b.id)) continue
        seen.add(b.id)
        const title = titleOf(b)
        found.push({ id: b.id, kind: b.type === "child_page" ? "page" : "database", title, path: path.join(" › "), lastEdited: (b.last_edited_time as string) ?? null })
        if (b.type === "child_page" && pageDepth < 1) await walk(b.id, [...path, title], pageDepth + 1)
      } else if (b.has_children && CONTAINERS.has(b.type)) {
        const label = b.type === "toggle" || b.type.startsWith("heading") ? rt((b[b.type] as { rich_text?: RichText[] })?.rich_text) : ""
        await walk(b.id, label ? [...path, label] : path, pageDepth)
      }
    }
  }
  await walk(rootId, [], 0)
  return found
}

/** A page as markdown-ish text, including its sub-pages (one level) and inline databases. */
async function pageText(n: Client, id: string, depth = 0): Promise<string> {
  const lines: string[] = []
  async function render(blocks: Block[], indent: string) {
    for (const b of blocks) {
      if (lines.join("\n").length > MAX_PAGE_CHARS) return
      const v = (b[b.type] ?? {}) as { rich_text?: RichText[]; checked?: boolean; url?: string; caption?: RichText[]; title?: string; cells?: RichText[][] }
      const text = rt(v.rich_text)
      switch (b.type) {
        case "heading_1": lines.push(`\n${indent}# ${text}`); break
        case "heading_2": lines.push(`\n${indent}## ${text}`); break
        case "heading_3": lines.push(`\n${indent}### ${text}`); break
        case "paragraph": if (text) lines.push(indent + text); break
        case "bulleted_list_item": case "toggle": lines.push(`${indent}- ${text}`); break
        case "numbered_list_item": lines.push(`${indent}1. ${text}`); break
        case "to_do": lines.push(`${indent}- [${v.checked ? "x" : " "}] ${text}`); break
        case "quote": case "callout": lines.push(`${indent}> ${text}`); break
        case "code": lines.push(`${indent}${text}`); break
        case "table_row": lines.push(`${indent}| ${(v.cells ?? []).map((c) => rt(c)).join(" | ")} |`); break
        case "bookmark": case "embed": case "link_preview": case "video": case "image": case "file": case "pdf":
          lines.push(`${indent}[${b.type}${v.url ? `: ${v.url}` : ""}${rt(v.caption) ? ` (${rt(v.caption)})` : ""}]`)
          break
        case "child_page":
          if (depth < 1) lines.push(`\n${indent}## Sub-page: ${titleOf(b)}\n${await pageText(n, b.id, depth + 1)}`)
          else lines.push(`${indent}[Sub-page: ${titleOf(b)}]`)
          continue
        case "child_database":
          lines.push(`\n${indent}## Database: ${titleOf(b)}\n${await databaseText(n, b.id).catch((e) => `[Couldn't read this database: ${(e as Error).message}]`)}`)
          continue
      }
      if (b.has_children) await render(await children(n, b.id), b.type === "column_list" || b.type === "column" || b.type === "synced_block" || b.type === "table" ? indent : indent + "  ")
    }
  }
  await render(await children(n, id), "")
  return lines.join("\n").trim().slice(0, MAX_PAGE_CHARS)
}

type Prop = { type: string; [k: string]: unknown }
function propText(p: Prop): string {
  const v = p[p.type] as unknown
  switch (p.type) {
    case "title": case "rich_text": return rt(v as RichText[])
    case "select": case "status": return (v as { name?: string } | null)?.name ?? ""
    case "multi_select": return ((v as { name: string }[]) ?? []).map((x) => x.name).join(", ")
    case "number": return v === null || v === undefined ? "" : String(v)
    case "checkbox": return v ? "yes" : ""
    case "date": return (v as { start?: string; end?: string } | null)?.start ?? ""
    case "url": case "email": case "phone_number": return (v as string) ?? ""
    case "people": return ((v as { name?: string }[]) ?? []).map((x) => x.name ?? "").filter(Boolean).join(", ")
    case "formula": { const f = v as { type: string; [k: string]: unknown }; return f ? String(f[f.type] ?? "") : "" }
    default: return ""
  }
}

/** A database's rows as "Title: prop value; prop value" lines (up to MAX_DB_ROWS). */
async function databaseText(n: Client, id: string): Promise<string> {
  const db = (await throttled(() => n.databases.retrieve({ database_id: id }))) as unknown as { data_sources?: { id: string }[] }
  const ds = db.data_sources?.[0]?.id
  if (!ds) return "[No readable data source]"
  const rows: string[] = []
  let cursor: string | undefined
  do {
    const r = await throttled(() => n.dataSources.query({ data_source_id: ds, start_cursor: cursor, page_size: 100 }))
    for (const page of r.results as unknown as { properties?: Record<string, Prop> }[]) {
      const props = Object.entries(page.properties ?? {})
      const title = props.find(([, p]) => p.type === "title")
      const rest = props.filter(([, p]) => p.type !== "title").map(([k, p]) => [k, propText(p)] as const).filter(([, v]) => v)
      rows.push(`- ${title ? propText(title[1]) || "Untitled" : "Row"}${rest.length ? `: ${rest.map(([k, v]) => `${k}: ${v}`).join("; ")}` : ""}`)
      if (rows.length >= MAX_DB_ROWS) break
    }
    cursor = r.has_more && rows.length < MAX_DB_ROWS ? (r.next_cursor ?? undefined) : undefined
  } while (cursor)
  return rows.join("\n")
}

/**
 * Step 1 of a refresh: find the HQ's pages. The first time (or with `full`) it walks the whole HQ,
 * which takes minutes. After that it asks Notion's search for pages edited since the last check
 * (newest first, stopping there), which is usually a handful of requests: pages new to the HQ are
 * added, and pages inside ticked ones mark those as changed. Writes only our own database.
 */
export async function discoverClientHq(clientId: string, opts: { full?: boolean } = {}) {
  const db = createAdminClient()
  const { data: client } = await db.from("clients").select("notion_hq_page_id, notion_hq_checked_at").eq("id", clientId).single()
  if (!client?.notion_hq_page_id) throw new Error("No Notion HQ page linked for this client.")
  const started = new Date().toISOString()
  const result = opts.full || !client.notion_hq_checked_at ? await fullDiscover(clientId, client.notion_hq_page_id) : await changedSince(clientId, client.notion_hq_page_id, client.notion_hq_checked_at)
  await db.from("clients").update({ notion_hq_checked_at: started }).eq("id", clientId)
  return result
}

async function fullDiscover(clientId: string, rootId: string) {
  const db = createAdminClient()
  const found = await discoverHq(rootId)
  const { data: existing } = await db.from("client_knowledge").select("id, notion_page_id").eq("client_id", clientId).eq("source", "notion")
  const known = new Set((existing ?? []).map((e) => e.notion_page_id))
  const now = new Date().toISOString()
  const fresh = found.filter((f) => !known.has(f.id))
  if (fresh.length) {
    await db.from("client_knowledge").insert(fresh.map((f) => ({ client_id: clientId, source: "notion", notion_page_id: f.id, notion_kind: f.kind, title: f.title, path: f.path, include: defaultInclude(f.title), last_edited_time: f.lastEdited })))
  }
  for (const f of found.filter((x) => known.has(x.id))) {
    await db.from("client_knowledge").update({ title: f.title, path: f.path, last_edited_time: f.lastEdited, removed_at: null }).eq("client_id", clientId).eq("notion_page_id", f.id)
  }
  const gone = (existing ?? []).filter((e) => !found.some((f) => f.id === e.notion_page_id))
  if (gone.length) await db.from("client_knowledge").update({ removed_at: now }).in("id", gone.map((g) => g.id))
  return { pages: found.length, added: fresh.length, changed: 0, mode: "full" as const }
}

type SearchPage = { id: string; last_edited_time: string; parent: { type: string; page_id?: string; block_id?: string; database_id?: string; data_source_id?: string }; properties?: Record<string, { type: string; title?: RichText[] }> }
const norm = (id: string) => id.replace(/-/g, "")

async function changedSince(clientId: string, rootId: string, since: string) {
  const db = createAdminClient()
  const n = notion()
  const { data: rows } = await db.from("client_knowledge").select("id, notion_page_id, path, title").eq("client_id", clientId).eq("source", "notion").is("removed_at", null)
  const known = new Map((rows ?? []).map((r) => [norm(r.notion_page_id!), r]))
  const cutoff = new Date(Date.parse(since) - 5 * 60_000).toISOString()

  // Pages edited since the last check, newest first.
  const edited: SearchPage[] = []
  let cursor: string | undefined
  for (let page = 0; page < 20; page++) {
    const r = (await throttled(() => n.search({ filter: { property: "object", value: "page" }, sort: { direction: "descending", timestamp: "last_edited_time" }, page_size: 100, start_cursor: cursor }))) as unknown as { results: SearchPage[]; has_more: boolean; next_cursor: string | null }
    const recent = r.results.filter((p) => p.last_edited_time >= cutoff)
    edited.push(...recent)
    if (recent.length < r.results.length || !r.has_more) break
    cursor = r.next_cursor ?? undefined
  }

  // Walk each one up its parents until we reach a page we know (or the HQ root), or leave the HQ.
  const cache = new Map<string, string | null>() // block/page id → nearest known id (or "root"), null = outside the HQ
  async function nearestKnown(parent: SearchPage["parent"], hops = 0): Promise<string | null> {
    const id = parent.page_id ?? parent.block_id ?? parent.database_id
    if (!id || parent.type === "workspace" || hops > 8) return null
    const key = norm(id)
    if (key === norm(rootId)) return "root"
    if (known.has(key)) return key
    if (cache.has(key)) return cache.get(key)!
    let up: SearchPage["parent"] | null = null
    try {
      up = parent.type === "page_id" ? ((await throttled(() => n.pages.retrieve({ page_id: id }))) as unknown as SearchPage).parent : parent.type === "block_id" ? ((await throttled(() => n.blocks.retrieve({ block_id: id }))) as unknown as SearchPage).parent : null
    } catch {
      up = null
    }
    const found = up ? await nearestKnown(up, hops + 1) : null
    cache.set(key, found)
    return found
  }

  let added = 0
  let changed = 0
  const now = new Date().toISOString()
  for (const p of edited) {
    const self = known.get(norm(p.id))
    if (self) {
      await db.from("client_knowledge").update({ last_edited_time: p.last_edited_time, removed_at: null }).eq("id", self.id)
      changed++
      continue
    }
    const anchor = await nearestKnown(p.parent)
    if (!anchor) continue
    if (anchor === "root") {
      // A new page on the HQ itself.
      const title = rt(Object.values(p.properties ?? {}).find((v) => v.type === "title")?.title) || "Untitled"
      await db.from("client_knowledge").insert({ client_id: clientId, source: "notion", notion_page_id: p.id, notion_kind: "page", title, path: "", include: defaultInclude(title), last_edited_time: p.last_edited_time })
      known.set(norm(p.id), { id: "", notion_page_id: p.id, path: "", title })
      added++
    } else {
      // Something inside a page we track changed (a sub-page or a database row): re-read that page.
      await db.from("client_knowledge").update({ last_edited_time: now }).eq("client_id", clientId).eq("notion_page_id", known.get(anchor)!.notion_page_id)
      changed++
    }
  }
  return { pages: known.size, added, changed, mode: "changes" as const }
}

/** Included HQ pages that need reading: never read, edited in Notion since, or read before `since`. */
async function staleIncluded(clientId: string, since?: string) {
  const { data } = await createAdminClient().from("client_knowledge").select("id, notion_page_id, notion_kind, last_edited_time, synced_at, content").eq("client_id", clientId).eq("source", "notion").eq("include", true).is("removed_at", null)
  return (data ?? []).filter((k) => !k.content || !k.synced_at || (k.last_edited_time && k.last_edited_time > k.synced_at) || (since && k.synced_at < since))
}

/**
 * Step 2: read stale included pages until `budgetMs` runs out. Returns how many are left, so the
 * caller can go again (each call stays well inside a request's time limit).
 */
export async function readClientHq(clientId: string, opts: { since?: string; budgetMs?: number } = {}) {
  const started = Date.now()
  const todo = await staleIncluded(clientId, opts.since)
  let read = 0
  const errors: string[] = []
  for (const k of todo) {
    if (opts.budgetMs && Date.now() - started > opts.budgetMs) break
    const err = await readInto(k.id, k.notion_page_id!, k.notion_kind as "page" | "database")
    if (err) errors.push(err)
    read++
  }
  return { read, remaining: todo.length - read, errors }
}

async function readInto(knowledgeId: string, pageId: string, kind: "page" | "database") {
  const db = createAdminClient()
  const n = notion()
  const now = new Date().toISOString()
  try {
    const text = kind === "database" ? await databaseText(n, pageId) : await pageText(n, pageId)
    await db.from("client_knowledge").update({ content: text, content_chars: text.length, synced_at: now, error: null, updated_at: now }).eq("id", knowledgeId)
    return null
  } catch (e) {
    await db.from("client_knowledge").update({ error: (e as Error).message.slice(0, 300), synced_at: now }).eq("id", knowledgeId)
    return (e as Error).message
  }
}

/** Both steps in one go, for scripts and the nightly job (no time budget). */
export async function syncClientHq(clientId: string, opts: { force?: boolean } = {}) {
  const since = opts.force ? new Date().toISOString() : undefined
  const d = await discoverClientHq(clientId, { full: opts.force })
  const r = await readClientHq(clientId, { since })
  return { ...d, ...r }
}

/** Reads one page on demand (after an admin ticks it). */
export async function readHqPage(knowledgeId: string) {
  const { data: k } = await createAdminClient().from("client_knowledge").select("id, notion_page_id, notion_kind").eq("id", knowledgeId).eq("source", "notion").single()
  if (k) await readInto(k.id, k.notion_page_id!, k.notion_kind as "page" | "database")
}
