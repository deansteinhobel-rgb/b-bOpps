/**
 * Loads seed/history.json: past tests into a closed "Sprint 0: history before the app" per client,
 * and planned tests into the current sprint. Our database only (never Notion). Insert-only and
 * safe to re-run: a test whose title already exists in that sprint is skipped.
 *   pnpm seed:history [--dry-run]
 */
import { readFileSync } from "node:fs"
import { londonToday } from "@/lib/checks/periods"
import { computeSprintNumbers } from "@/lib/sprints/data"
import { sprintByNumber, sprintOf } from "@/lib/sprints/periods"
import { createAdminClient } from "@/lib/supabase/admin"

type Test = {
  platform: string | null
  title: string
  outcome?: string
  hypothesis?: string
  assets?: string[]
  success_metric?: string
  success_target?: number
  success_text?: string
  findings_worked?: string | null
  findings_blockers?: string | null
  findings_notes?: string | null
}
type ClientHistory = { slug: string; history_takeaway: string; past: Test[]; planned: Test[] }

const dryRun = process.argv.includes("--dry-run")
const db = createAdminClient()
const { clients } = JSON.parse(readFileSync("seed/history.json", "utf8")) as { clients: ClientHistory[] }

async function sprintFor(clientId: string, n: number) {
  const p = sprintByNumber(n)
  const { data: existing } = await db.from("sprints").select("id, closed_at").eq("client_id", clientId).eq("start_date", p.start).maybeSingle()
  if (existing) return existing
  if (dryRun) return { id: "(new)", closed_at: null }
  const { data, error } = await db.from("sprints").insert({ client_id: clientId, number: n, start_date: p.start, end_date: p.end }).select("id, closed_at").single()
  if (error) throw new Error(error.message)
  return data
}

async function addTests(sprintId: string, clientId: string, tests: Test[], extra: (t: Test) => object) {
  const { data: have } = sprintId === "(new)" ? { data: [] } : await db.from("sprint_tests").select("title").eq("sprint_id", sprintId)
  const titles = new Set((have ?? []).map((h) => h.title))
  const rows = tests
    .filter((t) => !titles.has(t.title))
    .map((t) => ({
      sprint_id: sprintId,
      client_id: clientId,
      platform: t.platform,
      title: t.title,
      hypothesis: t.hypothesis ?? null,
      assets: t.assets ?? [],
      success_metric: t.success_metric ?? null,
      success_target: t.success_target ?? null,
      success_text: t.success_text ?? null,
      findings_worked: t.findings_worked ?? null,
      findings_blockers: t.findings_blockers ?? null,
      findings_notes: t.findings_notes ?? null,
      ...extra(t),
    }))
  if (dryRun) {
    console.log(`    [dry run] would add ${rows.length}, skip ${tests.length - rows.length} already there`)
    return
  }
  if (rows.length) {
    const { error } = await db.from("sprint_tests").insert(rows)
    if (error) throw new Error(error.message)
  }
  console.log(`    added ${rows.length}, skipped ${tests.length - rows.length} already there`)
}

async function main() {
  const current = sprintOf(londonToday())
  for (const c of clients) {
    const { data: client } = await db.from("clients").select("id").eq("slug", c.slug).single()
    if (!client) throw new Error(`No client ${c.slug}`)
    const { data: andrea } = await db.from("team_invites").select("full_name, notion_user_id").eq("email", "andrea.restrepo@bordeauxandburgundy.co.uk").maybeSingle()
    console.log(c.slug)

    // Past tests: Sprint 0, closed, with its numbers snapshotted.
    const s0 = await sprintFor(client.id, 0)
    console.log(`  Sprint 0 (history): ${c.past.length} tests`)
    await addTests(s0.id, client.id, c.past, (t) => ({ status: "closed", outcome: t.outcome ?? "inconclusive" }))
    if (!dryRun && !s0.closed_at) {
      const { summary } = await computeSprintNumbers(client.id, sprintByNumber(0))
      await db.from("sprints").update({ key_takeaway: c.history_takeaway, summary, closed_at: new Date().toISOString() }).eq("id", s0.id)
      console.log("  Sprint 0 closed with its key takeaway")
    }

    // Next tests: the current sprint, planned, owned by the paid media specialist, due Friday.
    const s = await sprintFor(client.id, current.number)
    console.log(`  Sprint ${current.number}: ${c.planned.length} planned tests`)
    await addTests(s.id, client.id, c.planned, () => ({
      status: "planned",
      owner_notion_user_id: andrea?.notion_user_id ?? null,
      owner_name: andrea?.full_name ?? null,
      deadline: new Date(Date.parse(current.start) + 4 * 864e5).toISOString().slice(0, 10),
    }))
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
