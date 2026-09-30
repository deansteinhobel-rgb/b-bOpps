import "server-only"
import { createHash } from "node:crypto"
import type { Client } from "@notionhq/client"
import { children, CONTAINERS, notion, pageText, propText, rt, titleOf, type Prop } from "@/lib/knowledge/notion-hq"
import { throttled } from "@/lib/notion/throttle"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Reads a client's call notes from Notion into client_calls. READ ONLY: the guarded client throws on
 * any write before a request is sent (Dean: read, never write, never delete).
 *
 * The source (clients.call_notes_notion_id) is either
 *   a database  one row per call (e.g. "Proactis | Call Notes & Actions": Date & Time, Status,
 *               Summary, and the notes in the page body), or
 *   a page      one sub-page per call, or databases on it whose rows are calls.
 * The first read takes the whole history; after that only rows edited since the last check.
 */

// Rows for calls that haven't happened yet have nothing to read.
const NOT_YET = /coming up|upcoming|scheduled|to be booked|planned/i
const MAX_ROWS = 400

type Row = { id: string; title: string; date: string; status: string | null; props: string; lastEdited: string }

const norm = (id: string) => id.replace(/-/g, "")
/** A Notion link or id → the 32-character id. */
export function notionIdFrom(input: string): string | null {
  const m = input.trim().match(/([0-9a-f]{32})(?:[?#].*)?$/i) ?? input.replace(/-/g, "").match(/([0-9a-f]{32})/i)
  if (!m) return null
  const h = m[1].toLowerCase()
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
/** A date written in a call's title: 2026-09-25, 25/09/2026, 09/25/26 (US, when the first part > 12 can't be a month), 25 Sept 2026. */
export function dateInTitle(title: string): string | null {
  const iso = title.match(/(20\d\d)-(\d\d)-(\d\d)/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dmy = title.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/)
  if (dmy) {
    let [a, b] = [Number(dmy[1]), Number(dmy[2])]
    const y = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3])
    if (b > 12 && a <= 12) [a, b] = [b, a] // 09/25/26 is American
    if (b >= 1 && b <= 12 && a >= 1 && a <= 31) return `${y}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`
  }
  const words = title.toLowerCase().match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?\s+(20\d\d)\b/)
  if (words && MONTHS.includes(words[2].slice(0, 3))) return `${words[3]}-${String(MONTHS.indexOf(words[2].slice(0, 3)) + 1).padStart(2, "0")}-${words[1].padStart(2, "0")}`
  return null
}

const londonDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(iso))

type Page = { id: string; created_time: string; last_edited_time: string; in_trash?: boolean; properties?: Record<string, Prop & { date?: { start?: string } | null }> }

/** One database row as a call: its title, date (a date property, else the title, else when it was made), status and other properties as text. */
function rowOf(p: Page): Row {
  const props = Object.entries(p.properties ?? {})
  const title = propText(props.find(([, v]) => v.type === "title")?.[1] ?? { type: "none" }).trim() || "Untitled call"
  const dates = props.filter(([, v]) => v.type === "date" && v.date?.start)
  const dateProp = dates.find(([k]) => /date|when|call|meeting/i.test(k)) ?? dates[0]
  const start = dateProp?.[1].date?.start
  const date = start ? (start.length > 10 ? londonDate(start) : start) : (dateInTitle(title) ?? londonDate(p.created_time))
  const status = props.find(([k, v]) => (v.type === "status" || v.type === "select") && /status|state/i.test(k))?.[1]
  const rest = props
    .filter(([, v]) => v.type !== "title" && v !== dateProp?.[1])
    .map(([k, v]) => [k, propText(v)] as const)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")
  return { id: p.id, title, date, status: status ? propText(status) || null : null, props: rest, lastEdited: p.last_edited_time }
}

async function databaseRows(n: Client, databaseId: string, since: string | null): Promise<Row[]> {
  const db = (await throttled(() => n.databases.retrieve({ database_id: databaseId }))) as unknown as { data_sources?: { id: string }[] }
  const rows: Row[] = []
  for (const ds of db.data_sources ?? []) {
    let cursor: string | undefined
    do {
      const r = (await throttled(() =>
        n.dataSources.query({
          data_source_id: ds.id,
          start_cursor: cursor,
          page_size: 100,
          sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
          ...(since ? { filter: { timestamp: "last_edited_time", last_edited_time: { on_or_after: since } } } : {}),
        }),
      )) as unknown as { results: Page[]; has_more: boolean; next_cursor: string | null }
      rows.push(...r.results.filter((p) => !p.in_trash).map(rowOf))
      cursor = r.has_more && rows.length < MAX_ROWS ? (r.next_cursor ?? undefined) : undefined
    } while (cursor)
  }
  return rows
}

/** A page source: each sub-page is a call (through toggles and columns); databases on it hold calls too. */
async function pageRows(n: Client, pageId: string, since: string | null): Promise<Row[]> {
  const rows: Row[] = []
  async function walk(id: string, depth: number) {
    for (const b of await children(n, id)) {
      if (b.type === "child_page") {
        const title = titleOf(b)
        const edited = String(b.last_edited_time ?? "")
        if (!since || edited >= since) rows.push({ id: b.id, title, date: dateInTitle(title) ?? londonDate(String(b.created_time)), status: null, props: "", lastEdited: edited })
      } else if (b.type === "child_database") {
        rows.push(...(await databaseRows(n, b.id, since)))
      } else if (b.has_children && CONTAINERS.has(b.type) && depth < 4) {
        await walk(b.id, depth + 1)
      }
    }
  }
  await walk(pageId, 0)
  return rows
}

