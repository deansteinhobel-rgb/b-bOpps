import "server-only"
import { APIErrorCode, isNotionClientError, type Client } from "@notionhq/client"
import { CONTENT_BANK } from "@/lib/notion/config"
import { throttled } from "@/lib/notion/throttle"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Client isolation for the Notion reads that feed the Client brain (Aikido, 2026-10-13: cross-tenant
 * isolation). Every client's GTM HQ page, and its own call notes source, belongs to that client: another
 * client's reads never step into them. Shared regional call databases (one row per call, told apart by
 * a Client option) are left out, because several clients read them by design. The Content Bank is in:
 * it's only read through `content-bank.ts`, one row at a time.
 */
export const normId = (id: string) => id.replace(/-/g, "").toLowerCase()

export async function otherClientsNotion(clientId: string): Promise<Set<string>> {
  const { data, error } = await createAdminClient().from("clients").select("id, notion_hq_page_id, call_notes_notion_id, call_notes_client_option").neq("id", clientId)
  // Without the other clients' roots nothing could be kept out, so a failed lookup stops the read.
  if (error) throw new Error(`Couldn't load the other clients' Notion pages: ${error.message}`)
  // The Content Bank (every client's content in one database) is never read whole: only row by row, for the client each row names.
  const ids = new Set<string>([normId(CONTENT_BANK.databaseId), normId(CONTENT_BANK.dataSourceId)])
  for (const c of data ?? []) {
    if (c.notion_hq_page_id) ids.add(normId(c.notion_hq_page_id))
    if (c.call_notes_notion_id && !c.call_notes_client_option) ids.add(normId(c.call_notes_notion_id))
  }
  return ids
}

type Parent = { type: string; page_id?: string; block_id?: string; database_id?: string; data_source_id?: string }

const MAX_HOPS = 20

/** Notion's answer for a parent the connection can't open: the walk ends there. Anything else (rate limits, outages) is not an answer. */
const unknownParent = (e: unknown) =>
  isNotionClientError(e) && (e.code === APIErrorCode.ObjectNotFound || e.code === APIErrorCode.RestrictedResource)

/**
 * Whether a Notion page (or database) sits inside another client's tree: it, or one of its parents, is
 * in `others`. Unknown parents (not shared with the connection) end the walk as "not theirs". It fails
 * closed: a failed lookup throws, and a tree deeper than MAX_HOPS counts as theirs, so a read never lets
 * another client's page through because Notion was slow (code review, 2026-10-20).
 */
export async function insideOtherClient(
  n: Client,
  id: string,
  others: Set<string>,
  cache = new Map<string, boolean>(),
  kind: "page" | "database" = "page",
): Promise<boolean> {
  if (!others.size) return false
  async function walk(id: string, kind: "page" | "block" | "database", hops: number): Promise<boolean> {
    const key = normId(id)
    if (others.has(key)) return true
    if (hops > MAX_HOPS) return true
    if (cache.has(key)) return cache.get(key)!
    let parent: Parent | null = null
    try {
      const obj =
        kind === "page" ? await throttled(() => n.pages.retrieve({ page_id: id }))
        : kind === "block" ? await throttled(() => n.blocks.retrieve({ block_id: id }))
        : await throttled(() => n.databases.retrieve({ database_id: id }))
      parent = (obj as unknown as { parent?: Parent }).parent ?? null
    } catch (e) {
      if (!unknownParent(e)) throw e
      parent = null
    }
    const up = parent?.page_id ?? parent?.block_id ?? parent?.database_id
    const result = up && parent ? await walk(up, parent.type === "page_id" ? "page" : parent.type === "block_id" ? "block" : "database", hops + 1) : false
    cache.set(key, result)
    return result
  }
  return walk(id, kind, 0)
}
