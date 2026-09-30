import "server-only"
import { iterateAllDataSourceRows, type Client } from "@notionhq/client"
import { createAdminClient } from "@/lib/supabase/admin"
import { dataSourceId, NOTION_VERSION } from "./config"
import { toMirrorRow, type MirrorRow, type NotionPage } from "./map"
import { readOnlyNotion } from "./readonly"
import { advanceTestsFromNotion } from "@/lib/sprints/advance"
import { throttled } from "./throttle"

const CHUNK = 500

/**
 * Mirrors the Master Production board into notion_pages_mirror. READ-ONLY toward Notion: it uses
 * the guarded client, so a write here would throw before any request is sent.
 *
 * Incremental (default): pages edited since the last sync (minus a minute of overlap), oldest first.
 * Full: every page; pages we hold that Notion no longer returns are marked in_trash (never deleted).
 */
export async function syncNotionMirror(opts: { full?: boolean } = {}) {
  const token = process.env.NOTION_TOKEN
  if (!token) throw new Error("NOTION_TOKEN is not set")
  const notion = readOnlyNotion(token, NOTION_VERSION)
  const query: Client["dataSources"]["query"] = (args) => throttled(() => notion.dataSources.query(args))
  const db = createAdminClient()
  const dsId = dataSourceId()
  const startedAt = new Date()

  const [{ data: clients }, { data: state }] = await Promise.all([
    db.from("clients").select("id, notion_client_option"),
    db.from("notion_sync_state").select("*").eq("data_source_id", dsId).maybeSingle(),
  ])
  const clientIdByOption = new Map((clients ?? []).map((c) => [c.notion_client_option as string, c.id as string]))
  const since = !opts.full && state?.max_last_edited_time ? new Date(Date.parse(state.max_last_edited_time) - 60_000).toISOString() : null
  const full = !since

  const rows: MirrorRow[] = []
  if (full) {
    for await (const page of iterateAllDataSourceRows({ dataSources: { query } } as unknown as Client, { data_source_id: dsId, page_size: 100 })) {
      if ("properties" in page) rows.push(toMirrorRow(page as unknown as NotionPage, dsId, clientIdByOption, startedAt))
    }
  } else {
    let cursor: string | undefined
    do {
      const res = await query({
        data_source_id: dsId,
        page_size: 100,
        start_cursor: cursor,
        filter: { timestamp: "last_edited_time", last_edited_time: { on_or_after: since } },
        sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
      })
      for (const page of res.results) if ("properties" in page) rows.push(toMirrorRow(page as unknown as NotionPage, dsId, clientIdByOption, startedAt))
      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
    } while (cursor)
  }

  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from("notion_pages_mirror").upsert(rows.slice(i, i + CHUNK), { onConflict: "notion_page_id" })
    if (error) throw new Error(`Saving mirror rows: ${error.message}`)
  }

  // Sprint tests follow their Notion brief (our database only; Notion is only read).
  const tests = await advanceTestsFromNotion(db, rows)

  let trashed = 0
  if (full) {
    const seen = new Set(rows.map((r) => r.notion_page_id))
    const { data: held } = await db.from("notion_pages_mirror").select("notion_page_id").eq("data_source_id", dsId).eq("in_trash", false)
    const gone = (held ?? []).map((h) => h.notion_page_id as string).filter((id) => !seen.has(id))
    for (let i = 0; i < gone.length; i += CHUNK) {
      await db.from("notion_pages_mirror").update({ in_trash: true, synced_at: startedAt.toISOString() }).in("notion_page_id", gone.slice(i, i + CHUNK))
    }
    trashed = gone.length
  }

  const maxEdited = [state?.max_last_edited_time, ...rows.map((r) => r.last_edited_time)].filter(Boolean).sort().at(-1) ?? null
  await db.from("notion_sync_state").upsert({
    data_source_id: dsId,
    last_synced_at: startedAt.toISOString(),
    max_last_edited_time: maxEdited,
    ...(full ? { last_full_sync_at: startedAt.toISOString() } : {}),
  })

  return { mode: full ? "full" : "incremental", pages: rows.length, trashed, mapped: rows.filter((r) => r.client_id).length, tests }
}
