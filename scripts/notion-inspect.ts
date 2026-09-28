/**
 * Phase 0 throwaway script: discover the Notion schema. Read-only. It never writes to Notion.
 *
 *   pnpm inspect:notion                 # uses NOTION_DATABASE_IDS from .env.local
 *   pnpm inspect:notion <id> [<id> ...] # or pass database / page IDs directly
 *
 * For each ID (a database, or a page that contains databases) it prints the data sources,
 * every property with its type and options, how values are spread across a sample of rows,
 * and a proposed mapping to our data model for you to confirm.
 * Full raw output is written to scripts/output/notion-inspect.json (git-ignored).
 */
import { Client, APIResponseError, isFullPage } from "@notionhq/client"
import { mkdirSync, writeFileSync } from "node:fs"

const NOTION_VERSION = "2026-03-11"
const SAMPLE_ROWS = 100
const MIN_GAP_MS = 350 // stay under Notion's ~3 requests/second

const token = process.env.NOTION_TOKEN
if (!token) {
  console.error("NOTION_TOKEN is missing. Add it to .env.local (see .env.example).")
  process.exit(1)
}
const ids = (process.argv.slice(2).length ? process.argv.slice(2) : (process.env.NOTION_DATABASE_IDS ?? "").split(","))
  .map((s) => s.trim())
  .filter(Boolean)
if (!ids.length) {
  console.error("No IDs. Set NOTION_DATABASE_IDS in .env.local or pass IDs as arguments.")
  process.exit(1)
}

const notion = new Client({ auth: token, notionVersion: NOTION_VERSION })

let last = 0
async function call<T>(fn: () => Promise<T>): Promise<T> {
  const wait = last + MIN_GAP_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  last = Date.now()
  return fn()
}

const plain = (rt: any[] | undefined) => (rt ?? []).map((t) => t.plain_text).join("")
const report: any = { notion_version: NOTION_VERSION, inspected_at: new Date().toISOString(), roots: [] }
const titleCache = new Map<string, string>()

async function pageTitle(pageId: string): Promise<string> {
  if (titleCache.has(pageId)) return titleCache.get(pageId)!
  let title = "(no access)"
  try {
    const page: any = await call(() => notion.pages.retrieve({ page_id: pageId }))
    const tp: any = Object.values(page.properties ?? {}).find((p: any) => p.type === "title")
    title = plain(tp?.title) || "(untitled)"
  } catch {}
  titleCache.set(pageId, title)
  return title
}

async function dataSourceName(id: string): Promise<string> {
  try {
    const ds: any = await call(() => notion.dataSources.retrieve({ data_source_id: id }))
    return plain(ds.title) || id
  } catch {
    return `${id} (not shared with the integration)`
  }
}

function describeProperty(p: any): string {
  const c = p[p.type] ?? {}
  switch (p.type) {
    case "select":
    case "multi_select":
      return `options: ${(c.options ?? []).map((o: any) => o.name).join(" | ") || "(none)"}`
    case "status": {
      const opts = new Map((c.options ?? []).map((o: any) => [o.id, o.name]))
      const groups = (c.groups ?? []).map((g: any) => `${g.name}: [${(g.option_ids ?? []).map((i: string) => opts.get(i)).join(", ")}]`)
      return `groups: ${groups.join("; ")}`
    }
    case "formula":
      return `expression: ${c.expression}`
    case "rollup":
      return `rollup of "${c.rollup_property_name}" via "${c.relation_property_name}" (${c.function})`
    case "number":
      return `format: ${c.format}`
    default:
      return ""
  }
}

function valueKeys(prop: any): string[] {
  switch (prop.type) {
    case "select":
      return [prop.select?.name ?? "(empty)"]
    case "status":
      return [prop.status?.name ?? "(empty)"]
    case "multi_select":
      return prop.multi_select.length ? prop.multi_select.map((o: any) => o.name) : ["(empty)"]
    case "people":
      return prop.people.length ? prop.people.map((u: any) => u.name ?? u.id) : ["(empty)"]
    case "relation":
      return prop.relation.length ? prop.relation.map((r: any) => `rel:${r.id}`) : ["(empty)"]
    case "date":
      return [prop.date ? "(has date)" : "(empty)"]
    default:
      return []
  }
}

function propose(props: Record<string, any>) {
  const list = Object.values(props)
  const find = (types: string[], re?: RegExp) =>
    list.find((p) => types.includes(p.type) && (!re || re.test(p.name)))?.name
  const pick = (types: string[], re: RegExp) => find(types, re) ?? find(types) ?? "?? not found"
  return {
    title: find(["title"]) ?? "?? not found",
    client: find(["relation", "select", "multi_select"], /client|account|brand|customer/i) ?? "?? not found. How is the board split by client?",
    owner: pick(["people"], /owner|assign|responsible|lead|who/i),
    due_date: pick(["date"], /due|deadline|date/i),
    status: find(["status"]) ?? find(["select"], /status|stage/i) ?? "?? not found",
    page_type_hint: find(["select", "multi_select"], /type|kind|category/i) ?? "(none, maybe one database per type)",
    source_app: find(["select", "rich_text"], /source/i) ?? "MISSING. Needs adding for source = App",
    created_by_text: find(["rich_text"], /created.?by/i) ?? "MISSING. Needs adding (text)",
    check_result_link: find(["url"], /check|app|link/i) ?? "MISSING. Needs adding (URL)",
  }
}

