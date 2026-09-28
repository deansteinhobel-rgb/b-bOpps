import { APP_CREATED_PREFIX, PROP } from "./config"

/** Plain values for the properties we store. Unknown property types are kept as their type name only. */
export type SimpleValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | { start: string; end: string | null }
  | { id: string; name: string | null }[]

type RichText = { plain_text: string }[]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProp = { type: string; [k: string]: any }

const text = (rt: RichText | undefined) => (rt ?? []).map((t) => t.plain_text).join("")

export function simplifyProperty(p: AnyProp): SimpleValue {
  switch (p.type) {
    case "title":
    case "rich_text":
      return text(p[p.type])
    case "select":
    case "status":
      return p[p.type]?.name ?? null
    case "multi_select":
      return (p.multi_select ?? []).map((o: { name: string }) => o.name)
    case "people":
      return (p.people ?? []).map((u: { id: string; name?: string }) => ({ id: u.id, name: u.name ?? null }))
    case "relation":
      return (p.relation ?? []).map((r: { id: string }) => r.id)
    case "date":
      return p.date ? { start: p.date.start, end: p.date.end ?? null } : null
    case "url":
    case "email":
    case "phone_number":
    case "number":
    case "checkbox":
    case "created_time":
    case "last_edited_time":
      return p[p.type] ?? null
    case "created_by":
    case "last_edited_by":
      return p[p.type] ? [{ id: p[p.type].id, name: p[p.type].name ?? null }] : null
    case "files":
      // External links keep their URL (so "what we created" can link to it). Notion-hosted files
      // only keep their name: their URLs expire within an hour.
      return (p.files ?? []).map((f: { type: string; name: string; external?: { url: string } }) => (f.type === "external" && f.external?.url ? f.external.url : f.name))
    case "formula":
      return p.formula ? (p.formula[p.formula.type] ?? null) : null
    default:
      return null
  }
}

export type NotionPage = {
  id: string
  url: string
  last_edited_time: string
  in_trash?: boolean
  archived?: boolean
  properties: Record<string, AnyProp>
}

export type MirrorRow = {
  notion_page_id: string
  data_source_id: string
  client_id: string | null
  page_type: "brief" | "action"
  title: string | null
  properties: Record<string, SimpleValue>
  url: string
  parent_page_id: string | null
  created_by_app: boolean
  in_trash: boolean
  last_edited_time: string
  synced_at: string
}

/** Maps a Notion page to a mirror row. Client comes from the "Client" select option name. */
export function toMirrorRow(page: NotionPage, dataSourceId: string, clientIdByOption: Map<string, string>, now = new Date()): MirrorRow {
  const properties: Record<string, SimpleValue> = {}
  for (const [name, p] of Object.entries(page.properties)) properties[name] = simplifyProperty(p)

  const clientOption = typeof properties[PROP.client] === "string" ? (properties[PROP.client] as string) : null
  const createdBy = typeof properties[PROP.createdBy] === "string" ? (properties[PROP.createdBy] as string) : ""
  const createdByApp = createdBy.startsWith(APP_CREATED_PREFIX)
  const parent = properties[PROP.parent]

  return {
    notion_page_id: page.id,
    data_source_id: dataSourceId,
    client_id: clientOption ? (clientIdByOption.get(clientOption) ?? null) : null,
    page_type: createdByApp ? "action" : "brief",
    title: (properties[PROP.title] as string) || null,
    properties,
    url: page.url,
    parent_page_id: Array.isArray(parent) && typeof parent[0] === "string" ? parent[0] : null,
    created_by_app: createdByApp,
    in_trash: Boolean(page.in_trash ?? page.archived),
    last_edited_time: page.last_edited_time,
    synced_at: now.toISOString(),
  }
}
