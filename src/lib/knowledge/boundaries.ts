import "server-only"
import type { Client } from "@notionhq/client"
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
  const { data } = await createAdminClient().from("clients").select("id, notion_hq_page_id, call_notes_notion_id, call_notes_client_option").neq("id", clientId)
  // The Content Bank (every client's content in one database) is never read whole: only row by row, for the client each row names.
  const ids = new Set<string>([normId(CONTENT_BANK.databaseId), normId(CONTENT_BANK.dataSourceId)])
  for (const c of data ?? []) {
    if (c.notion_hq_page_id) ids.add(normId(c.notion_hq_page_id))
    if (c.call_notes_notion_id && !c.call_notes_client_option) ids.add(normId(c.call_notes_notion_id))
  }
  return ids
}

type Parent = { type: string; page_id?: string; block_id?: string; database_id?: string; data_source_id?: string }

/**
 * Whether a Notion page sits inside another client's tree: it, or one of its parents (up to 8 levels),
 * is in `others`. Unknown parents (not shared with the connection) end the walk as "not theirs".
 */
export async function insideOtherClient(n: Client, pageId: string, others: Set<string>, cache = new Map<string, boolean>()): Promise<boolean> {
  if (!others.size) return false
  async function walk(id: string, kind: "page" | "block" | "database", hops: number): Promise<boolean> {
    const key = normId(id)
    if (others.has(key)) return true
    if (hops > 8) return false
    if (cache.has(key)) return cache.get(key)!
    let parent: Parent | null = null
    try {
      const obj =
        kind === "page" ? await throttled(() => n.pages.retrieve({ page_id: id }))
        : kind === "block" ? await throttled(() => n.blocks.retrieve({ block_id: id }))
        : await throttled(() => n.databases.retrieve({ database_id: id }))
      parent = (obj as unknown as { parent?: Parent }).parent ?? null
    } catch {
      parent = null
    }
    const up = parent?.page_id ?? parent?.block_id ?? parent?.database_id
    const result = up && parent ? await walk(up, parent.type === "page_id" ? "page" : parent.type === "block_id" ? "block" : "database", hops + 1) : false
    cache.set(key, result)
    return result
  }
  return walk(pageId, "page", 0)
}