async function inspectDataSource(dsId: string) {
  const ds: any = await call(() => notion.dataSources.retrieve({ data_source_id: dsId }))
  const name = plain(ds.title) || "(untitled)"
  console.log(`\n  DATA SOURCE "${name}"  id=${ds.id}`)
  console.log(`  url: ${ds.url}`)

  const props = ds.properties as Record<string, any>
  console.log(`  ${Object.keys(props).length} properties:`)
  for (const p of Object.values(props)) {
    let extra = describeProperty(p)
    if (p.type === "relation") {
      extra = `-> data source "${await dataSourceName(p.relation.data_source_id)}" (${p.relation.data_source_id}), ${p.relation.type}`
    }
    console.log(`    - ${JSON.stringify(p.name)}  [${p.type}]  ${extra}`)
  }

  // Sample rows to see how pages spread across clients, owners and statuses.
  const q: any = await call(() => notion.dataSources.query({ data_source_id: dsId, page_size: SAMPLE_ROWS }))
  const rows = q.results.filter(isFullPage)
  console.log(`\n  Sample: ${rows.length} rows${q.has_more ? " (more exist)" : ""}. Value spread:`)
  const spread: Record<string, Record<string, number>> = {}
  for (const row of rows) {
    for (const [pname, pv] of Object.entries<any>(row.properties)) {
      for (const k of valueKeys(pv)) {
        spread[pname] ??= {}
        spread[pname][k] = (spread[pname][k] ?? 0) + 1
      }
    }
  }
  for (const [pname, counts] of Object.entries(spread)) {
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15)
    const labelled: string[] = []
    for (const [k, n] of top) {
      labelled.push(`${k.startsWith("rel:") ? await pageTitle(k.slice(4)) : k} (${n})`)
    }
    const more = Object.keys(counts).length > 15 ? ` ... +${Object.keys(counts).length - 15} more` : ""
    console.log(`    ${JSON.stringify(pname)}: ${labelled.join(", ")}${more}`)
  }

  const mapping = propose(props)
  console.log(`\n  PROPOSED MAPPING (a guess from names and types. Please confirm or correct):`)
  for (const [k, v] of Object.entries(mapping)) console.log(`    ${k.padEnd(18)} <- ${v}`)

  return { id: ds.id, name, url: ds.url, properties: props, sample_spread: spread, proposed_mapping: mapping, sample_row: rows[0] ?? null }
}

async function inspectDatabase(dbId: string) {
  const db: any = await call(() => notion.databases.retrieve({ database_id: dbId }))
  console.log(`\nDATABASE "${plain(db.title) || "(untitled)"}"  id=${db.id}`)
  console.log(`url: ${db.url}`)
  console.log(`data sources: ${db.data_sources.map((d: any) => `${d.name} (${d.id})`).join(", ")}`)
  const sources = []
  for (const ref of db.data_sources) sources.push(await inspectDataSource(ref.id))
  return { kind: "database", id: db.id, title: plain(db.title), url: db.url, data_sources: sources }
}

// A page (e.g. a "master board" page) may hold databases and sub-pages instead of being one.
async function inspectPage(pageId: string, depth = 0): Promise<any> {
  const title = await pageTitle(pageId)
  const pad = "  ".repeat(depth)
  console.log(`\n${pad}PAGE "${title}"  id=${pageId}. Looking for databases inside it...`)
  const children: any[] = []
  let cursor: string | undefined
  do {
    const res: any = await call(() => notion.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 }))
    children.push(...res.results)
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)

  const found: any[] = []
  for (const b of children) {
    if (b.type === "child_database") {
      console.log(`${pad}  contains database "${b.child_database.title}" (${b.id})`)
      try {
        found.push(await inspectDatabase(b.id))
      } catch (e) {
        console.log(`${pad}    could not open it (linked view, or not shared?): ${(e as Error).message}`)
      }
    } else if (b.type === "child_page") {
      console.log(`${pad}  sub-page "${b.child_page.title}" (${b.id})`)
      if (depth < 1) found.push(await inspectPage(b.id, depth + 1))
    }
  }
  if (!found.length) console.log(`${pad}  (no databases found directly on this page)`)
  return { kind: "page", id: pageId, title, children: found }
}

async function main() {
  console.log(`Notion API version ${NOTION_VERSION}. Inspecting ${ids.length} ID(s). Read-only.`)
  for (const id of ids) {
    try {
      report.roots.push(await inspectDatabase(id))
    } catch (e) {
      if (e instanceof APIResponseError && (e.code === "object_not_found" || e.code === "validation_error")) {
        try {
          report.roots.push(await inspectPage(id))
          continue
        } catch {}
      }
      console.log(`\n${id}: could not open it. Is it shared with the integration? (${(e as Error).message})`)
      report.roots.push({ id, error: (e as Error).message })
    }
  }

  // Workspace people, so profiles can be linked to a Notion user for action owners.
  const users: any[] = []
  let cursor: string | undefined
  do {
    const res: any = await call(() => notion.users.list({ start_cursor: cursor, page_size: 100 }))
    users.push(...res.results)
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  const people = users.filter((u) => u.type === "person")
  console.log(`\nWORKSPACE PEOPLE (${people.length}), for linking profiles.notion_user_id:`)
  for (const u of people) console.log(`  - ${u.name}  <${u.person?.email ?? "email hidden"}>  id=${u.id}`)
  report.people = people.map((u) => ({ id: u.id, name: u.name, email: u.person?.email ?? null }))

  mkdirSync("scripts/output", { recursive: true })
  writeFileSync("scripts/output/notion-inspect.json", JSON.stringify(report, null, 2))
  console.log(`\nFull output saved to scripts/output/notion-inspect.json`)
  console.log(`\nNEXT: confirm or correct each PROPOSED MAPPING line above. Nothing is assumed until you do.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
