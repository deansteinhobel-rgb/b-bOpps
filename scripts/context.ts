/**
 * The Lumaux context bank: decisions, rules and gotchas from building Lumaux, kept in their own
 * Supabase project (context-bank/schema.sql), not the Lumaux database. Used by the lumaux-context
 * and save-context skills. Needs CONTEXT_SUPABASE_URL and CONTEXT_SUPABASE_SECRET_KEY in .env.local.
 *   pnpm context areas                          areas with entry counts
 *   pnpm context titles [area]                  id and title of every current entry (in an area)
 *   pnpm context search "<words>" [--area a] [--limit n] [--brief]
 *   pnpm context get <id> [<id> ...]
 *   pnpm context add <file.json>                one entry or an array; exact repeats are skipped
 *   pnpm context update <id> <file.json>        changes fields; the old text goes to history
 *   pnpm context supersede <old id> <new id>    the old entry stops showing up
 * Nothing is ever deleted.
 */
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const KINDS = ["rule", "decision", "how_it_works", "gotcha", "mapping", "todo"] as const
type Entry = {
  area: string
  title: string
  body: string
  kind: (typeof KINDS)[number]
  files?: string[]
  tags?: string[]
  decided_by?: string | null
  decided_on?: string | null
  source?: string | null
  supersedes?: number
}
type Row = { id: number; area: string; kind: string; title: string; body: string; files: string[]; decided_on: string | null }

const url = process.env.CONTEXT_SUPABASE_URL
const key = process.env.CONTEXT_SUPABASE_SECRET_KEY
if (!url || !key) {
  console.error("Set CONTEXT_SUPABASE_URL and CONTEXT_SUPABASE_SECRET_KEY in .env.local (the context bank's own Supabase project).")
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })

const [command, ...rest] = process.argv.slice(2)
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`)
  return i === -1 ? undefined : rest[i + 1]
}
const VALUE_FLAGS = new Set(["--area", "--limit"])
const positional = rest.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(rest[i - 1]))

function author() {
  try {
    return execSync("git config user.name", { encoding: "utf8" }).trim() || null
  } catch {
    return null
  }
}

function check(e: Entry, n: number) {
  const problems: string[] = []
  if (!/^[a-z0-9-]+$/.test(e.area ?? "")) problems.push("area must be a lowercase slug")
  if (!e.title?.trim()) problems.push("title is empty")
  if (!e.body?.trim()) problems.push("body is empty")
  if (!KINDS.includes(e.kind)) problems.push(`kind must be one of ${KINDS.join(", ")}`)
  if (e.decided_on && !/^\d{4}-\d{2}-\d{2}$/.test(e.decided_on)) problems.push("decided_on must be YYYY-MM-DD")
  if (problems.length) throw new Error(`Entry ${n} (${e.title ?? "untitled"}): ${problems.join("; ")}`)
}

function print(r: Row, brief: boolean) {
  const meta = [r.area, r.kind, r.decided_on].filter(Boolean).join(" · ")
  console.log(`\n#${r.id} ${r.title}  (${meta})`)
  if (r.files?.length) console.log(`files: ${r.files.join(", ")}`)
  console.log(brief && r.body.length > 300 ? `${r.body.slice(0, 300)}…` : r.body)
}

async function main() {
  switch (command) {
    case "areas": {
      const { data, error } = await db.from("context_areas").select("*")
      if (error) throw error
      for (const a of data) console.log(`${a.area}  ${a.entries}${a.latest ? `  (latest ${a.latest})` : ""}`)
      return
    }
    case "titles": {
      let q = db.from("context_entries").select("id, area, title").is("superseded_by", null).order("area").order("id")
      if (positional[0]) q = q.eq("area", positional[0])
      const { data, error } = await q
      if (error) throw error
      let area = ""
      for (const r of data) {
        if (r.area !== area) console.log(`\n[${(area = r.area)}]`)
        console.log(`#${r.id} ${r.title}`)
      }
      return
    }
    case "search": {
      const words = positional[0]
      if (!words) throw new Error('Usage: pnpm context search "<words>" [--area a] [--limit n] [--brief]')
      const { data, error } = await db.rpc("search_context", { q: words, p_area: flag("area") ?? null, p_limit: Number(flag("limit") ?? 8) })
      if (error) throw error
      if (!data.length) console.log("No matches. Try other words, or `pnpm context titles <area>`.")
      for (const r of data as Row[]) print(r, rest.includes("--brief"))
      return
    }
    case "get": {
      const ids = positional.map(Number).filter(Boolean)
      const { data, error } = await db.from("context_entries").select("id, area, kind, title, body, files, decided_on, superseded_by").in("id", ids)
      if (error) throw error
      for (const r of data) {
        print(r, false)
        if (r.superseded_by) console.log(`(superseded by #${r.superseded_by})`)
      }
      return
    }
    case "add": {
      const parsed = JSON.parse(readFileSync(positional[0], "utf8")) as Entry | Entry[]
      const entries = Array.isArray(parsed) ? parsed : [parsed]
      entries.forEach(check)
      const by = author()
      let added = 0
      for (const { supersedes, ...e } of entries) {
        const { data: same } = await db.from("context_entries").select("id").eq("area", e.area).eq("title", e.title).eq("body", e.body).limit(1)
        if (same?.length) {
          console.log(`skipped (already #${same[0].id}): ${e.title}`)
          continue
        }
        const { data, error } = await db.from("context_entries").insert({ ...e, created_by: by }).select("id").single()
        if (error) throw error
        added++
        if (supersedes) {
          const { error: e2 } = await db.from("context_entries").update({ superseded_by: data.id }).eq("id", supersedes)
          if (e2) throw e2
        }
        if (entries.length <= 20) console.log(`#${data.id} ${e.title}${supersedes ? ` (supersedes #${supersedes})` : ""}`)
      }
      console.log(`${added} added, ${entries.length - added} skipped`)
      return
    }
    case "update": {
      const [id, file] = positional
      const fields = JSON.parse(readFileSync(file, "utf8")) as Partial<Entry>
      const { error } = await db.from("context_entries").update(fields).eq("id", Number(id))
      if (error) throw error
      console.log(`#${id} updated (the previous text is in context_entry_history)`)
      return
    }
    case "supersede": {
      const [oldId, newId] = positional.map(Number)
      const { error } = await db.from("context_entries").update({ superseded_by: newId }).eq("id", oldId)
      if (error) throw error
      console.log(`#${oldId} is superseded by #${newId}`)
      return
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0])
  }
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})
