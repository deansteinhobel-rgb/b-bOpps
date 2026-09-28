import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { CLOSED_STATUSES, PROP } from "./config"
import type { SimpleValue } from "./map"

export type MirrorItem = {
  id: string
  title: string
  url: string
  status: string | null
  priority: string | null
  productionType: string | null
  owners: string[]
  due: string | null
  parentId: string | null
  createdByApp: boolean
  closed: boolean
  lastEdited: string
}

const str = (v: SimpleValue | undefined) => (typeof v === "string" ? v : null)

function toItem(row: { notion_page_id: string; title: string | null; url: string; parent_page_id: string | null; created_by_app: boolean; last_edited_time: string; properties: Record<string, SimpleValue> }): MirrorItem {
  const p = row.properties
  const people = Array.isArray(p[PROP.owner]) ? (p[PROP.owner] as { name: string | null }[]) : []
  const due = p[PROP.dueDate] && typeof p[PROP.dueDate] === "object" && !Array.isArray(p[PROP.dueDate]) ? (p[PROP.dueDate] as { start: string }).start : null
  const status = str(p[PROP.status])
  return {
    id: row.notion_page_id,
    title: row.title ?? "(untitled)",
    url: row.url,
    status,
    priority: str(p[PROP.priority]),
    productionType: str(p[PROP.productionType]),
    owners: people.map((u) => u.name ?? "Unknown"),
    due,
    parentId: row.parent_page_id,
    createdByApp: row.created_by_app,
    closed: status !== null && CLOSED_STATUSES.includes(status),
    lastEdited: row.last_edited_time,
  }
}

/** Mirror rows for a client (RLS applies), excluding trashed pages. */
export async function mirrorItems(supabase: SupabaseClient, clientId: string, pageType: "action" | "brief") {
  const { data } = await supabase
    .from("notion_pages_mirror")
    .select("notion_page_id, title, url, parent_page_id, created_by_app, last_edited_time, properties")
    .eq("client_id", clientId)
    .eq("page_type", pageType)
    .eq("in_trash", false)
    .limit(2000)
  return (data ?? []).map(toItem)
}

/** Sort by due date (soonest first, undated last), then most recently edited. */
export const byDue = (a: MirrorItem, b: MirrorItem) =>
  (a.due ?? "9999") < (b.due ?? "9999") ? -1 : (a.due ?? "9999") > (b.due ?? "9999") ? 1 : b.lastEdited.localeCompare(a.lastEdited)

export async function lastNotionSync(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.from("notion_sync_state").select("last_synced_at").order("last_synced_at", { ascending: false }).limit(1).maybeSingle()
  return data?.last_synced_at ?? null
}

export function minutesAgo(iso: string | null): string {
  if (!iso) return "never"
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  return `${Math.round(hours / 24)} days ago`
}
