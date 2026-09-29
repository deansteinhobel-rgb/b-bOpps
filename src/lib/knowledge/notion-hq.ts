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
 * Step 1 of a refresh: find the HQ's pages and store them (new ones get the default pick; titles,
 * places and Notion's edit times are updated; pages gone from the HQ are marked removed, never
 * deleted). Writes only our own database.
 */
export async function discoverClientHq(clientId: string) {
  const db = createAdminClient()
  const { data: client } = await db.from("clients").select("notion_hq_page_id").eq("id", clientId).single()
  if (!client?.notion_hq_page_id) throw new Error("No Notion HQ page linked for this client.")
  const found = await discoverHq(client.notion_hq_page_id)
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
  return { pages: found.length, added: fresh.length }
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
  const d = await discoverClientHq(clientId)
  const r = await readClientHq(clientId, { since })
  return { ...d, ...r }
}

/** Reads one page on demand (after an admin ticks it). */
export async function readHqPage(knowledgeId: string) {
  const { data: k } = await createAdminClient().from("client_knowledge").select("id, notion_page_id, notion_kind").eq("id", knowledgeId).eq("source", "notion").single()
  if (k) await readInto(k.id, k.notion_page_id!, k.notion_kind as "page" | "database")
}