/** Works out whether a link is a database or a page, and its title (for the Brain tab). */
export async function resolveCallSource(id: string): Promise<{ kind: "page" | "database"; title: string }> {
  const n = notion()
  try {
    const d = (await throttled(() => n.databases.retrieve({ database_id: id }))) as unknown as { title?: { plain_text: string }[] }
    return { kind: "database", title: rt(d.title) || "Untitled database" }
  } catch {
    const p = (await throttled(() => n.pages.retrieve({ page_id: id }))) as unknown as Page
    return { kind: "page", title: propText(Object.values(p.properties ?? {}).find((v) => v.type === "title") ?? { type: "none" }) || "Untitled page" }
  }
}

const digest = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32)

/**
 * Reads new and edited call notes for a client, within `budgetMs`. Rows are recorded straight away;
 * their text is read one by one (Notion allows ~3 requests a second), so a first read of a long
 * history carries on in the next run. Returns how many calls are still waiting to be read.
 * Writes only our own database.
 */
export async function syncCallNotes(clientId: string, opts: { full?: boolean; budgetMs?: number } = {}) {
  const started = Date.now()
  const db = createAdminClient()
  const { data: client } = await db.from("clients").select("call_notes_notion_id, call_notes_kind, call_notes_checked_at").eq("id", clientId).single()
  if (!client?.call_notes_notion_id) return { found: 0, read: 0, remaining: 0 }
  const n = notion()
  const checkedAt = new Date().toISOString()
  // A few minutes' overlap, so an edit made during the last run isn't missed.
  const since = opts.full || !client.call_notes_checked_at ? null : new Date(Date.parse(client.call_notes_checked_at) - 10 * 60_000).toISOString()
  const rows = client.call_notes_kind === "page" ? await pageRows(n, client.call_notes_notion_id, since) : await databaseRows(n, client.call_notes_notion_id, since)

  // Record new calls, and mark edited ones for reading.
  const { data: known } = await db.from("client_calls").select("id, notion_page_id, last_edited_time, synced_at").eq("client_id", clientId).eq("source", "notion")
  const byId = new Map((known ?? []).map((k) => [norm(k.notion_page_id!), k]))
  const today = londonDate(checkedAt)
  for (const r of rows) {
    const k = byId.get(norm(r.id))
    const fields = { title: r.title.slice(0, 300), call_date: r.date, notion_status: r.status, last_edited_time: r.lastEdited || null, removed_at: null }
    if (!k) {
      await db.from("client_calls").insert({ client_id: clientId, source: "notion", notion_page_id: r.id, ...fields })
    } else {
      await db.from("client_calls").update(fields).eq("id", k.id)
    }
  }
  // Keep the properties text for reading (Summary, attendees...).
  const propsById = new Map(rows.map((r) => [norm(r.id), r.props]))

  // Read every call whose notes are new or edited since they were last read, newest first.
  const { data: todo } = await db
    .from("client_calls")
    .select("id, notion_page_id, title, call_date, notion_status, last_edited_time, synced_at, content_digest")
    .eq("client_id", clientId)
    .eq("source", "notion")
    .is("removed_at", null)
    .order("call_date", { ascending: false })
  const stale = (todo ?? []).filter((c) => !c.synced_at || (c.last_edited_time && c.last_edited_time > c.synced_at))
  let read = 0
  for (const c of stale) {
    if (opts.budgetMs && Date.now() - started > opts.budgetMs) break
    const now = new Date().toISOString()
    // A call that hasn't happened yet: nothing to read until it's edited again.
    if ((c.notion_status && NOT_YET.test(c.notion_status)) || c.call_date > today) {
      await db.from("client_calls").update({ synced_at: now, extract_status: "skipped" }).eq("id", c.id)
      read++
      continue
    }
    try {
      let props = propsById.get(norm(c.notion_page_id!))
      if (props === undefined) {
        const p = (await throttled(() => n.pages.retrieve({ page_id: c.notion_page_id! }))) as unknown as Page
        props = rowOf(p).props
      }
      const body = await pageText(n, c.notion_page_id!)
      const content = [props, body].filter(Boolean).join("\n\n").trim()
      const d = digest(content)
      const changed = d !== c.content_digest
      await db
        .from("client_calls")
        .update({ content, content_chars: content.length, content_digest: d, synced_at: now, updated_at: now, ...(changed ? { extract_status: content.length < 80 ? "skipped" : "pending", extract_error: null } : {}) })
        .eq("id", c.id)
    } catch (e) {
      await db.from("client_calls").update({ synced_at: now, extract_status: "failed", extract_error: `Couldn't read it from Notion: ${(e as Error).message}`.slice(0, 300) }).eq("id", c.id)
    }
    read++
  }
  await db.from("clients").update({ call_notes_checked_at: checkedAt }).eq("id", clientId)
  return { found: rows.length, read, remaining: stale.length - read }
}

/** The calls in a source, without reading or saving anything (for scripts and checks). */
export async function listCallRows(kind: "page" | "database", id: string) {
  const n = notion()
  return kind === "page" ? pageRows(n, id, null) : databaseRows(n, id, null)
}
